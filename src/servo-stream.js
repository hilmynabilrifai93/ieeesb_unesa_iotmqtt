// Send during dragging, retaining only the latest unsent angle.
export function createServoStream(send, {
  intervalMs = 80, now = Date.now,
  schedule = setTimeout, unschedule = clearTimeout,
} = {}) {
  let pending = null, timer = null, busy = false;
  let lastSentAt = -Infinity, generation = 0;
  function cancel() {
    generation++;
    pending = null;
    if (timer !== null) unschedule(timer);
    timer = null;
    lastSentAt = -Infinity;
  }
  function pump() {
    if (busy || !pending) return;
    const delay = pending.final ? 0 : Math.max(0, intervalMs - (now() - lastSentAt));
    if (delay > 0) {
      if (timer === null) timer = schedule(() => { timer = null; pump(); }, delay);
      return;
    }
    if (timer !== null) unschedule(timer);
    timer = null;
    const command = pending, version = generation;
    pending = null;
    busy = true;
    lastSentAt = now();
    Promise.resolve().then(() => version === generation ? send(command) : false)
      .then(ok => { if (ok === false && version === generation) cancel(); })
      .catch(() => { if (version === generation) cancel(); })
      .finally(() => { busy = false; pump(); });
  }
  function queue(angle, deviceId, final) {
    pending = { angle, deviceId, final };
    pump();
  }
  return {
    input: (angle, deviceId) => queue(angle, deviceId, false),
    commit: (angle, deviceId) => queue(angle, deviceId, true),
    cancel,
  };
}
