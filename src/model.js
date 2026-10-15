const HISTORY_LENGTH = 24;
const LOG_LIMIT = 50;
const MAX_LEDS = 8;
const LED_NAME_LENGTH = 24;
const SENSOR_PROFILES = {
  temperature: { initial: 28.4, amplitude: 0.9, rate: 0.12, min: 15, max: 40, precision: 1 },
  humidity: { initial: 64, amplitude: 3.2, rate: 0.09, min: 20, max: 95, precision: 0 },
  distance: { initial: 24.6, amplitude: 4.1, rate: 0.15, min: 2, max: 400, precision: 1 },
  water: { initial: 42, amplitude: 5.5, rate: 0.06, min: 0, max: 100, precision: 0 },
};

const OUTPUT_LABELS = {
  relay1: 'Relay 1',
  relay2: 'Relay 2',
  relay3: 'Relay 3',
  relay4: 'Relay 4',
  buzzer: 'Buzzer',
};

function localTime(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function addLog(state, message, type = 'Simulasi') {
  state.logs.unshift({ id: state.nextLogId++, time: localTime(), message, type });
  if (state.logs.length > LOG_LIMIT) state.logs.length = LOG_LIMIT;
}

function boundedReading(profile, step) {
  const movement = Math.sin(step * profile.rate) * 0.75
    + Math.sin(step * profile.rate * 0.31) * 0.25;
  const value = Math.min(profile.max, Math.max(profile.min,
    profile.initial + movement * profile.amplitude));
  return Number(value.toFixed(profile.precision));
}

function boundedInteger(value, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.min(maximum, Math.max(0, value)));
}

function lcdLine(value) {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/gu, ' ')
    .slice(0, 16);
}

function ledName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, LED_NAME_LENGTH);
  return normalized || null;
}

/** Create a local demo. The initial graph samples are simulated too. */
export function createLabState() {
  const startedAt = Date.now();
  const state = {
    simulationRunning: true,
    outputs: { relay1: false, relay2: false, relay3: false, relay4: false, buzzer: false },
    leds: [{ id: 'led-1', channel: 1, name: 'LED 1', on: false }],
    nextLedId: 2,
    maxLeds: MAX_LEDS,
    servoAngle: 90,
    lcdLines: ['IEEE SB UNESA', 'LAB IOT SIAP'],
    sensors: {},
    histories: {},
    logs: [],
    sampleCount: 0,
    lastSample: localTime(startedAt),
    startedAt,
    tickCount: 0,
    nextLogId: 1,
  };

  for (const [name, profile] of Object.entries(SENSOR_PROFILES)) {
    state.sensors[name] = profile.initial;
    state.histories[name] = Array.from({ length: HISTORY_LENGTH }, (_, index) =>
      boundedReading(profile, index - HISTORY_LENGTH + 1));
  }

  addLog(state, 'Simulasi lokal dimulai. Data contoh, belum terhubung ke ESP32.');
  return state;
}

/** Advance one sample; paused simulations remain entirely unchanged. */
export function tick(state) {
  if (!state.simulationRunning) return false;
  state.tickCount += 1;
  for (const [name, profile] of Object.entries(SENSOR_PROFILES)) {
    const value = boundedReading(profile, state.tickCount);
    state.sensors[name] = value;
    state.histories[name].push(value);
    if (state.histories[name].length > HISTORY_LENGTH) state.histories[name].shift();
  }
  state.sampleCount += 1;
  state.lastSample = localTime();
  return true;
}

/** Relay channels and buzzer remain fixed outputs. LEDs are user-defined. */
export function setOutput(state, name, value) {
  if (!Object.prototype.hasOwnProperty.call(OUTPUT_LABELS, name)
    || typeof value !== 'boolean' || state.outputs[name] === value) return false;
  state.outputs[name] = value;
  addLog(state, `${OUTPUT_LABELS[name]} ${value ? 'dinyalakan' : 'dimatikan'}.`);
  return true;
}

export function addLed(state, name) {
  if (!Array.isArray(state.leds) || state.leds.length >= MAX_LEDS) return null;
  const channel = Array.from({ length: MAX_LEDS }, (_, index) => index + 1)
    .find((candidate) => !state.leds.some((led) => led.channel === candidate));
  if (!channel) return null;
  const number = state.nextLedId;
  const nextName = ledName(name) || `LED ${channel}`;
  const led = { id: `led-${number}`, channel, name: nextName, on: false };
  state.nextLedId += 1;
  state.leds.push(led);
  addLog(state, `${nextName} ditambahkan.`);
  return led.id;
}

export function renameLed(state, id, name) {
  const led = state.leds.find((item) => item.id === id);
  const nextName = ledName(name);
  if (!led || !nextName || nextName === led.name) return false;
  const previousName = led.name;
  led.name = nextName;
  addLog(state, `${previousName} diganti nama menjadi ${nextName}.`);
  return true;
}

export function removeLed(state, id) {
  if (!Array.isArray(state.leds) || state.leds.length <= 1) return false;
  const index = state.leds.findIndex((item) => item.id === id);
  if (index < 0) return false;
  const [removed] = state.leds.splice(index, 1);
  addLog(state, `${removed.name} dihapus dari simulasi.`);
  return true;
}

export function setLed(state, id, value) {
  const led = state.leds.find((item) => item.id === id);
  if (!led || typeof value !== 'boolean' || led.on === value) return false;
  led.on = value;
  addLog(state, `${led.name} ${value ? 'dinyalakan' : 'dimatikan'}.`);
  return true;
}

export function setServo(state, angle) {
  const next = boundedInteger(angle, 180);
  if (next === null || next === state.servoAngle) return false;
  state.servoAngle = next;
  addLog(state, `Servo diarahkan ke ${next}°.`);
  return true;
}

export function setLcd(state, line1, line2) {
  if (typeof line1 !== 'string' || typeof line2 !== 'string') return false;
  const lines = [lcdLine(line1), lcdLine(line2)];
  if (lines.every((line, index) => line === state.lcdLines[index])) return false;
  state.lcdLines = lines;
  addLog(state, 'Teks LCD diperbarui.');
  return true;
}

export function recordMqttMessage(state, topic, payload) {
  if (typeof topic !== 'string' || !topic || typeof payload !== 'string') return false;
  const compactPayload = payload.replace(/\s+/g, ' ').trim().slice(0, 240);
  addLog(state, `${topic}: ${compactPayload}`, 'MQTT');
  return true;
}

/** Reset actuators; retain LED definitions, LCD text, sensor history, and demo pause. */
export function resetControls(state) {
  const changed = Object.values(state.outputs).some(Boolean)
    || state.leds.some((led) => led.on)
    || state.servoAngle !== 90;
  if (!changed) return false;
  for (const name of Object.keys(OUTPUT_LABELS)) state.outputs[name] = false;
  for (const led of state.leds) led.on = false;
  state.servoAngle = 90;
  addLog(state, 'Kontrol direset: output mati dan servo 90°.');
  return true;
}

export function toggleSimulation(state) {
  state.simulationRunning = !state.simulationRunning;
  addLog(state, `Simulasi ${state.simulationRunning ? 'dilanjutkan' : 'dijeda'}.`);
  return true;
}
