import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createModeController, getBrokerDisplayStatus, getInitialDashboardMode,
} from '../src/mode-controller.js';
import { createDeviceStore, getDevicePresence } from '../src/device-store.js';

function createHarness(initialMode) {
  const timers = new Map();
  let nextTimerId = 1;
  const calls = { connect: 0, disconnect: 0, ticks: 0, modes: [] };
  const storageValues = new Map();
  const storage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value),
  };
  const controller = createModeController({
    initialMode,
    storage,
    setIntervalFn: (callback) => {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearIntervalFn: (id) => timers.delete(id),
    onSimulationTick: () => { calls.ticks += 1; },
    connectMqtt: () => { calls.connect += 1; },
    disconnectMqtt: () => { calls.disconnect += 1; },
    onModeChange: (mode) => calls.modes.push(mode),
  });
  return { calls, controller, storageValues, timers };
}

test('mode awal memakai konfigurasi atau pilihan valid dari localStorage', () => {
  const storage = { getItem: () => 'simulation' };
  assert.equal(getInitialDashboardMode(storage, 'mqtt'), 'simulation');
  assert.equal(getInitialDashboardMode({ getItem: () => 'invalid' }, 'mqtt'), 'mqtt');
  assert.equal(getInitialDashboardMode({ getItem: () => { throw new Error('blocked'); } }, 'mqtt'), 'mqtt');
});

test('simulation ke MQTT menghentikan timer dan hanya membuat satu sesi MQTT', () => {
  const { calls, controller, storageValues, timers } = createHarness('simulation');
  assert.equal(timers.size, 1);
  assert.equal(calls.connect, 0);
  assert.equal(controller.setMode('mqtt'), true);
  assert.equal(timers.size, 0);
  assert.equal(calls.connect, 1);
  assert.equal(controller.isMqttActive(), true);
  assert.equal(controller.setMode('mqtt'), false);
  assert.equal(calls.connect, 1);
  assert.equal(calls.ticks, 0);
  assert.equal(storageValues.get('ieee-dashboard-mode'), 'mqtt');
});

test('MQTT ke simulation disconnect bersih dan tidak membuat timer ganda', () => {
  const { calls, controller, timers } = createHarness('mqtt');
  assert.equal(calls.connect, 1);
  assert.equal(timers.size, 0);
  assert.equal(controller.setMode('simulation'), true);
  assert.equal(calls.disconnect, 1);
  assert.equal(timers.size, 1);
  assert.equal(controller.setMode('simulation'), false);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(calls.ticks, 1);
  controller.destroy();
  assert.equal(timers.size, 0);
});

test('status broker terpisah dari status perangkat', () => {
  const store = createDeviceStore([{ id: 'esp32-01', name: 'ESP32 Praktik 1' }], 'esp32-01');
  const device = store.byId['esp32-01'];
  assert.equal(getBrokerDisplayStatus('mqtt', 'MQTT terhubung'), 'MQTT terhubung');
  assert.equal(getDevicePresence(device, 20000, 15000), 'inactive');
  assert.equal(getBrokerDisplayStatus('simulation', 'MQTT terhubung'), 'Mode simulasi');
});
