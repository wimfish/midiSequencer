/**
 * Fase 3 — centrale MIDI-laag: één importpunt boven de views.
 * Transport blijft globaal; engine doet I/O; session store houdt routing per device.
 */

import {
  getMidiSessionDevice,
  setMidiSessionDevice,
  getMidiSessionSnapshot,
  subscribeMidiSession
} from "./midiSessionStore.js";

export * from "./transport.js";
export { resolveMidiOutput, sendTransportToOutput, sendClockToOutput } from "./engine.js";
export { requestMidiAccess, listMidiOutputs } from "./access.js";
export {
  getMidiSessionDevice,
  setMidiSessionDevice,
  getMidiSessionSnapshot,
  subscribeMidiSession
};

/** Keys voor `getMidiSessionDevice` / conflict-check. */
export const MIDI_DEVICE = Object.freeze({
  STYLE: "style",
  FM: "fm"
});

/** Schrijft Drum-sequencer routing naar de session store (view-`state`-object). */
export function persistStyleMidiSession(state) {
  return setMidiSessionDevice(MIDI_DEVICE.STYLE, {
    midiEnabled: state.midiEnabled,
    midiOutputActive: state.midiOutputActive,
    midiOutputId: state.midiOutputId,
    midiClockEnabled: state.midiClockEnabled,
    midiTransportCommands: state.midiTransportCommands
  });
}

/** Schrijft FM-sequencer routing naar de session store. */
export function persistFmMidiSession(state) {
  return setMidiSessionDevice(MIDI_DEVICE.FM, {
    midiEnabled: state.midiEnabled,
    midiOutputActive: state.midiOutputActive,
    midiOutputId: state.midiOutputId,
    midiChannel: state.midiChannel,
    midiClockEnabled: state.midiClockEnabled
  });
}

/** `persistMidiSessionFromState(MIDI_DEVICE.STYLE, state)` — dispatch naar Style of FM. */
export function persistMidiSessionFromState(deviceKey, state) {
  if (deviceKey === MIDI_DEVICE.STYLE) return persistStyleMidiSession(state);
  if (deviceKey === MIDI_DEVICE.FM) return persistFmMidiSession(state);
  return null;
}

/**
 * Waarschuwing als Style én FM dezelfde output tegelijk actief gebruiken (session-snapshot).
 */
export function evaluateMidiRoutingConflict(fromDevice) {
  const { style, fm } = getMidiSessionSnapshot();
  if (!style.midiOutputId || style.midiOutputId !== fm.midiOutputId) {
    return { hasConflict: false };
  }
  if (!style.midiEnabled || !fm.midiEnabled) return { hasConflict: false };
  if (!style.midiOutputActive || !fm.midiOutputActive) return { hasConflict: false };

  const otherLabel = fromDevice === MIDI_DEVICE.STYLE ? "FM" : "Drum";
  return { hasConflict: true, otherLabel };
}
