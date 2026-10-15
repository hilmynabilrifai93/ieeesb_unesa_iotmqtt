export const DASHBOARD_MODES = Object.freeze(['simulation', 'mqtt']);

export function isDashboardMode(value) {
  return DASHBOARD_MODES.includes(value);
}

export function getInitialDashboardMode(storage, defaultMode = 'mqtt', storageKey = 'ieee-dashboard-mode') {
  const fallback = isDashboardMode(defaultMode) ? defaultMode : 'mqtt';
  try {
    const stored = storage?.getItem(storageKey);
    return isDashboardMode(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function getBrokerDisplayStatus(mode, brokerStatus) {
  return mode === 'simulation' ? 'Mode simulasi' : brokerStatus;
}

export function createModeController({
  initialMode = 'mqtt',
  storage,
  storageKey = 'ieee-dashboard-mode',
  simulationIntervalMs = 2000,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  onSimulationTick = () => {},
  connectMqtt = () => {},
  disconnectMqtt = () => {},
  onModeChange = () => {},
} = {}) {
  let mode = null;
  let simulationTimer = null;
  let mqttActive = false;

  function stopSimulation() {
    if (simulationTimer === null) return;
    clearIntervalFn(simulationTimer);
    simulationTimer = null;
  }

  function startSimulation() {
    if (simulationTimer !== null) return;
    simulationTimer = setIntervalFn(onSimulationTick, simulationIntervalMs);
  }

  function stopMqttMode() {
    if (!mqttActive) return;
    mqttActive = false;
    disconnectMqtt();
  }

  function startMqttMode() {
    if (mqttActive) return;
    mqttActive = true;
    connectMqtt();
  }

  function setMode(nextMode, { persist = true } = {}) {
    if (!isDashboardMode(nextMode)) return false;
    if (mode === nextMode) return false;

    if (mode === 'simulation') stopSimulation();
    if (mode === 'mqtt') stopMqttMode();

    mode = nextMode;
    if (mode === 'simulation') startSimulation();
    if (mode === 'mqtt') startMqttMode();

    if (persist) {
      try { storage?.setItem(storageKey, mode); } catch { /* Storage may be unavailable. */ }
    }
    onModeChange(mode);
    return true;
  }

  function destroy() {
    stopSimulation();
    stopMqttMode();
    mode = null;
  }

  setMode(isDashboardMode(initialMode) ? initialMode : 'mqtt', { persist: false });

  return {
    destroy,
    getMode: () => mode,
    hasSimulationTimer: () => simulationTimer !== null,
    isMqttActive: () => mqttActive,
    setMode,
  };
}
