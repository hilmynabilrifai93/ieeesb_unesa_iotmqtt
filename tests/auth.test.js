import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAuthServer, hashPassword, validCommand } from '../server/app.mjs';

test('server login isolates sessions, validates commands and invalidates logout', async t => {
  const broker = new EventEmitter(); broker.connected = true;
  const commands = [];
  broker.publish = (topic, payload, options, callback) => { commands.push({ topic, payload, options }); callback(); };
  const account = { id: 'esp32-01', name: 'ESP32 Praktik 1', ...await hashPassword('abc123') };
  const origin = 'https://ieee.hint-lab.id';
  const server = createAuthServer({ accounts: [account], broker, origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  const request = (path, data, extra = {}) => fetch(base + '/api/' + path, {
    method: data ? 'POST' : 'GET', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...extra },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  assert.equal((await request('session')).status, 401);
  assert.equal((await request('events')).status, 401);
  assert.equal((await request('command', { deviceId: account.id, command: { led: true } })).status, 401);
  assert.equal((await request('login', { deviceId: account.id, password: 'wrong' })).status, 401);
  assert.equal((await request('login', { deviceId: account.id, password: 'abc123' }, { Origin: 'https://evil.example' })).status, 403);
  const login = await request('login', { deviceId: account.id, password: 'abc123' });
  assert.equal(login.status, 200);
  const header = login.headers.get('set-cookie');
  assert.match(header, /HttpOnly/); assert.match(header, /Secure/); assert.match(header, /SameSite=Strict/);
  cookie = header.split(';')[0];
  const session = await (await request('session')).json();
  assert.deepEqual(session.devices, [{ id: account.id, name: account.name }]); csrf = session.csrf;
  assert.equal((await request('command', { deviceId: 'esp32-02', command: { led: true } })).status, 403);
  assert.equal((await request('command', { deviceId: account.id, command: { led: true, servo: 181 } })).status, 400);
  assert.equal((await request('command', { deviceId: account.id, command: { led: true } }, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal(commands.length, 0);
  assert.equal((await request('command', { deviceId: account.id, command: { led: true, servo: 140 } })).status, 200);
  assert.equal(commands[0].topic, 'ieee/lab/esp32-01/command');
  assert.deepEqual(JSON.parse(commands[0].payload), { led: true, servo: 140 });
  for (const channel of [3, 4]) {
    for (const value of [true, false]) {
      const command = { [`relay${channel}`]: value };
      assert.equal((await request('command', { deviceId: account.id, command })).status, 200);
      assert.equal(commands.at(-1).topic, 'ieee/lab/esp32-01/command');
      assert.deepEqual(JSON.parse(commands.at(-1).payload), command);
    }
  }
  const abort = new AbortController();
  const stream = await fetch(base + '/api/events', { headers: { Cookie: cookie }, signal: abort.signal });
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /MQTT terhubung/);
  broker.emit('message', 'ieee/lab/esp32-02/state', Buffer.from('{"servo":90}'));
  broker.emit('message', 'ieee/lab/esp32-01/state', Buffer.from('{"servo":140}'));
  const received = new TextDecoder().decode((await reader.read()).value);
  assert.match(received, /esp32-01/); assert.doesNotMatch(received, /esp32-02/);
  const polled = await (await request('messages')).json();
  assert.equal(polled.status, 'MQTT terhubung');
  assert.equal(polled.messages.length, 1);
  assert.equal(polled.messages[0].topic, 'ieee/lab/esp32-01/state');
  abort.abort();
  assert.equal((await request('logout', {})).status, 200);
  assert.equal((await request('session')).status, 401);
  assert.equal((await request('command', { deviceId: account.id, command: { led: true } })).status, 401);
});

test('login brute force attempts are limited and expired sessions are rejected', async t => {
  const broker = new EventEmitter(); broker.connected = false;
  const origin = 'https://ieee.hint-lab.id';
  const accounts = [{ id: 'esp32-01', name: 'Test', ...await hashPassword('abc123') }];
  const server = createAuthServer({ accounts, broker, origin, sessionMs: 25 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const login = password => fetch(base + 'login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'esp32-01', password }) });
  const result = await login('abc123');
  const cookie = result.headers.get('set-cookie').split(';')[0];
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await fetch(base + 'session', { headers: { Cookie: cookie } })).status, 401);
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong')).status, 401);
  assert.equal((await login('abc123')).status, 429);
});

test('command validator rejects extra fields, wildcards and unsupported payloads', () => {
  for (const invalid of [null, [], {}, { topic: 'ieee/lab/+/command' }, { servo: 1.5 }, { led: 1 }, { relay1: true, servo: 90 }, { lcd: { line1: 'x', line2: '', extra: true } }]) assert.equal(validCommand(invalid), false);
  for (const valid of [{ servo: 140 }, { led8: true, servo: 140 }, { lcd: { line1: 'FISTI NISA', line2: 'NUR AZIZAH' } }]) assert.equal(validCommand(valid), true);
});
