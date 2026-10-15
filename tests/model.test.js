import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLabState, tick, setOutput, addLed, renameLed, removeLed, setLed, setServo,
  setLcd, recordMqttMessage, resetControls, toggleSimulation,
} from '../src/model.js';

test('new demo identifies simulated data and starts with independent state', () => {
  const state = createLabState();
  const other = createLabState();
  assert.equal(state.simulationRunning, true);
  assert.deepEqual(state.outputs, { relay1: false, relay2: false, relay3: false, relay4: false, buzzer: false });
  assert.deepEqual(state.leds, [{ id: 'led-1', channel: 1, name: 'LED 1', on: false }]);
  assert.deepEqual(state.sensors, { temperature: 28.4, humidity: 64, distance: 24.6, water: 42 });
  assert.match(state.logs[0].message, /simulasi/i);
  assert.match(state.lastSample, /^\d{2}:\d{2}:\d{2}$/);
  setOutput(state, 'relay1', true);
  tick(state);
  assert.equal(other.outputs.relay1, false);
  assert.equal(other.sampleCount, 0);
  for (const [name, history] of Object.entries(other.histories)) {
    assert.equal(history.length, 24);
    assert.equal(history.at(-1), other.sensors[name]);
  }
});

test('sensor readings stay finite and realistic over a long simulation', () => {
  const state = createLabState();
  const bounds = { temperature: [15, 40], humidity: [20, 95], distance: [2, 400], water: [0, 100] };
  const firstHistory = [...state.histories.temperature];
  tick(state);
  assert.deepEqual(state.histories.temperature.slice(0, -1), firstHistory.slice(1));
  for (let step = 0; step < 2000; step += 1) {
    const previous = { ...state.sensors };
    assert.equal(tick(state), true);
    for (const [name, [min, max]] of Object.entries(bounds)) {
      assert.ok(Number.isFinite(state.sensors[name]));
      assert.ok(state.sensors[name] >= min && state.sensors[name] <= max, name);
      assert.ok(Math.abs(state.sensors[name] - previous[name]) <= 1, `${name} should change slowly`);
      assert.equal(state.histories[name].length, 24);
      assert.equal(state.histories[name].at(-1), state.sensors[name]);
    }
  }
  assert.equal(state.sampleCount, 2001);
});

test('pausing freezes samples while controls still work; resume continues', () => {
  const state = createLabState();
  toggleSimulation(state);
  const paused = structuredClone(state);
  assert.equal(tick(state), false);
  assert.deepEqual(state, paused);
  assert.equal(setLed(state, 'led-1', true), true);
  toggleSimulation(state);
  assert.equal(tick(state), true);
  assert.equal(state.sampleCount, 1);
});

test('relay channels operate independently and invalid outputs never mutate state', () => {
  const state = createLabState();
  setOutput(state, 'relay1', true);
  assert.equal(state.outputs.relay2, false);
  setOutput(state, 'relay2', true);
  setOutput(state, 'relay1', false);
  assert.equal(state.outputs.relay2, true);
  setOutput(state, 'relay3', true);
  assert.equal(state.outputs.relay4, false);
  setOutput(state, 'relay4', true);
  setOutput(state, 'relay3', false);
  assert.equal(state.outputs.relay1, false);
  assert.equal(state.outputs.relay2, true);
  assert.equal(state.outputs.relay4, true);
  const before = structuredClone(state);
  for (const name of ['relay5', 'constructor', '__proto__']) assert.equal(setOutput(state, name, true), false);
  assert.equal(setOutput(state, 'led', true), false);
  assert.equal(setOutput(state, 'relay2', true), false);
  assert.deepEqual(state, before);
});

test('user-defined LEDs can be added, named, switched independently, renamed and removed', () => {
  const state = createLabState();
  const secondId = addLed(state, '  Lampu meja  ');
  const thirdId = addLed(state, 'Indikator pintu');
  assert.equal(secondId, 'led-2');
  assert.equal(thirdId, 'led-3');
  assert.equal(state.leds[1].name, 'Lampu meja');
  assert.equal(setLed(state, secondId, true), true);
  assert.equal(state.leds[0].on, false);
  assert.equal(state.leds[1].on, true);
  assert.equal(state.leds[2].on, false);
  assert.equal(renameLed(state, thirdId, 'LED tangki'), true);
  assert.equal(state.leds[2].name, 'LED tangki');
  assert.equal(renameLed(state, thirdId, '   '), false);
  assert.equal(setLed(state, 'led-404', true), false);
  assert.equal(removeLed(state, secondId), true);
  assert.deepEqual(state.leds.map((led) => led.name), ['LED 1', 'LED tangki']);
  assert.equal(removeLed(state, 'led-404'), false);
});

