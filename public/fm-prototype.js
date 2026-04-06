const NOTE_ROWS = [
  { name: "B4", midi: 71 },
  { name: "A#4", midi: 70 },
  { name: "A4", midi: 69 },
  { name: "G#4", midi: 68 },
  { name: "G4", midi: 67 },
  { name: "F#4", midi: 66 },
  { name: "F4", midi: 65 },
  { name: "E4", midi: 64 },
  { name: "D#4", midi: 63 },
  { name: "D4", midi: 62 },
  { name: "C#4", midi: 61 },
  { name: "C4", midi: 60 }
];

const STORAGE_KEY = "volca-fm-prototype-v1";

const state = {
  steps: 16,
  tempo: 132,
  gate: 70,
  octaveShift: 0,
  isPlaying: false,
  currentStep: 0,
  cursorStep: 0,
  pattern: Array.from({ length: 16 }, () => null),
  midiEnabled: true,
  midiAccess: null,
  midiOutputs: [],
  midiOutputId: "",
  midiChannel: 1,
  timerId: null,
  audioContext: null
};

const els = {
  playBtn: document.getElementById("playBtn"),
  stopBtn: document.getElementById("stopBtn"),
  clearBtn: document.getElementById("clearBtn"),
  saveBtn: document.getElementById("saveBtn"),
  loadBtn: document.getElementById("loadBtn"),
  tempoInput: document.getElementById("tempoInput"),
  stepCountSelect: document.getElementById("stepCountSelect"),
  gateInput: document.getElementById("gateInput"),
  octaveShift: document.getElementById("octaveShift"),
  midiEnable: document.getElementById("midiEnable"),
  midiOutputSelect: document.getElementById("midiOutputSelect"),
  midiChannelSelect: document.getElementById("midiChannelSelect"),
  statusText: document.getElementById("statusText"),
  cursorInfo: document.getElementById("cursorInfo"),
  gridHeader: document.getElementById("gridHeader"),
  noteLabels: document.getElementById("noteLabels"),
  grid: document.getElementById("grid"),
  pianoKeys: document.getElementById("pianoKeys")
};

function setStatus(text) {
  els.statusText.textContent = text;
}

function noteNameFromMidi(midi) {
  const found = NOTE_ROWS.find((row) => row.midi === midi);
  if (found) return found.name;

  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getStepMidi(stepIndex) {
  return state.pattern[stepIndex];
}

function setStepMidi(stepIndex, midiNote) {
  if (state.pattern[stepIndex] === midiNote) {
    state.pattern[stepIndex] = null;
    setStatus(`Step ${stepIndex + 1} uit`);
  } else {
    state.pattern[stepIndex] = midiNote;
    setStatus(`Step ${stepIndex + 1} → ${noteNameFromMidi(midiNote)}`);
  }
  render();
}

function forceStepMidi(stepIndex, midiNote) {
  state.pattern[stepIndex] = midiNote;
  setStatus(`Step ${stepIndex + 1} → ${noteNameFromMidi(midiNote)}`);
  render();
}

function clearPattern() {
  state.pattern = Array.from({ length: state.steps }, () => null);
  state.currentStep = 0;
  state.cursorStep = 0;
  render();
  setStatus("Pattern gewist");
}

function resizePattern(nextSteps) {
  const next = Array.from({ length: nextSteps }, (_, i) => state.pattern[i] ?? null);
  state.steps = nextSteps;
  state.pattern = next;
  state.currentStep = 0;
  state.cursorStep = clamp(state.cursorStep, 0, state.steps - 1);
  render();
}

function updateCursorInfo() {
  const midi = getStepMidi(state.cursorStep);
  els.cursorInfo.textContent = `Step ${state.cursorStep + 1} · ${midi === null ? "leeg" : noteNameFromMidi(midi)}`;
}

function buildHeader() {
  els.gridHeader.innerHTML = "";
  for (let i = 0; i < state.steps; i += 1) {
    const el = document.createElement("div");
    el.className = `header-step${state.isPlaying && state.currentStep === i ? " current" : ""}`;
    el.textContent = i + 1;
    els.gridHeader.appendChild(el);
  }
}

function buildLabels() {
  els.noteLabels.innerHTML = "";
  NOTE_ROWS.forEach((row) => {
    const el = document.createElement("div");
    const root = row.name.startsWith("C") || row.name.startsWith("F");
    el.className = `note-label${root ? " root" : ""}`;
    el.textContent = row.name;
    els.noteLabels.appendChild(el);
  });
}

function renderGrid() {
  els.grid.innerHTML = "";
  NOTE_ROWS.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "grid-row";

    for (let stepIndex = 0; stepIndex < state.steps; stepIndex += 1) {
      const cell = document.createElement("button");
      cell.type = "button";

      const stepMidi = getStepMidi(stepIndex);
      const isActive = stepMidi === row.midi + Number(state.octaveShift);
      const isCursor = state.cursorStep === stepIndex;
      const isPlaying = state.isPlaying && state.currentStep === stepIndex;

      cell.className = `cell${isActive ? " active" : ""}${isCursor ? " cursor" : ""}${isPlaying ? " playing" : ""}`;
      cell.textContent = isActive ? "●" : "";
      cell.dataset.step = String(stepIndex);
      cell.dataset.midi = String(row.midi + Number(state.octaveShift));

      cell.addEventListener("click", () => {
        state.cursorStep = stepIndex;
        setStepMidi(stepIndex, row.midi + Number(state.octaveShift));
      });

      rowEl.appendChild(cell);
    }

    els.grid.appendChild(rowEl);
  });
}

