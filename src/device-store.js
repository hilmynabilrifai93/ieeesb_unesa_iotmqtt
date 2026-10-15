const TOPIC_PREFIX = 'ieee/lab';
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const LED_TARGET_PATTERN = /^led([1-8])$/;
const TELEMETRY_FIELDS = Object.freeze({
  temperature: [-40, 80],
  humidity: [0, 100],
  distance: [0, 500],
  waterLevel: [0, 100],
});
const HISTORY_LENGTH = 24;

export const MQTT_SUBSCRIPTIONS = Object.freeze([
  `${TOPIC_PREFIX}/+/telemetry`,
  `${TOPIC_PREFIX}/+/state`,
  `${TOPIC_PREFIX}/+/status`,
]);

function validDeviceId(deviceId) {
  return typeof deviceId === 'string' && DEVICE_ID_PATTERN.test(deviceId);
}

function parseJsonObject(payload) {
  if (typeof payload !== 'string') return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createDeviceState(definition) {
  return {
    id: definition.id,
    name: definition.name,
    status: 'offline',
    telemetry: {
      temperature: null,
      humidity: null,
      distance: null,
      waterLevel: null,
    },
    histories: {
      temperature: [],
      humidity: [],
      distance: [],
      waterLevel: [],
    },
    actuators: {
      leds: {},
      relay1: false,
      relay2: false,
      relay3: false,
      relay4: false,
      servo: 90,
      buzzer: false,
      lcd: {
        line1: '',
        line2: '',
      },
    },
    lastTelemetryAt: null,
    lastStateAt: null,
    lastStatusAt: null,
    lastMessageAt: null,
    monitoringStartedAt: Date.now(),
  };
}

export function parseDeviceTopic(topic) {
  if (typeof topic !== 'string') return null;
  const match = /^ieee\/lab\/([a-zA-Z0-9_-]+)\/(telemetry|state|command|status)$/.exec(topic);
  return match ? { deviceId: match[1], channel: match[2] } : null;
}

export function buildCommandTopic(deviceId) {
  return validDeviceId(deviceId) ? `${TOPIC_PREFIX}/${deviceId}/command` : null;
}

export function createCommandPayload(target, value) {
  if (target === 'led' || target === 'led1') {
    return typeof value === 'boolean' ? { led: value } : null;
  }
  if (typeof target === 'string' && LED_TARGET_PATTERN.test(target)) {
    return typeof value === 'boolean' ? { [target]: value } : null;
  }
  if (['relay1', 'relay2', 'relay3', 'relay4', 'buzzer'].includes(target)) {
    return typeof value === 'boolean' ? { [target]: value } : null;
  }
  if (target === 'servo' && Number.isInteger(value) && value >= 0 && value <= 180) {
    return { servo: value };
  }
  if (target === 'lcd' && value && typeof value === 'object' && !Array.isArray(value)) {
    const { line1, line2 } = value;
    const validLine = (line) => typeof line === 'string' && line.length <= 16;
    if (validLine(line1) && validLine(line2)) return { lcd: { line1, line2 } };
  }
  return null;
}

export function createDeviceStore(devices, defaultDeviceId) {
  if (!Array.isArray(devices) || devices.length === 0) {
    throw new TypeError('Daftar perangkat MQTT tidak boleh kosong.');
  }

  const definitions = devices.map((device) => {
    if (!device || !validDeviceId(device.id) || typeof device.name !== 'string' || !device.name.trim()) {
      throw new TypeError('Konfigurasi perangkat MQTT tidak valid.');
    }
    return Object.freeze({ id: device.id, name: device.name.trim() });
  });

  if (new Set(definitions.map((device) => device.id)).size !== definitions.length) {
    throw new TypeError('Device ID MQTT harus unik.');
  }

  const selectedDeviceId = definitions.some((device) => device.id === defaultDeviceId)
    ? defaultDeviceId
    : definitions[0].id;
  const byId = Object.fromEntries(definitions.map((device) => [device.id, createDeviceState(device)]));

  return { devices: definitions, selectedDeviceId, byId };
}

export function selectDevice(store, deviceId) {
  if (!store?.byId?.[deviceId] || store.selectedDeviceId === deviceId) return false;
  store.selectedDeviceId = deviceId;
  return true;
}

export function getSelectedDevice(store) {
  return store?.byId?.[store.selectedDeviceId] || null;
}

export function getDevicePresence(device, now = Date.now(), staleAfterMs = 20000) {
  if (!device || typeof now !== 'number' || typeof staleAfterMs !== 'number' || staleAfterMs < 0) {
    return 'inactive';
  }
  const latestSignalAt = Math.max(device.lastTelemetryAt || 0, device.lastStatusAt || 0);
  if (!latestSignalAt) {
    const monitoringStartedAt = device.monitoringStartedAt || 0;
    return monitoringStartedAt && now - monitoringStartedAt > staleAfterMs ? 'stale' : 'inactive';
  }
  if (now - latestSignalAt > staleAfterMs) return 'stale';
  return device.status === 'online' ? 'online' : 'offline';
}

export function canControlDevice(device, {
  brokerConnected = false,
  now = Date.now(),
  staleAfterMs = 20000,
} = {}) {
  return brokerConnected && getDevicePresence(device, now, staleAfterMs) === 'online';
}

function applyTelemetry(device, payload) {
  const data = parseJsonObject(payload);
  if (!data) return false;

  const fields = Object.keys(TELEMETRY_FIELDS).filter((field) => Object.hasOwn(data, field));
  if (fields.length === 0) return false;

  for (const field of fields) {
    const [minimum, maximum] = TELEMETRY_FIELDS[field];
    const value = data[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      return false;
    }
  }

  for (const field of fields) {
    device.telemetry[field] = data[field];
    device.histories[field].push(data[field]);
    if (device.histories[field].length > HISTORY_LENGTH) device.histories[field].shift();
  }
  device.lastTelemetryAt = Date.now();
  return true;
}

function applyState(device, payload) {
  const data = parseJsonObject(payload);
  if (!data) return false;

  const updates = [];
  if (Object.hasOwn(data, 'target') || Object.hasOwn(data, 'value')) {
    const command = createCommandPayload(data.target, data.value);
    if (!command) return false;
    updates.push(command);
  } else {
    for (const [target, value] of Object.entries(data)) {
      if (!(target === 'led' || LED_TARGET_PATTERN.test(target)
        || ['relay1', 'relay2', 'relay3', 'relay4', 'servo', 'buzzer', 'lcd'].includes(target))) continue;
      const command = createCommandPayload(target, value);
      if (!command) return false;
      updates.push(command);
    }
  }

  if (updates.length === 0) return false;
  for (const update of updates) {
    for (const [target, value] of Object.entries(update)) {
      if (target === 'led') device.actuators.leds.led1 = value;
      else if (LED_TARGET_PATTERN.test(target)) device.actuators.leds[target] = value;
      else if (target === 'lcd') device.actuators.lcd = { ...value };
      else device.actuators[target] = value;
    }
  }
  device.lastStateAt = Date.now();
  return true;
}

function applyStatus(device, payload) {
  if (typeof payload !== 'string') return false;
  let status = payload.trim().toLowerCase();
  if (status.startsWith('{')) {
    const data = parseJsonObject(payload);
    status = typeof data?.status === 'string' ? data.status.trim().toLowerCase() : '';
  }
  if (!['online', 'offline'].includes(status)) return false;
  device.status = status;
  device.lastStatusAt = Date.now();
  return true;
}

export function applyDeviceMessage(store, topic, payload) {
  const parsedTopic = parseDeviceTopic(topic);
  if (!parsedTopic || parsedTopic.channel === 'command') {
    return { accepted: false, reason: 'invalid-topic' };
  }

  const device = store?.byId?.[parsedTopic.deviceId];
  if (!device) return { accepted: false, reason: 'unknown-device', ...parsedTopic };

  const handlers = { telemetry: applyTelemetry, state: applyState, status: applyStatus };
  const accepted = handlers[parsedTopic.channel](device, payload);
  if (accepted) device.lastMessageAt = Date.now();
  return {
    accepted,
    reason: accepted ? null : 'invalid-payload',
    ...parsedTopic,
  };
}
