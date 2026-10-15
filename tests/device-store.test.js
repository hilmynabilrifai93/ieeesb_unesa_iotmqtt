import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MQTT_SUBSCRIPTIONS, applyDeviceMessage, buildCommandTopic, canControlDevice, createCommandPayload,
  createDeviceStore, getDevicePresence, getSelectedDevice, parseDeviceTopic, selectDevice,
} from '../src/device-store.js';

const devices = [
  { id: 'esp32-01', name: 'ESP32 Praktik 1' },
  { id: 'esp32-02', name: 'ESP32 Praktik 2' },
];

test('topic parser accepts only the device topic contract', () => {
  assert.deepEqual(parseDeviceTopic('ieee/lab/esp32-01/telemetry'), {
    deviceId: 'esp32-01', channel: 'telemetry',
  });
  assert.deepEqual(parseDeviceTopic('ieee/lab/esp32-02/state'), {
    deviceId: 'esp32-02', channel: 'state',
  });
  assert.equal(parseDeviceTopic('ieee/test/esp32-01'), null);
  assert.equal(parseDeviceTopic('ieee/lab/esp32/01/telemetry'), null);
  assert.equal(parseDeviceTopic('ieee/lab/+/telemetry'), null);
  assert.deepEqual(MQTT_SUBSCRIPTIONS, [
    'ieee/lab/+/telemetry',
    'ieee/lab/+/state',
    'ieee/lab/+/status',
  ]);
});

test('device selection defaults to esp32-01 and rejects unknown devices', () => {
  const store = createDeviceStore(devices, 'esp32-01');
  assert.equal(store.selectedDeviceId, 'esp32-01');
  assert.equal(getSelectedDevice(store).name, 'ESP32 Praktik 1');
  assert.equal(selectDevice(store, 'esp32-02'), true);
  assert.equal(getSelectedDevice(store).name, 'ESP32 Praktik 2');
  assert.equal(selectDevice(store, 'esp32-404'), false);
  assert.equal(store.selectedDeviceId, 'esp32-02');
});

test('store supports ten practice devices and five teacher devices', () => {
  const configuredDevices = [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `esp32-${String(index + 1).padStart(2, '0')}`,
      name: `ESP32 Praktik ${index + 1}`,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `esp32-pengajar-${String(index + 1).padStart(2, '0')}`,
      name: `ESP32 Pengajar ${index + 1}`,
    })),
  ];
  const store = createDeviceStore(configuredDevices, 'esp32-01');
  assert.equal(store.devices.length, 15);
  assert.equal(selectDevice(store, 'esp32-pengajar-05'), true);
  assert.equal(getSelectedDevice(store).name, 'ESP32 Pengajar 5');
  assert.equal(buildCommandTopic(store.selectedDeviceId), 'ieee/lab/esp32-pengajar-05/command');
});

test('ultrasonic-only telemetry updates distance without requiring DHT readings', () => {
  const store = createDeviceStore(devices, 'esp32-01');
  const topic = 'ieee/lab/esp32-01/telemetry';
  const payload = '{"deviceId":"esp32-01","distance":153.3725,"waterLevel":0}';
  assert.equal(applyDeviceMessage(store, topic, payload).accepted, true);
  assert.deepEqual(store.byId['esp32-01'].telemetry, {
    temperature: null, humidity: null, distance: 153.3725, waterLevel: 0,
  });
  assert.deepEqual(store.byId['esp32-01'].histories.distance, [153.3725]);
  assert.deepEqual(store.byId['esp32-01'].histories.temperature, []);
  assert.equal(store.byId['esp32-02'].telemetry.distance, null);
  assert.equal(applyDeviceMessage(store, topic, '{"temperature":28}').accepted, true);
  assert.equal(store.byId['esp32-01'].telemetry.distance, 153.3725);
  assert.equal(store.byId['esp32-01'].telemetry.temperature, 28);
});

test('partial telemetry still rejects invalid supplied values without changing sensor state', () => {
  const store = createDeviceStore(devices, 'esp32-01');
  const topic = 'ieee/lab/esp32-01/telemetry';
  for (const payload of ['{}', '{"deviceId":"esp32-01"}', '{"distance":-1}',
    '{"distance":501}', '{"distance":"153"}', '{"distance":null}',
    '{"distance":153,"humidity":101}']) {
    assert.equal(applyDeviceMessage(store, topic, payload).accepted, false);
    assert.equal(store.byId['esp32-01'].telemetry.distance, null);
    assert.deepEqual(store.byId['esp32-01'].histories.distance, []);
    assert.equal(store.byId['esp32-01'].lastTelemetryAt, null);
  }
});

test('telemetry and actuator state remain isolated per device', () => {
  const store = createDeviceStore(devices, 'esp32-01');
  const telemetry = JSON.stringify({
    temperature: 28.7, humidity: 65, distance: 26.5, waterLevel: 43,
    ignoredField: 'safe to ignore',
  });
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/telemetry', telemetry).accepted, true);
  assert.equal(store.byId['esp32-01'].telemetry.temperature, 28.7);
  assert.equal(store.byId['esp32-02'].telemetry.temperature, null);
  assert.equal(typeof store.byId['esp32-01'].lastMessageAt, 'number');

  assert.equal(applyDeviceMessage(
    store,
    'ieee/lab/esp32-02/state',
    '{"deviceId":"esp32-02","led":true,"relay1":true,"relay2":false,"servo":135,"buzzer":true,"lcd":{"line1":"IEEE SB UNESA","line2":"LAB IOT SIAP"},"unknown":1}',
  ).accepted, true);
  assert.equal(store.byId['esp32-02'].actuators.leds.led1, true);
  assert.equal(store.byId['esp32-02'].actuators.relay1, true);
  assert.equal(store.byId['esp32-02'].actuators.servo, 135);
  assert.equal(store.byId['esp32-02'].actuators.buzzer, true);
  assert.deepEqual(store.byId['esp32-02'].actuators.lcd, {
    line1: 'IEEE SB UNESA', line2: 'LAB IOT SIAP',
  });
  assert.equal(store.byId['esp32-01'].actuators.relay1, false);
});