function renderPianoKeys() {
  els.pianoKeys.innerHTML = "";

  NOTE_ROWS.slice().reverse().forEach((row) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `piano-key${row.name.includes("#") ? " black" : ""}`;
    btn.textContent = row.name;

    btn.addEventListener("click", () => {
      const midi = row.midi + Number(state.octaveShift);
      forceStepMidi(state.cursorStep, midi);
      previewNote(midi, 110, 180);
    });

    els.pianoKeys.appendChild(btn);
  });
}

function render() {
  buildHeader();
  buildLabels();
  renderGrid();
  renderPianoKeys();
  updateCursorInfo();
}

function getMidiOutput() {
  if (!state.midiEnabled || !state.midiOutputId) return null;
  return state.midiOutputs.find((output) => output.id === state.midiOutputId) || null;
}

function sendMidiNote(midiNote, velocity = 110, durationMs = 180) {
  const output = getMidiOutput();
  if (!output) return false;

  const channel = clamp(Number(state.midiChannel), 1, 16) - 1;
  const noteOn = 0x90 + channel;
  const noteOff = 0x80 + channel;

  output.send([noteOn, midiNote, velocity]);
  window.setTimeout(() => {
    output.send([noteOff, midiNote, 0]);
  }, durationMs);

  return true;
}

function ensureAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioContext;
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function previewNote(midiNote, velocity = 100, durationMs = 180) {
  const sent = sendMidiNote(midiNote, velocity, durationMs);
  if (sent) return;

  const ctx = ensureAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();

  osc1.type = "sine";
  osc2.type = "triangle";

  osc1.frequency.value = midiToFrequency(midiNote);
  osc2.frequency.value = midiToFrequency(midiNote) * 2;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + durationMs / 1000 + 0.02);
  osc2.stop(now + durationMs / 1000 + 0.02);
}

function stepDurationMs() {
  return (60 / state.tempo / 4) * 1000;
}

function playCurrentStep() {
  render();

  const midi = getStepMidi(state.currentStep);
  if (midi !== null) {
    const duration = Math.max(40, Math.floor(stepDurationMs() * (state.gate / 100)));
    previewNote(midi, 112, duration);
  }

  state.currentStep = (state.currentStep + 1) % state.steps;
}

function startPlayback() {
  if (state.isPlaying) return;
  state.isPlaying = true;
  setStatus("Playback gestart");
  playCurrentStep();
  state.timerId = window.setInterval(playCurrentStep, stepDurationMs());
  render();
}

function stopPlayback() {
  state.isPlaying = false;
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
  state.currentStep = 0;
  render();
  setStatus("Playback gestopt");
}

function restartPlaybackIfNeeded() {
  if (!state.isPlaying) return;
  window.clearInterval(state.timerId);
  playCurrentStep();
  state.timerId = window.setInterval(playCurrentStep, stepDurationMs());
}

function savePattern() {
  const payload = {
    steps: state.steps,
    tempo: state.tempo,
    gate: state.gate,
    octaveShift: state.octaveShift,
    pattern: state.pattern,
    midiChannel: state.midiChannel
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  setStatus("Prototype opgeslagen");
}

function loadPattern() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    setStatus("Geen opgeslagen pattern gevonden");
    return;
  }

  try {
    const data = JSON.parse(raw);
    state.steps = Number(data.steps) || 16;
    state.tempo = Number(data.tempo) || 132;
    state.gate = Number(data.gate) || 70;
    state.octaveShift = Number(data.octaveShift) || 0;
    state.pattern = Array.from({ length: state.steps }, (_, i) => data.pattern?.[i] ?? null);
    state.midiChannel = Number(data.midiChannel) || 1;

    els.stepCountSelect.value = String(state.steps);
    els.tempoInput.value = String(state.tempo);
    els.gateInput.value = String(state.gate);
    els.octaveShift.value = String(state.octaveShift);
    els.midiChannelSelect.value = String(state.midiChannel);

    state.cursorStep = clamp(state.cursorStep, 0, state.steps - 1);
    render();
    setStatus("Prototype geladen");
  } catch (error) {
    setStatus("Load fout");
    console.error(error);
  }
}

