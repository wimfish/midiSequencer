const listeners = new Set();

const transportState = {
  bpm: 132,
  isPlaying: false,
  startedAtMs: 0
};

export function getTransportSnapshot() {
  return { ...transportState };
}

export function subscribeTransport(listener) {
  listeners.add(listener);
  listener(getTransportSnapshot());
  return () => listeners.delete(listener);
}

export function setTransportBpm(nextBpm) {
  const bpm = clamp(Number(nextBpm) || transportState.bpm, 40, 240);
  if (transportState.bpm === bpm) return getTransportSnapshot();

  if (transportState.isPlaying) {
    const elapsedMs = Math.max(0, performance.now() - transportState.startedAtMs);
    const elapsedSteps = elapsedMs / stepDurationMs(transportState.bpm);
    transportState.startedAtMs = performance.now() - elapsedSteps * stepDurationMs(bpm);
  }

  transportState.bpm = bpm;
  emit();
  return getTransportSnapshot();
}

export function startTransport() {
  if (transportState.isPlaying) return getTransportSnapshot();
  transportState.isPlaying = true;
  transportState.startedAtMs = performance.now();
  emit();
  return getTransportSnapshot();
}

export function stopTransport() {
  if (!transportState.isPlaying) return getTransportSnapshot();
  transportState.isPlaying = false;
  emit();
  return getTransportSnapshot();
}

export function getTransportStep(nowMs = performance.now()) {
  if (!transportState.isPlaying) return 0;
  const elapsedMs = Math.max(0, nowMs - transportState.startedAtMs);
  return Math.floor(elapsedMs / stepDurationMs(transportState.bpm));
}

export function stepDurationMs(bpm = transportState.bpm) {
  return (60 / clamp(Number(bpm) || transportState.bpm, 40, 240) / 4) * 1000;
}

function emit() {
  const snapshot = getTransportSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
