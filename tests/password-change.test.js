import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAuthServer, hashPassword } from '../server/app.mjs';
import { createAccountStore } from '../server/account-store.mjs';

const origin = 'https://ieee.hint-lab.id';
const initial = 'initial-group-fixture';
const changed = 'Qm7r2Z';
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hint-password-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'data', 'accounts.json');
  const seed = path.join(directory, 'seed.json');
  const accounts = await Promise.all(['group-1', 'group-2'].map(async id => ({ id, name: id, ...await hashPassword(initial) })));
  await writeFile(seed, JSON.stringify(accounts));
  const store = await createAccountStore(file, seed);
  const broker = new EventEmitter(); broker.connected = false;
  const server = createAuthServer({ accounts: store.accounts, broker, origin, persistAccounts: store.save, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (endpoint, data, session = {}, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/${endpoint}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie || '', 'X-CSRF-Token': session.csrf || '', ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const login = async (id = 'group-1', password = initial) => {
    const response = await request('login', { deviceId: id, password });
    if (response.status !== 200) return { status: response.status };
    const session = { cookie: response.headers.get('set-cookie').split(';')[0] };
    session.csrf = (await (await request('session', undefined, session)).json()).csrf;
    return session;
  };
  const change = (session, data = {}, headers = {}) => request('change-password', { oldPassword: initial, newPassword: changed, confirmPassword: changed, ...data }, session, headers);
  return { store, file, seed, request, login, change };
}

test('six-character group password persists, revokes all group sessions and leaves other groups intact', async t => {
  const f = await fixture(t);
  const a = await f.login(), b = await f.login(), other = await f.login('group-2');
  const response = await f.change(a);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  for (const session of [a, b]) {
    for (const endpoint of ['session', 'messages', 'events']) assert.equal((await f.request(endpoint, undefined, session)).status, 401);
    assert.equal((await f.request('command', { deviceId: 'group-1', command: { led: true } }, session)).status, 401);
  }
  assert.equal((await f.request('session', undefined, other)).status, 200);
  assert.equal((await f.login()).status, 401);
  assert.ok((await f.login('group-1', changed)).cookie);
  const stored = await readFile(f.file, 'utf8');
  assert.ok(!stored.includes(changed));
  const loaded = await createAccountStore(f.file, f.seed);
  const account = loaded.accounts.find(item => item.id === 'group-1');
  assert.equal((await hashPassword(changed, account.salt)).hash, account.hash);
  assert.notEqual(account.hash, (await hashPassword(initial, account.salt)).hash);
  assert.deepEqual(await readdir(path.dirname(f.file)), ['accounts.json']);
});

test('password change rejects unauthenticated, cross-origin, CSRF, wrong-old and invalid inputs', async t => {
  const f = await fixture(t); const session = await f.login();
  assert.equal((await f.change({})).status, 401);
  assert.equal((await f.change(session, {}, { Origin: 'https://other.invalid' })).status, 403);
  assert.equal((await f.change(session, {}, { 'X-CSRF-Token': '' })).status, 403);
  for (const data of [
    { deviceId: 'group-2' }, { oldPassword: { $ne: null } }, { newPassword: ['injection'] },
    { newPassword: 'short', confirmPassword: 'short' }, { confirmPassword: 'mismatch' },
    { newPassword: initial, confirmPassword: initial }, { newPassword: ' '.repeat(12), confirmPassword: ' '.repeat(12) },
    { newPassword: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) },
  ]) assert.equal((await f.change(session, data)).status, 400);
  assert.equal((await f.change(session, { oldPassword: "' OR 1=1 --" })).status, 403);
  assert.equal((await f.request('session', undefined, session)).status, 200);
  assert.ok((await f.login()).cookie);
});

test('wrong old-password attempts are limited across sessions of the same group', async t => {
  const f = await fixture(t); const a = await f.login(), b = await f.login();
  for (let i = 0; i < 5; i++) assert.equal((await f.change(i % 2 ? a : b, { oldPassword: 'wrong' })).status, 403);
  assert.equal((await f.change(b)).status, 429);
  const other = await f.login('group-2');
  assert.equal((await f.change(other)).status, 200);
});

test('failed password persistence keeps the previous password and existing sessions', async t => {
  const f = await fixture(t, { persistAccounts: async () => { throw new Error('disk unavailable'); } });
  const a = await f.login();
  assert.equal((await f.change(a)).status, 500);
  assert.equal((await f.request('session', undefined, a)).status, 200);
  assert.ok((await f.login()).cookie);
  assert.equal((await f.login('group-1', changed)).status, 401);
});

test('concurrent changes cannot overwrite another group or reuse a revoked group session', async t => {
  const f = await fixture(t); const a = await f.login(), b = await f.login(), other = await f.login('group-2');
  const responses = await Promise.all([f.change(a), f.change(b), f.change(other)]);
  assert.deepEqual(responses.map(r => r.status), [200, 401, 200]);
  const loaded = await createAccountStore(f.file, f.seed);
  for (const account of loaded.accounts) assert.equal(account.hash, (await hashPassword(changed, account.salt)).hash);
});
