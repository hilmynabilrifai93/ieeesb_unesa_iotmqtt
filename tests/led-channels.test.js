import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createLabState, addLed, removeLed, renameLed } from '../src/model.js';
import { createCommandPayload } from '../src/device-store.js';

test('LED channels survive deletion, rename and reorder; only free channels are reused', () => {
  const state = createLabState();
  const second = addLed(state, 'Second');
  const third = addLed(state, 'Third');
  removeLed(state, state.leds[0].id);
  renameLed(state, second, 'Renamed');
  state.leds.reverse();
  assert.equal(state.leds.find((led) => led.id === second).channel, 2);
  assert.equal(state.leds.find((led) => led.id === third).channel, 3);
  for (let i = 0; i < 20; i++) {
    const added = addLed(state, 'Replacement');
    assert.equal(state.leds.find((led) => led.id === added).channel, 1);
    assert.equal(removeLed(state, added), true);
  }
  while (state.leds.length < 8) addLed(state, 'Extra');
  assert.deepEqual(state.leds.map((led) => led.channel).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(addLed(state, 'Overflow'), null);
  for (const led of state.leds) assert.ok(createCommandPayload(`led${led.channel}`, true));
});

test('actual MQTT click handler and rendered state use fixed LED channels after deleting first row', () => {
  const state = createLabState();
  const second = addLed(state, 'Second');
  addLed(state, 'Third');
  removeLed(state, state.leds[0].id);
  const sent = [];
  let click;
  const context = vm.createContext({
    state, deviceStore: {}, isMqttMode: () => true,
    getSelectedDevice: () => ({ actuators: { leds: { led1: true, led2: false, led3: true } } }),
    sendSelectedCommand: (target, value) => sent.push({ target, value }),
    escape: (value) => value, ledDrawing: () => '', ledSwitch: () => '',
    document: { addEventListener: (_event, handler) => { click = handler; } },
  });
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const markup = source.slice(source.indexOf('function ledListMarkup()'), source.indexOf('function renderLedList()'));
  const handler = source.slice(source.indexOf("document.addEventListener('click'"), source.indexOf("document.addEventListener('input'"));
  vm.runInContext(markup + '\n' + handler, context);
  const rendered = vm.runInContext('ledListMarkup()', context);
  assert.match(rendered, /Second<\/strong>.*?Mati.*?LED 2/);
  assert.match(rendered, /Third<\/strong>.*?Menyala.*?LED 3/);
  click({ target: { closest: (selector) => selector === '[data-led-toggle]' ? { dataset: { ledToggle: second } } : null } });
  assert.deepEqual(sent, [{ target: 'led2', value: true }]);
});
