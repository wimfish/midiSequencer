/**
 * Centrale MIDI-routing per interface (Style vs FM), los van pattern-draft.
 * Persisteert naar localStorage zodat een refresh dezelfde output/kanaal houdt.
 */

const STORAGE_KEY = "volca-midi-session-v1";

const defaults = {
  style: {
    midiEnabled: false,
    midiOutputActive: true,
    midiOutputId: "",
    midiClockEnabled: true,
    midiTransportCommands: false
  },
  fm: {
    midiEnabled: true,
    midiOutputActive: true,
    midiOutputId: "",
    midiChannel: 1
  }
};

const listeners = new Set();

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

function mergeDevice(key, partial) {
  const base = { ...defaults[key], ...readAll()[key], ...partial };
  return base;
}

export function getMidiSessionDevice(key) {
  return mergeDevice(key, {});
}

export function setMidiSessionDevice(key, partial) {
  const all = readAll();
  all[key] = mergeDevice(key, partial);
  writeAll(all);
  const snapshot = getMidiSessionSnapshot();
  listeners.forEach((fn) => fn(snapshot));
  return all[key];
}

export function getMidiSessionSnapshot() {
  return {
    style: getMidiSessionDevice("style"),
    fm: getMidiSessionDevice("fm")
  };
}

export function subscribeMidiSession(listener) {
  listeners.add(listener);
  listener(getMidiSessionSnapshot());
  return () => listeners.delete(listener);
}
