import http from 'node:http';
import { randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createCommandPayload, parseDeviceTopic } from '../src/device-store.js';

const scrypt = promisify(derive);
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
}
export function validCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return false;
  const keys = Object.keys(command);
  if (!keys.length || keys.length > 2) return false;
  if (keys.length === 2 && !(keys.includes('servo') && keys.some(key => /^led([1-8])?$/.test(key)))) return false;
  return keys.every(key => {
    if (!createCommandPayload(key, command[key])) return false;
    if (key === 'lcd') return Object.keys(command.lcd).length === 2 && /^[ -~]*$/.test(command.lcd.line1 + command.lcd.line2);
    return true;
  });
}

export function createAuthServer({ accounts, broker, origin, secureCookie = true, sessionMs = 8 * 3600000, idleMs = 30 * 60000, clock = Date.now, persistAccounts }) {
  const sessions = new Map(), attempts = new Map(), streams = new Set(), cache = new Map();
  const passwordAttempts = new Map();
  let passwordQueue = Promise.resolve();
  const definitions = accounts.map(({ id, name }) => ({ id, name }));
  const ids = new Set(definitions.map(device => device.id));
  const cookie = (value, age) => `hint_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookie ? '; Secure' : ''}`;
  const send = (res, code, data, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(data));
  };
  const event = (res, name, value) => res.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
  const deadline = session => Math.min(session.expires, session.lastActivity + idleMs);
  const live = session => session && deadline(session) > clock();
  const activityInfo = session => ({ idleExpiresAt: deadline(session), idleTimeoutMs: idleMs });
  function getSession(req) {
    const token = /(?:^|;\s*)hint_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const session = sessions.get(token);
    if (!live(session)) { if (token) sessions.delete(token); return null; }
    return session;
  }
  async function body(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) throw new Error('JSON required');
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 2048) throw new Error('Body too large'); }
    return JSON.parse(text);
  }
  broker.on('message', (topic, buffer) => {
    const parsed = parseDeviceTopic(topic);
    if (!parsed || !ids.has(parsed.deviceId) || parsed.channel === 'command' || buffer.length > 16384) return;
    const message = { topic, payload: buffer.toString(), at: Date.now() };
    cache.set(topic, message);
    for (const stream of streams) if (stream.session.deviceId === parsed.deviceId && live(stream.session)) event(stream.res, 'message', message);
  });
  for (const name of ['connect', 'close', 'offline']) broker.on(name, () => {
    for (const stream of streams) event(stream.res, 'status', broker.connected ? 'MQTT terhubung' : 'MQTT terputus');
  });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, origin).pathname;
    try {
      if (req.method === 'POST' && req.headers.origin !== origin) return send(res, 403, { error: 'Origin tidak diizinkan.' });
      if (req.method === 'GET' && pathname === '/api/devices') return send(res, 200, { devices: definitions });
      if (req.method === 'POST' && pathname === '/api/login') {
        const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
        const now = clock();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const attempt = attempts.get(ip) || { count: 0, until: now + 300000 };
        if (attempt.count >= 10 || attempts.size >= 10000) return send(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi dalam 5 menit.' });
        attempt.count++; attempts.set(ip, attempt);
        const data = await body(req);
        const account = accounts.find(item => item.id === data.deviceId);
        const password = typeof data.password === 'string' && data.password.length <= 128 ? data.password : '';
        const salt = account?.salt, hash = account?.hash;
        const computed = await scrypt(password, salt || 'invalid-account-salt', 64);
        const expected = account ? Buffer.from(hash, 'hex') : Buffer.alloc(64);
        if (!account || account.hash !== hash || !timingSafeEqual(computed, expected)) return send(res, 401, { error: 'Perangkat atau password salah.' });
        attempts.delete(ip);
        for (const [key, value] of sessions) if (!live(value)) sessions.delete(key);
        if (sessions.size >= 1000) return send(res, 503, { error: 'Sesi penuh. Coba lagi nanti.' });
        const previous = getSession(req); if (previous) sessions.delete(previous.token);
        const token = randomBytes(32).toString('hex');
        sessions.set(token, { token, deviceId: account.id, csrf: randomBytes(24).toString('hex'), expires: now + sessionMs, lastActivity: now });
        return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(token, Math.floor(sessionMs / 1000)) });
      }
      const session = getSession(req);
      if (!session) return send(res, 401, { error: 'Silakan login.' });
      if (req.method === 'GET' && pathname === '/api/session') return send(res, 200, {
        defaultDeviceId: session.deviceId, devices: definitions.filter(item => item.id === session.deviceId), csrf: session.csrf, ...activityInfo(session),
      });
      if (req.method === 'GET' && pathname === '/api/messages') return send(res, 200, {
        status: broker.connected ? 'MQTT terhubung' : 'MQTT terputus',
        ...activityInfo(session),
        messages: [...cache.values()].filter(message => {
          const parsed = parseDeviceTopic(message.topic);
          return parsed.deviceId === session.deviceId && (parsed.channel === 'state' || Date.now() - message.at < 10000);
        }),
      });
      if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) return send(res, 403, { error: 'Sesi tidak valid.' });
      if (req.method === 'POST' && pathname === '/api/change-password') {
        const data = await body(req);
        if (!data || typeof data !== 'object' || Array.isArray(data)
          || Object.keys(data).some(key => !['oldPassword', 'newPassword', 'confirmPassword'].includes(key))) {
          return send(res, 400, { error: 'Permintaan ganti password tidak valid.' });
        }
        if (typeof data.oldPassword !== 'string' || !data.oldPassword.length || data.oldPassword.length > 128
          || typeof data.newPassword !== 'string' || data.newPassword.length < 6 || data.newPassword.length > 128
          || !data.newPassword.trim()) {
          return send(res, 400, { error: 'Password baru harus 6-128 karakter.' });
        }
        if (data.newPassword !== data.confirmPassword) return send(res, 400, { error: 'Konfirmasi password baru tidak cocok.' });
        if (data.oldPassword === data.newPassword) return send(res, 400, { error: 'Password baru harus berbeda dari password lama.' });
        if (typeof persistAccounts !== 'function') return send(res, 503, { error: 'Penyimpanan password belum tersedia.' });
        // Serialize verification and durable writes, including requests from other sessions.
        const change = passwordQueue.then(async () => {
          if (!live(session) || !sessions.has(session.token)) return send(res, 401, { error: 'Silakan login kembali.' });
          const now = clock();
          for (const [id, value] of passwordAttempts) if (value.until <= now) passwordAttempts.delete(id);
          const attempt = passwordAttempts.get(session.deviceId) || { count: 0, until: now + 300000 };
          if (attempt.count >= 5) return send(res, 429, { error: 'Terlalu banyak percobaan password lama. Coba lagi dalam 5 menit.' });
          attempt.count++; passwordAttempts.set(session.deviceId, attempt);
          const account = accounts.find(item => item.id === session.deviceId);
          const computed = await scrypt(data.oldPassword, account.salt, 64);
          if (!timingSafeEqual(computed, Buffer.from(account.hash, 'hex'))) return send(res, 403, { error: 'Password lama salah.' });
          const replacement = { ...account, ...await hashPassword(data.newPassword) };
          const updated = accounts.map(item => item.id === account.id ? replacement : { ...item });
          try { await persistAccounts(updated); }
          catch { return send(res, 500, { error: 'Password belum berhasil disimpan. Coba lagi.' }); }
          Object.assign(account, replacement);
          passwordAttempts.delete(account.id);
          for (const [token, value] of sessions) if (value.deviceId === account.id) sessions.delete(token);
          for (const stream of streams) if (stream.session.deviceId === account.id) { event(stream.res, 'expired', {}); stream.res.end(); }
          return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
        });
        passwordQueue = change.catch(() => {});
        await change;
        return;
      }
      if (req.method === 'POST' && pathname === '/api/activity') {
        session.lastActivity = clock();
        return send(res, 200, activityInfo(session));
      }
      if (req.method === 'POST' && pathname === '/api/logout') {
        sessions.delete(session.token);
        for (const stream of streams) if (stream.session.token === session.token) { event(stream.res, 'expired', {}); stream.res.end(); }
        return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
      }
      if (req.method === 'POST' && pathname === '/api/command') {
        const data = await body(req);
        if (data.deviceId !== session.deviceId) return send(res, 403, { error: 'Akses perangkat ditolak.' });
        if (!validCommand(data.command)) return send(res, 400, { error: 'Perintah tidak valid.' });
        if (!broker.connected) return send(res, 503, { error: 'MQTT terputus.' });
        session.lastActivity = clock();
        const published = await new Promise(resolve => broker.publish(`ieee/lab/${session.deviceId}/command`, JSON.stringify(data.command), { qos: 0, retain: false }, error => resolve(!error)));
        return send(res, published ? 200 : 502, published ? { ok: true } : { error: 'Perintah gagal dikirim.' });
      }
      if (req.method === 'GET' && pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const stream = { res, session }; streams.add(stream);
        event(res, 'status', broker.connected ? 'MQTT terhubung' : 'MQTT terputus');
        for (const message of cache.values()) {
          const parsed = parseDeviceTopic(message.topic);
          if (parsed.deviceId === session.deviceId && (parsed.channel === 'state' || Date.now() - message.at < 10000)) event(res, 'message', message);
        }
        const timer = setInterval(() => {
          if (!live(session) || !sessions.has(session.token)) { event(res, 'expired', {}); res.end(); }
          else res.write(': heartbeat\n\n');
        }, 15000);
        res.on('close', () => { clearInterval(timer); streams.delete(stream); });
        return;
      }
      send(res, 404, { error: 'Tidak ditemukan.' });
    } catch { if (!res.headersSent) send(res, 400, { error: 'Permintaan tidak valid.' }); else res.end(); }
  });
  return server;
}
