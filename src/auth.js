let session = null;
export const getSession = () => session;
export function updateActivity(data) {
  if (session && Number.isFinite(data?.idleExpiresAt)) session.idleExpiresAt = data.idleExpiresAt;
}
export async function loadSession() {
  const response = await fetch(`/api/session?t=${crypto.randomUUID()}`, { cache: 'no-store' });
  session = response.ok ? await response.json() : null;
  return session;
}
export async function apiPost(path, data) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'X-CSRF-Token': session.csrf } : {}) },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Permintaan gagal.');
  return result;
}