async function initMidi() {
  if (!("requestMIDIAccess" in navigator)) {
    setStatus("Web MIDI niet beschikbaar, browser audio actief");
    return;
  }

  try {
    state.midiAccess = await navigator.requestMIDIAccess();
    state.midiOutputs = [...state.midiAccess.outputs.values()];
    populateMidiOutputs();

    state.midiAccess.onstatechange = () => {
      state.midiOutputs = [...state.midiAccess.outputs.values()];
      populateMidiOutputs();
    };

    setStatus("MIDI klaar");
  } catch (error) {
    setStatus("MIDI toestemming geweigerd");
    console.error(error);
  }
}

function populateMidiOutputs() {
  els.midiOutputSelect.innerHTML = `<option value="">Geen output</option>`;

  state.midiOutputs.forEach((output) => {
    const option = document.createElement("option");
    option.value = output.id;
    option.textContent = output.name || "Onbekende output";
    els.midiOutputSelect.appendChild(option);
  });

  if (state.midiOutputs.length && !state.midiOutputId) {
    state.midiOutputId = state.midiOutputs[0].id;
  }

  els.midiOutputSelect.value = state.midiOutputId;
}

function populateChannels() {
  for (let i = 1; i <= 16; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = String(i);
    els.midiChannelSelect.appendChild(option);
  }
  els.midiChannelSelect.value = String(state.midiChannel);
}

function moveCursor(delta) {
  state.cursorStep = (state.cursorStep + delta + state.steps) % state.steps;
  render();
}

function transposeCursor(delta) {
  const current = getStepMidi(state.cursorStep);
  if (current === null) {
    const base = 60 + Number(state.octaveShift);
    state.pattern[state.cursorStep] = clamp(base + delta, 48, 84);
  } else {
    state.pattern[state.cursorStep] = clamp(current + delta, 48, 84);
  }
  render();
  setStatus(`Step ${state.cursorStep + 1} → ${noteNameFromMidi(state.pattern[state.cursorStep])}`);
}

function toggleCursorStep() {
  const current = getStepMidi(state.cursorStep);
  if (current === null) {
    state.pattern[state.cursorStep] = 60 + Number(state.octaveShift);
    setStatus(`Step ${state.cursorStep + 1} aan`);
  } else {
    state.pattern[state.cursorStep] = null;
    setStatus(`Step ${state.cursorStep + 1} uit`);
  }
  render();
}

function bindEvents() {
  els.playBtn.addEventListener("click", () => {
    if (state.isPlaying) stopPlayback();
    else startPlayback();
  });

  els.stopBtn.addEventListener("click", stopPlayback);
  els.clearBtn.addEventListener("click", clearPattern);
  els.saveBtn.addEventListener("click", savePattern);
  els.loadBtn.addEventListener("click", loadPattern);

  els.tempoInput.addEventListener("change", () => {
    state.tempo = clamp(Number(els.tempoInput.value) || 132, 40, 240);
    els.tempoInput.value = String(state.tempo);
    restartPlaybackIfNeeded();
  });

  els.stepCountSelect.addEventListener("change", () => {
    resizePattern(Number(els.stepCountSelect.value));
    restartPlaybackIfNeeded();
  });

  els.gateInput.addEventListener("change", () => {
    state.gate = clamp(Number(els.gateInput.value) || 70, 5, 95);
    els.gateInput.value = String(state.gate);
  });

  els.octaveShift.addEventListener("change", () => {
    state.octaveShift = Number(els.octaveShift.value) || 0;
    render();
  });

  els.midiEnable.addEventListener("change", () => {
    state.midiEnabled = els.midiEnable.checked;
    setStatus(state.midiEnabled ? "MIDI aan" : "MIDI uit, browser audio actief");
  });

  els.midiOutputSelect.addEventListener("change", () => {
    state.midiOutputId = els.midiOutputSelect.value;
    setStatus(state.midiOutputId ? "MIDI output gekozen" : "Geen MIDI output gekozen");
  });

  els.midiChannelSelect.addEventListener("change", () => {
    state.midiChannel = Number(els.midiChannelSelect.value) || 1;
    setStatus(`MIDI kanaal ${state.midiChannel}`);
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

    if (event.code === "Space" && !typing) {
      event.preventDefault();
      if (state.isPlaying) stopPlayback();
      else startPlayback();
      return;
    }

    if (typing) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveCursor(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveCursor(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      transposeCursor(1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      transposeCursor(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      toggleCursorStep();
      return;
    }
  });
}

function init() {
  populateChannels();
  bindEvents();
  render();
  initMidi();
}

init();