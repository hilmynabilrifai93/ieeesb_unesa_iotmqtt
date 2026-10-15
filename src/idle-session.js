import { getSession, loadSession, apiPost, updateActivity } from './auth.js?v=20261002-idle';

// Only real user input refreshes idle time. Sensor polling and visibility do not.
export function startIdleLogout() {
  let lastSent = 0, pending = null, expiring = false;
  async function checkExpiry(force = false) {
    if (expiring || (force !== true && Date.now() < getSession()?.idleExpiresAt)) return;
    expiring = true;
    try {
      // A second tab may have refreshed the shared session.
      if (await loadSession()) return;
      location.reload();
    } catch { location.reload(); }
    finally { expiring = false; }
  }
  async function refresh() {
    pending = null;
    if (Date.now() >= getSession()?.idleExpiresAt) { await checkExpiry(); return; }
    lastSent = Date.now();
    try { updateActivity(await apiPost('activity', {})); }
    catch { await checkExpiry(); }
  }
  function onActivity(event) {
    if (!event.isTrusted || document.visibilityState !== 'visible') return;
    if (Date.now() >= getSession()?.idleExpiresAt) { checkExpiry(); return; }
    const throttleMs = Math.min(15000, (getSession()?.idleTimeoutMs || 1800000) / 4);
    const delay = throttleMs - (Date.now() - lastSent);
    if (delay <= 0) { clearTimeout(pending); refresh(); }
    else if (!pending) pending = setTimeout(refresh, delay);
  }
  for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) document.addEventListener(name, onActivity, { passive: true });
  document.addEventListener('visibilitychange', checkExpiry);
  window.addEventListener('pageshow', checkExpiry);
  setInterval(checkExpiry, 1000);
  // Detect a group password change even while this tab is in simulation.
  setInterval(() => checkExpiry(true), 15000);
}
