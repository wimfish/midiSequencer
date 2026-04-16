export function resolveMidiOutput({
  midiAccess,
  midiEnabled,
  midiOutputId,
  midiOutputActive = true
}) {
  if (!midiAccess || !midiEnabled || !midiOutputActive || !midiOutputId) return null;
  return midiAccess.outputs.get(midiOutputId) || null;
}

export function sendTransportToOutput({
  midiAccess,
  midiEnabled,
  midiOutputId,
  midiOutputActive = true,
  command
}) {
  const output = resolveMidiOutput({ midiAccess, midiEnabled, midiOutputId, midiOutputActive });
  if (!output) return false;
  const status = transportStatusByte(command);
  if (status === null) return false;
  output.send([status]);
  return true;
}

export function sendClockToOutput({
  midiAccess,
  midiEnabled,
  midiOutputId,
  midiOutputActive = true
}) {
  const output = resolveMidiOutput({ midiAccess, midiEnabled, midiOutputId, midiOutputActive });
  if (!output) return false;
  output.send([0xf8]);
  return true;
}

function transportStatusByte(command) {
  if (command === true || command === "start") return 0xfa;
  if (command === false || command === "stop") return 0xfc;
  if (command === "continue") return 0xfb;
  return null;
}