test('LED list is capped at eight channels and always retains one LED', () => {
  const state = createLabState();
  while (state.leds.length < state.maxLeds) assert.ok(addLed(state, `LED ${state.leds.length + 1}`));
  assert.equal(state.leds.length, 8);
  assert.equal(addLed(state, 'LED 9'), null);
  while (state.leds.length > 1) assert.equal(removeLed(state, state.leds.at(-1).id), true);
  assert.equal(removeLed(state, state.leds[0].id), false);
});

test('servo clamps finite numbers and rejects malformed values', () => {
  const state = createLabState();
  setServo(state, -50);
  assert.equal(state.servoAngle, 0);
  setServo(state, 181);
  assert.equal(state.servoAngle, 180);
  setServo(state, 42.7);
  assert.equal(state.servoAngle, 43);
  const before = structuredClone(state);
  for (const invalid of [NaN, Infinity, -Infinity, '90', null, undefined]) {
    assert.equal(setServo(state, invalid), false);
  }
  assert.deepEqual(state, before);
});

test('LCD keeps two printable ASCII rows with at most 16 characters', () => {
  const state = createLabState();
  assert.equal(setLcd(state, '12345678901234567890', 'Café\n🌡\tOK'), true);
  assert.equal(state.lcdLines[0], '1234567890123456');
  assert.equal(state.lcdLines[1], 'Cafe   OK');
  for (const line of state.lcdLines) assert.match(line, /^[\x20-\x7e]{0,16}$/);
  const before = structuredClone(state);
  assert.equal(setLcd(state, null, 'test'), false);
  assert.deepEqual(state, before);
  assert.equal(setLcd(state, '', ''), true);
  assert.deepEqual(state.lcdLines, ['', '']);
});

test('reset clears all controls in one log while preserving samples, LCD and pause', () => {
  const state = createLabState();
  for (const name of Object.keys(state.outputs)) setOutput(state, name, true);
  addLed(state, 'Lampu meja');
  for (const led of state.leds) setLed(state, led.id, true);
  setServo(state, 145);
  setLcd(state, 'BELAJAR IOT', 'IEEE SB UNESA');
  tick(state);
  toggleSimulation(state);
  const before = structuredClone(state);
  assert.equal(resetControls(state), true);
  assert.deepEqual(state.outputs, { relay1: false, relay2: false, relay3: false, relay4: false, buzzer: false });
  assert.deepEqual(state.leds.map(({ name, on }) => ({ name, on })), [
    { name: 'LED 1', on: false },
    { name: 'Lampu meja', on: false },
  ]);
  assert.equal(state.servoAngle, 90);
  assert.equal(state.logs.length, before.logs.length + 1);
  for (const key of ['histories', 'sensors', 'sampleCount', 'lastSample', 'lcdLines', 'simulationRunning']) {
    assert.deepEqual(state[key], before[key], key);
  }
  assert.equal(resetControls(state), false);
});

test('activity log keeps newest-first bounded history', () => {
  const state = createLabState();
  for (let i = 0; i < 120; i += 1) setLed(state, 'led-1', i % 2 === 0);
  assert.equal(state.logs.length, 50);
  assert.equal(new Set(state.logs.map((log) => log.id)).size, 50);
  for (let i = 1; i < state.logs.length; i += 1) {
    assert.ok(state.logs[i - 1].id > state.logs[i].id);
    assert.match(state.logs[i].time, /^\d{2}:\d{2}:\d{2}$/);
  }
});

test('MQTT messages enter the activity log with topic, payload and source type', () => {
  const state = createLabState();
  assert.equal(recordMqttMessage(state, 'ieee/lab/esp32-01/status', 'online'), true);
  assert.equal(state.logs[0].type, 'MQTT');
  assert.match(state.logs[0].message, /^ieee\/lab\/esp32-01\/status: online$/);
  assert.equal(recordMqttMessage(state, '', 'payload'), false);
  assert.equal(recordMqttMessage(state, 'ieee/lab/esp32-01/status', null), false);
});
