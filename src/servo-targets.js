// Persist the chosen target separately from device feedback and temporary drag preview.
export function createServoTargets(storage, key = 'ieee-servo-targets') {
  const targets = new Map();
  const valid = (angle) => Number.isInteger(angle) && angle >= 0 && angle <= 180;
  try {
    const saved = JSON.parse(storage?.getItem(key) || '{}');
    for (const [id, angle] of Object.entries(saved || {})) {
      if (valid(angle)) targets.set(id, angle);
    }
  } catch { /* Invalid/unavailable storage must not prevent dashboard startup. */ }
  return {
    get(id, fallback) { return targets.get(id) ?? fallback; },
    remember(id, angle) {
      if (!valid(angle)) return;
      targets.set(id, angle);
      try { storage?.setItem(key, JSON.stringify(Object.fromEntries(targets))); } catch {}
    },
    observe(id, angle) {
      if (!targets.has(id) && valid(angle)) this.remember(id, angle);
    },
    ledCommand(id, command) {
      const angle = targets.get(id);
      return angle === undefined ? command : { ...command, servo: angle };
    },
  };
}
