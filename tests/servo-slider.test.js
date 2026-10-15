import test from 'node:test';
import assert from 'node:assert/strict';
import { createServoSlider } from '../src/servo-slider.js';
import { createCommandPayload } from '../src/device-store.js';

test('every slider angle 1–180 is retained during drag and is a valid command', () => {
  const slider = createServoSlider();
  for (let angle = 1; angle <= 180; angle++) {
    slider.input(angle, 'esp32-01');
    assert.equal(slider.angle(90, 'esp32-01'), angle);
    assert.deepEqual(createCommandPayload('servo', angle), { servo: angle });
  }
});

test('old MQTT feedback does not snap the slider back before acknowledgement', () => {
  const slider = createServoSlider();
  slider.input(43, 'esp32-01');
  slider.commit(1000);
  assert.equal(slider.angle(90, 'esp32-01', 1100), 43);
  assert.equal(slider.angle(43, 'esp32-01', 1200), 43);
  assert.equal(slider.angle(44, 'esp32-01', 1300), 44);
});

test('missing feedback expires and switching devices or modes clears preview', () => {
  const slider = createServoSlider();
  slider.input(137, 'esp32-01');
  slider.commit(1000);
  assert.equal(slider.angle(90, 'esp32-01', 6000), 90);
  slider.input(137, 'esp32-01');
  assert.equal(slider.angle(22, 'esp32-02'), 22);
  slider.input(137, 'esp32-02');
  slider.clear();
  assert.equal(slider.angle(90, 'esp32-02'), 90);
});
