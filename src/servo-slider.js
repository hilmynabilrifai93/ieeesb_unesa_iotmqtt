// Keep the chosen angle visible while dragging and waiting for device feedback.
export function createServoSlider() {
  let preview = null;
  return {
    input(angle, deviceId) {
      preview = { angle, deviceId, editing: true, expiresAt: Infinity };
    },
    commit(now = Date.now()) {
      if (preview) {
        preview.editing = false;
        preview.expiresAt = now + 5000;
      }
    },
    angle(actual, deviceId, now = Date.now()) {
      if (preview && (preview.deviceId !== deviceId
        || (!preview.editing && (actual === preview.angle || now >= preview.expiresAt)))) {
        preview = null;
      }
      return preview ? preview.angle : actual;
    },
    clear() { preview = null; },
  };
}
