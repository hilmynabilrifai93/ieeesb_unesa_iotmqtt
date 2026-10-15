import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createAuthServer, hashPassword } from '../server/app.mjs';

async function fixture(t, settings = {}) {
  const origin = 'https://ieee.hint-lab.id';
  const broker = new EventEmitter(); broker.connected = true;
  let publishes = 0;
  broker.publish = (_topic, _payload, _options, callback) => { publishes++; callback(); };
  let time = 1800000000000;
  const accounts = [{ id: 'esp32-01', name: 'Test', ...await hashPassword('abc123') }];
  const server = createAuthServer({ accounts, broker, origin, clock: () => time, ...settings });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  let cookie = '', csrf = '';
  const request = (path, data, headers = {}) => fetch(base + path, {
    method: data ? 'POST' : 'GET', headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...headers },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const login = await request('login', { deviceId: 'esp32-01', password: 'abc123' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const session = await (await request('session')).json(); csrf = session.csrf;
  return { request, session, advance: ms => { time += ms; }, publishes: () => publishes };
}

test('30-minute idle expiry rejects existing cookie even when sensor polling continues', async t => {
  const f = await fixture(t);
  assert.equal(f.session.idleTimeoutMs, 30 * 60000);
  for (let minute = 0; minute < 30; minute++) {
    const response = await f.request('messages'); assert.equal(response.status, 200);
    assert.equal((await response.json()).idleExpiresAt, f.session.idleExpiresAt);
    f.advance(60000);
  }
  for (const path of ['session', 'messages', 'events']) assert.equal((await f.request(path)).status, 401);
  assert.equal((await f.request('activity', {})).status, 401);
  assert.equal((await f.request('command', { deviceId: 'esp32-01', command: { led: true } })).status, 401);
  assert.equal(f.publishes(), 0);
});

test('verified activity and valid controls extend idle deadline; invalid CSRF does not', async t => {
  const f = await fixture(t);
  f.advance(29 * 60000);
  assert.equal((await f.request('activity', {}, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await (await f.request('session')).json()).idleExpiresAt, f.session.idleExpiresAt);
  const active = await f.request('activity', {}); assert.equal(active.status, 200);
  const deadline = (await active.json()).idleExpiresAt;
  assert.equal(deadline - f.session.idleExpiresAt, 29 * 60000);
  f.advance(2 * 60000); // Original login is now 31 minutes old, but user is active.
  assert.equal((await f.request('session')).status, 200);
  assert.equal((await f.request('command', { deviceId: 'esp32-01', command: { servo: 140 } })).status, 200);
  f.advance(29 * 60000);
  assert.equal((await f.request('session')).status, 200);
  f.advance(60000);
  assert.equal((await f.request('session')).status, 401);
});

test('activity never extends the existing absolute session lifetime', async t => {
  const f = await fixture(t, { sessionMs: 10000, idleMs: 3000 });
  for (let i = 0; i < 4; i++) { f.advance(2000); assert.equal((await f.request('activity', {})).status, 200); }
  const session = await (await f.request('session')).json();
  assert.equal(session.idleExpiresAt, f.session.idleExpiresAt + 7000);
  f.advance(2000);
  assert.equal((await f.request('activity', {})).status, 401);
});
