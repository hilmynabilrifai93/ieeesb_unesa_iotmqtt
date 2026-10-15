import test from 'node:test';
import assert from 'node:assert/strict';
import { createServoTargets } from '../src/servo-targets.js';

test('LED command preserves 140 after old/default 90 feedback and a page reload', () => {
  let saved;
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const targets = createServoTargets(storage);
  targets.remember('esp32-01', 140);
  targets.observe('esp32-01', 90);
  assert.equal(targets.get('esp32-01', 90), 140);
  assert.deepEqual(targets.ledCommand('esp32-01', { led: true }), { led: true, servo: 140 });
  const reloaded = createServoTargets(storage);
  assert.equal(reloaded.get('esp32-01', 90), 140);
  assert.deepEqual(reloaded.ledCommand('esp32-01', { led2: false }), { led2: false, servo: 140 });
});

test('devices stay isolated and unknown servo angles are not injected into LED commands', () => {
  const targets = createServoTargets();
  assert.deepEqual(targets.ledCommand('esp32-01', { led: true }), { led: true });
  targets.observe('esp32-01', 140);
  targets.observe('esp32-02', 36);
  assert.deepEqual(targets.ledCommand('esp32-02', { led: false }), { led: false, servo: 36 });
  targets.remember('esp32-01', 77);
  assert.equal(targets.get('esp32-01'), 77);
  assert.equal(targets.get('esp32-02'), 36);
});

test('invalid saved data and unavailable storage do not break servo control', () => {
  const targets = createServoTargets({ getItem: () => '{invalid', setItem: () => { throw Error('blocked'); } });
  targets.remember('esp32-01', 140);
  targets.remember('esp32-01', 181);
  assert.equal(targets.get('esp32-01'), 140);
});