test('legacy target/value state remains supported', () => {
  const store = createDeviceStore(devices, 'esp32-01');
  assert.equal(applyDeviceMessage(
    store,
    'ieee/lab/esp32-01/state',
    '{"target":"relay2","value":true}',
  ).accepted, true);
  assert.equal(store.byId['esp32-01'].actuators.relay2, true);
});

test('device presence distinguishes online, offline, stale and inactive data', () => {
  const store = createDeviceStore(devices, 'esp32-01');
  const device = store.byId['esp32-01'];
  assert.equal(getDevicePresence(device, 20000, 15000), 'inactive');
  device.monitoringStartedAt = 1000;
  assert.equal(getDevicePresence(device, 17000, 15000), 'stale');
  device.status = 'online';
  device.lastStatusAt = 10000;
  assert.equal(getDevicePresence(device, 20000, 15000), 'online');
  device.status = 'offline';
  assert.equal(getDevicePresence(device, 20000, 15000), 'offline');
  assert.equal(getDevicePresence(device, 26000, 15000), 'stale');
});

test('actuator controls require broker and a fresh online device status', () => {
  const store = createDeviceStore(devices, 'esp32-01');
  const device = store.byId['esp32-01'];
  device.status = 'online';
  device.lastStatusAt = 10000;
  assert.equal(canControlDevice(device, { brokerConnected: false, now: 12000, staleAfterMs: 20000 }), false);
  assert.equal(canControlDevice(device, { brokerConnected: true, now: 12000, staleAfterMs: 20000 }), true);
  assert.equal(canControlDevice(device, { brokerConnected: true, now: 31000, staleAfterMs: 20000 }), false);
  device.status = 'offline';
  device.lastStatusAt = 32000;
  assert.equal(canControlDevice(device, { brokerConnected: true, now: 33000, staleAfterMs: 20000 }), false);
});

test('invalid JSON, invalid fields, unknown devices and unsupported status are rejected safely', () => {
  const store = createDeviceStore(devices, 'esp32-01');
  const before = structuredClone(store.byId['esp32-01']);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/telemetry', '{broken').accepted, false);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/telemetry', '{"temperature":"hot"}').accepted, false);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/state', '{"relay1":"yes"}').accepted, false);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/state', '{"buzzer":"yes"}').accepted, false);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/state', '{"lcd":{"line1":"12345678901234567","line2":""}}').accepted, false);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-03/status', 'online').reason, 'unknown-device');
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/status', 'ready').accepted, false);
  assert.deepEqual(store.byId['esp32-01'], before);

  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/status', 'online').accepted, true);
  assert.equal(store.byId['esp32-01'].status, 'online');
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/status', '{"status":"offline"}').accepted, true);
  assert.equal(store.byId['esp32-01'].status, 'offline');
});

test('four relay states accept full and partial updates without crossing devices', () => {
  const store = createDeviceStore(devices);
  assert.equal(store.byId['esp32-01'].actuators.relay3, false);
  assert.equal(store.byId['esp32-01'].actuators.relay4, false);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/state',
    '{"relay1":true,"relay2":false,"relay3":true,"relay4":true}').accepted, true);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/state',
    '{"target":"relay3","value":false}').accepted, true);
  assert.equal(store.byId['esp32-01'].actuators.relay3, false);
  assert.equal(store.byId['esp32-01'].actuators.relay4, true);
  assert.equal(store.byId['esp32-02'].actuators.relay4, false);
  assert.equal(applyDeviceMessage(store, 'ieee/lab/esp32-01/state',
    '{"relay3":true,"relay4":"on"}').accepted, false);
  assert.equal(store.byId['esp32-01'].actuators.relay3, false);
});

test('command topic and payload are created only for supported actuators', () => {
  assert.equal(buildCommandTopic('esp32-02'), 'ieee/lab/esp32-02/command');
  assert.equal(buildCommandTopic('esp32/02'), null);
  assert.deepEqual(createCommandPayload('led1', true), { led: true });
  assert.deepEqual(createCommandPayload('led2', true), { led2: true });
  assert.deepEqual(createCommandPayload('relay1', false), { relay1: false });
  assert.deepEqual(createCommandPayload('relay2', true), { relay2: true });
  assert.deepEqual(createCommandPayload('relay3', true), { relay3: true });
  assert.deepEqual(createCommandPayload('relay4', false), { relay4: false });
  assert.equal(createCommandPayload('relay3', 1), null);
  assert.equal(createCommandPayload('relay4', 'on'), null);
  assert.deepEqual(createCommandPayload('servo', 90), { servo: 90 });
  assert.deepEqual(createCommandPayload('buzzer', true), { buzzer: true });
  assert.deepEqual(createCommandPayload('lcd', {
    line1: 'IEEE SB UNESA', line2: 'LAB IOT SIAP',
  }), { lcd: { line1: 'IEEE SB UNESA', line2: 'LAB IOT SIAP' } });
  assert.equal(createCommandPayload('servo', 181), null);
  assert.equal(createCommandPayload('relay5', true), null);
  assert.equal(createCommandPayload('led1', 'true'), null);
  assert.equal(createCommandPayload('lcd', { line1: '12345678901234567', line2: '' }), null);
});
