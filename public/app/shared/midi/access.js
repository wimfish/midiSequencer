export async function requestMidiAccess() {
  if (!("requestMIDIAccess" in navigator)) {
    return { ok: false, reason: "Web MIDI niet beschikbaar in deze browser." };
  }

  try {
    const access = await navigator.requestMIDIAccess();
    return { ok: true, access };
  } catch (err) {
    return { ok: false, reason: "MIDI toegang geweigerd.", err };
  }
}

export function listMidiOutputs(access) {
  if (!access) return [];
  return [...access.outputs.values()];
}

