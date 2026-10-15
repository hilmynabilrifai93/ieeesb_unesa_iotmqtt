import { getSession, apiPost, updateActivity } from './auth.js?v=20261002-idle';
let client = null;
let statusListener = () => {};
export function getDeviceConfiguration() {
  const session = getSession();
  if (!session) throw new Error('Login diperlukan.');
  return { defaultDeviceId: session.defaultDeviceId, devices: session.devices };
}
export function publishDeviceCommand(deviceId, command, { waitForCompletion = false } = {}) {
  if (!client?.connected || deviceId !== getSession()?.defaultDeviceId) return false;
  const delivery = apiPost('command', { deviceId, command }).then(() => true).catch(error => {
    console.error(error.message);
    document.dispatchEvent(new CustomEvent('command-error', { detail: error.message }));
    return false;
  });
  return waitForCompletion ? delivery : true;
}
export function startMqtt({ onStatus, onMessage } = {}) {
  if (client) return client;
  statusListener = onStatus || (() => {});
  statusListener('Menghubungkan');
  const active = { connected: false, timer: null, abort: null, seen: new Map() };
  client = active;
  async function poll() {
    active.abort = new AbortController();
    const timeout = setTimeout(() => active.abort.abort(), 8000);
    try {
      const response = await fetch(`/api/messages?t=${crypto.randomUUID()}`, { cache: 'no-store', signal: active.abort.signal });
      if (client !== active) return;
      if (response.status === 401) { location.reload(); return; }
      if (!response.ok) throw new Error('Data MQTT tidak tersedia.');
      const data = await response.json();
      const { status, messages } = data;
      if (client !== active) return;
      updateActivity(data);
      active.connected = status === 'MQTT terhubung';
      statusListener(status);
      for (const message of messages) {
        if (active.seen.get(message.topic) === message.at) continue;
        active.seen.set(message.topic, message.at);
        onMessage?.(message);
      }
    } catch {
      if (client === active) { active.connected = false; statusListener('Menghubungkan ulang'); }
    } finally {
      clearTimeout(timeout);
      if (client === active) active.timer = setTimeout(poll, 750);
    }
  }
  poll();
  return active;
}
export function stopMqtt() {
  if (!client) return false;
  const active = client; client = null;
  clearTimeout(active.timer); active.abort?.abort();
  statusListener('MQTT terputus');
  return true;
}
