const BASE_NOTE_ROWS = [
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

const KEYBOARD_MAP = [
  { key: "z", midi: 48, label: "C3", octaveGroup: 0 },
  { key: "s", midi: 49, label: "C#3", octaveGroup: 0 },
  { key: "x", midi: 50, label: "D3", octaveGroup: 0 },
  { key: "d", midi: 51, label: "D#3", octaveGroup: 0 },
  { key: "c", midi: 52, label: "E3", octaveGroup: 0 },
  { key: "v", midi: 53, label: "F3", octaveGroup: 0 },
  { key: "g", midi: 54, label: "F#3", octaveGroup: 0 },
  { key: "b", midi: 55, label: "G3", octaveGroup: 0 },
  { key: "h", midi: 56, label: "G#3", octaveGroup: 0 },
  { key: "n", midi: 57, label: "A3", octaveGroup: 0 },
  { key: "j", midi: 58, label: "A#3", octaveGroup: 0 },
  { key: "m", midi: 59, label: "B3", octaveGroup: 0 },

  { key: "q", midi: 60, label: "C4", octaveGroup: 1 },
  { key: "2", midi: 61, label: "C#4", octaveGroup: 1 },
  { key: "w", midi: 62, label: "D4", octaveGroup: 1 },
  { key: "3", midi: 63, label: "D#4", octaveGroup: 1 },
  { key: "e", midi: 64, label: "E4", octaveGroup: 1 },
  { key: "r", midi: 65, label: "F4", octaveGroup: 1 },
  { key: "5", midi: 66, label: "F#4", octaveGroup: 1 },
  { key: "t", midi: 67, label: "G4", octaveGroup: 1 },
  { key: "6", midi: 68, label: "G#4", octaveGroup: 1 },
  { key: "y", midi: 69, label: "A4", octaveGroup: 1 },
  { key: "7", midi: 70, label: "A#4", octaveGroup: 1 },
  { key: "u", midi: 71, label: "B4", octaveGroup: 1 }
];

const KEY_TO_MIDI = Object.fromEntries(KEYBOARD_MAP.map(item => [item.key, item.midi]));
const STORAGE_KEY = "volca-fm-prototype-v6";
const MAX_NOTES_PER_STEP = 3;

const state = {
  mode: "step",
  steps: 16,
  tempo: 132,
  gate: 70,
  octaveShift: 0,
  isPlaying: false,
  currentStep: 0,
  cursorStep: 0,
  cursorRow: BASE_NOTE_ROWS.findIndex(row => row.midi === 60),
  pattern: Array.from({ length: 16 }, () => []),
  midiEnabled: true,
  midiAccess: null,
  midiOutputs: [],
  midiOutputId: "",
  midiChannel: 1,
  timerId: null,
  audioContext: null,
  heldKeys: new Set(),
  deniedCellKey: null
};

const els = {
  playBtn: document.getElementById("playBtn"),
  stopBtn: document.getElementById("stopBtn"),
  clearBtn: document.getElementById("clearBtn"),
  saveBtn: document.getElementById("saveBtn"),
  loadBtn: document.getElementById("loadBtn"),
  modeSelect: document.getElementById("modeSelect"),
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
  pianoKeys: document.getElementById("pianoKeys"),
  modeHint: document.getElementById("modeHint")
};

function setStatus(text) {
  els.statusText.textContent = text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function noteNameFromMidi(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}

function getVisibleRows() {
  return BASE_NOTE_ROWS.map(row => {
    const midi = row.midi + Number(state.octaveShift);
    return {
      midi,
      name: noteNameFromMidi(midi)
    };
  });
}

function updateGridScale() {

  const totalWidth = window.innerWidth;
  const available = Math.min(1340, Math.max(720, totalWidth - 90));

  const labelWidth = state.steps >= 32 ? 62 : 72;
  const gap = state.steps >= 32 ? 3 : 4;
  const minStep = state.steps >= 32 ? 22 : state.steps >= 24 ? 28 : 44;
  const computedStep = Math.floor((available - labelWidth - 8 - (gap * (state.steps - 1))) / state.steps);
  const stepSize = clamp(computedStep, minStep, 44);
  const rowHeight = stepSize >= 40 ? 34 : stepSize >= 30 ? 30 : 26;

  document.documentElement.style.setProperty("--label-width", `${labelWidth}px`);
  document.documentElement.style.setProperty("--grid-gap", `${gap}px`);
  document.documentElement.style.setProperty("--step-size", `${stepSize}px`);
  document.documentElement.style.setProperty("--row-height", `${rowHeight}px`);
}

function normalizeStep(step) {
  if (!Array.isArray(step)) return [];
  const unique = [...new Set(step.map(Number).filter(Number.isFinite))];
  return unique.slice(0, MAX_NOTES_PER_STEP).sort((a, b) => a - b);
}

function createEmptyPattern(length) {
  return Array.from({ length }, () => []);
}

function getStepNotes(stepIndex) {
  return normalizeStep(state.pattern[stepIndex] || []);
}

function setStepNotes(stepIndex, notes) {
  state.pattern[stepIndex] = normalizeStep(notes);
}

function getCursorMidi() {
  return getVisibleRows()[state.cursorRow].midi;
}

function getCellKey(stepIndex, midiNote) {
  return `${stepIndex}:${midiNote}`;
}

function flashDenied(stepIndex, midiNote) {
  state.deniedCellKey = getCellKey(stepIndex, midiNote);
  render();
  window.setTimeout(() => {
    if (state.deniedCellKey === getCellKey(stepIndex, midiNote)) {
      state.deniedCellKey = null;
      render();
    }
  }, 180);
}

function toggleNoteInStep(stepIndex, midiNote) {
  const notes = getStepNotes(stepIndex);

  if (notes.includes(midiNote)) {
    setStepNotes(stepIndex, notes.filter(note => note !== midiNote));
    setStatus(`Step ${stepIndex + 1} noot verwijderd: ${noteNameFromMidi(midiNote)}`);
    render();
    return true;
  }

  if (notes.length >= MAX_NOTES_PER_STEP) {
    flashDenied(stepIndex, midiNote);
    setStatus(`Step ${stepIndex + 1} zit al vol (max 3 noten)`);
    return false;
  }

  setStepNotes(stepIndex, [...notes, midiNote]);
  setStatus(`Step ${stepIndex + 1} + ${noteNameFromMidi(midiNote)}`);
  render();
  return true;
}

function toggleCurrentCell() {
  const midiNote = getCursorMidi();
  toggleNoteInStep(state.cursorStep, midiNote);
}

function toggleStepOnOff(stepIndex) {
  const current = getStepNotes(stepIndex);
  if (current.length) {
    setStepNotes(stepIndex, []);
    setStatus(`Step ${stepIndex + 1} uit`);
  } else {
    setStepNotes(stepIndex, [60 + Number(state.octaveShift)]);
    setStatus(`Step ${stepIndex + 1} aan`);
  }
  render();
}

function clearPattern() {
  state.pattern = createEmptyPattern(state.steps);
  state.currentStep = 0;
  state.cursorStep = 0;
  state.cursorRow = BASE_NOTE_ROWS.findIndex(row => row.midi === 60);
  render();
  setStatus("Pattern gewist");
}

function resizePattern(nextSteps) {
  const next = Array.from({ length: nextSteps }, (_, i) => normalizeStep(state.pattern[i] || []));
  state.steps = nextSteps;
  state.pattern = next;
  state.currentStep = 0;
  state.cursorStep = clamp(state.cursorStep, 0, state.steps - 1);
  updateGridScale();
  render();
}

function updateCursorInfo() {
  const notes = getStepNotes(state.cursorStep);
  const cursorNote = noteNameFromMidi(getCursorMidi());
  els.cursorInfo.textContent =
    `Step ${state.cursorStep + 1} · cursor ${cursorNote} · ${notes.length ? notes.map(noteNameFromMidi).join(" / ") : "leeg"}`;
}

function updateModeHint() {
  els.modeHint.textContent =
    state.mode === "step"
      ? "Step mode: beweeg met pijltjes door het grid en activeer met Enter of muisklik."
      : "Live mode: toetsen spelen alleen live noten en wijzigen de sequencer niet.";
}

function applyModeClass() {
  document.body.classList.toggle("mode-step", state.mode === "step");
  document.body.classList.toggle("mode-live", state.mode === "live");
}

function buildHeader() {
  els.gridHeader.innerHTML = "";
  for (let i = 0; i < state.steps; i += 1) {
    const hasData = getStepNotes(i).length > 0;
    const el = document.createElement("div");
    el.className = `header-step${hasData ? " has-data" : ""}${state.isPlaying && state.currentStep === i ? " current" : ""}`;
    el.textContent = i + 1;
    els.gridHeader.appendChild(el);
  }
}

function buildLabels() {
  const rows = getVisibleRows();
  els.noteLabels.innerHTML = "";

  rows.forEach((row) => {
    const el = document.createElement("div");
    el.className = "note-label";
    el.textContent = row.name;
    els.noteLabels.appendChild(el);
  });
}

function renderGrid() {
  const rows = getVisibleRows();
  els.grid.innerHTML = "";

  rows.forEach((row, rowIndex) => {
    const rowEl = document.createElement("div");
    rowEl.className = "grid-row";

    for (let stepIndex = 0; stepIndex < state.steps; stepIndex += 1) {
      const cell = document.createElement("button");
      cell.type = "button";

      const stepNotes = getStepNotes(stepIndex);
      const isNoteHere = stepNotes.includes(row.midi);
      const isCursor = state.cursorStep === stepIndex && state.cursorRow === rowIndex;
      const isDenied = state.deniedCellKey === getCellKey(stepIndex, row.midi);

      cell.className = `cell${isCursor ? " cursor" : ""}${isNoteHere ? " has-note" : ""}${isDenied ? " flash-denied" : ""}`;
      cell.dataset.step = String(stepIndex);
      cell.dataset.row = String(rowIndex);

      cell.addEventListener("click", () => {
        state.cursorStep = stepIndex;
        state.cursorRow = rowIndex;

        if (state.mode === "step") {
          toggleCurrentCell();
        } else {
          previewChord([row.midi], 112, 180);
          setStatus(`Live: ${noteNameFromMidi(row.midi)}`);
          render();
        }
      });

      rowEl.appendChild(cell);
    }

    els.grid.appendChild(rowEl);
  });
}

function renderPianoKeys() {
  els.pianoKeys.innerHTML = "";

  const row0 = KEYBOARD_MAP.filter(item => item.octaveGroup === 0);
  const row1 = KEYBOARD_MAP.filter(item => item.octaveGroup === 1);

  [row0, row1].forEach((group) => {
    const rowWrap = document.createElement("div");
    rowWrap.className = "piano-row";

    group.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const black = item.label.includes("#");
      btn.className = `piano-key${black ? " black" : ""}`;
      btn.dataset.key = item.key;

      const midi = clamp(item.midi + Number(state.octaveShift), 36, 96);
      const liveLabel = noteNameFromMidi(midi);

      const note = document.createElement("div");
      note.className = "note";
      note.textContent = liveLabel;

      const keybind = document.createElement("div");
      keybind.className = "keybind";
      keybind.textContent = `${item.key.toUpperCase()} = ${liveLabel}`;

      btn.appendChild(note);
      btn.appendChild(keybind);

      btn.addEventListener("click", () => {
        if (state.mode === "step") {
          toggleNoteInStep(state.cursorStep, midi);
        } else {
          previewChord([midi], 112, 180);
          setStatus(`Live: ${noteNameFromMidi(midi)}`);
        }

        flashPianoKey(item.key);
      });

      rowWrap.appendChild(btn);
    });

    els.pianoKeys.appendChild(rowWrap);
  });
}

function render() {
  applyModeClass();
  updateGridScale();
  buildHeader();
  buildLabels();
  renderGrid();
  renderPianoKeys();
  buildPiano();	
  updateCursorInfo();
  updateModeHint();
}

function getMidiOutput() {
  if (!state.midiEnabled || !state.midiOutputId) return null;
  return state.midiOutputs.find((output) => output.id === state.midiOutputId) || null;
}

function sendMidiChord(notes, velocity = 110, durationMs = 180) {
  const output = getMidiOutput();
  if (!output) return false;

  const channel = clamp(Number(state.midiChannel), 1, 16) - 1;
  const noteOn = 0x90 + channel;
  const noteOff = 0x80 + channel;

  notes.forEach((midiNote) => {
    output.send([noteOn, midiNote, velocity]);
  });

  window.setTimeout(() => {
    notes.forEach((midiNote) => {
      output.send([noteOff, midiNote, 0]);
    });
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

function previewChord(notes, velocity = 100, durationMs = 180) {
  if (!notes.length) return;

  const sent = sendMidiChord(notes, velocity, durationMs);
  if (sent) return;

  const ctx = ensureAudioContext();
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  master.connect(ctx.destination);

  notes.forEach((midiNote) => {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";
    osc1.frequency.value = midiToFrequency(midiNote);
    osc2.frequency.value = midiToFrequency(midiNote) * 2;
    gain.gain.value = 1 / Math.max(notes.length, 1);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(master);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durationMs / 1000 + 0.02);
    osc2.stop(now + durationMs / 1000 + 0.02);
  });
}

function stepDurationMs() {
  return (60 / state.tempo / 4) * 1000;
}

function playCurrentStep() {
  render();

  const notes = getStepNotes(state.currentStep);
  if (notes.length) {
    const duration = Math.max(40, Math.floor(stepDurationMs() * (state.gate / 100)));
    previewChord(notes, 112, duration);
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
    mode: state.mode,
    steps: state.steps,
    tempo: state.tempo,
    gate: state.gate,
    octaveShift: state.octaveShift,
    pattern: state.pattern,
    midiChannel: state.midiChannel,
    cursorStep: state.cursorStep,
    cursorRow: state.cursorRow
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
    state.mode = data.mode || "step";
    state.steps = Number(data.steps) || 16;
    state.tempo = Number(data.tempo) || 132;
    state.gate = Number(data.gate) || 70;
    state.octaveShift = Number(data.octaveShift) || 0;
    state.pattern = Array.from({ length: state.steps }, (_, i) => normalizeStep(data.pattern?.[i] || []));
    state.midiChannel = Number(data.midiChannel) || 1;
    state.cursorStep = clamp(Number(data.cursorStep) || 0, 0, state.steps - 1);
    state.cursorRow = clamp(Number(data.cursorRow) || 0, 0, BASE_NOTE_ROWS.length - 1);

    els.modeSelect.value = state.mode;
    els.stepCountSelect.value = String(state.steps);
    els.tempoInput.value = String(state.tempo);
    els.gateInput.value = String(state.gate);
    els.octaveShift.value = String(state.octaveShift);
    els.midiChannelSelect.value = String(state.midiChannel);

    updateGridScale();
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
  els.midiChannelSelect.innerHTML = "";
  for (let i = 1; i <= 16; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = String(i);
    els.midiChannelSelect.appendChild(option);
  }
  els.midiChannelSelect.value = String(state.midiChannel);
}

function moveCursorStep(delta) {
  state.cursorStep = (state.cursorStep + delta + state.steps) % state.steps;
  render();
}

function moveCursorRow(delta) {
  state.cursorRow = (state.cursorRow + delta + BASE_NOTE_ROWS.length) % BASE_NOTE_ROWS.length;
  render();
}

function flashPianoKey(key) {
  const btn = els.pianoKeys.querySelector(`[data-key="${key}"]`);
  if (!btn) return;
  btn.classList.add("active");
  window.setTimeout(() => btn.classList.remove("active"), 140);
}

function handleMappedKey(lower) {
  const mapped = KEY_TO_MIDI[lower];
  if (mapped === undefined) return false;

  const midi = clamp(mapped + Number(state.octaveShift), 36, 96);

  if (state.mode === "step") {
    toggleNoteInStep(state.cursorStep, midi);
  } else {
    previewChord([midi], 112, 180);
    setStatus(`Live: ${noteNameFromMidi(midi)}`);
  }

  flashPianoKey(lower);
  return true;
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

  els.modeSelect.addEventListener("change", () => {
    state.mode = els.modeSelect.value;
    render();
    setStatus(state.mode === "step" ? "Step mode actief" : "Live mode actief");
  });

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

  window.addEventListener("resize", () => {
    updateGridScale();
    render();
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    const lower = event.key.toLowerCase();

    if (typing) return;

    if (KEY_TO_MIDI[lower] !== undefined) {
      if (state.heldKeys.has(lower)) return;
      state.heldKeys.add(lower);
      event.preventDefault();
      handleMappedKey(lower);
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      if (state.isPlaying) stopPlayback();
      else startPlayback();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveCursorStep(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveCursorStep(1);
      return;
    }

    if (state.mode === "step" && event.key === "ArrowUp") {
      event.preventDefault();
      moveCursorRow(-1);
      return;
    }

    if (state.mode === "step" && event.key === "ArrowDown") {
      event.preventDefault();
      moveCursorRow(1);
      return;
    }

    if (state.mode === "step" && event.key === "Enter") {
      event.preventDefault();
      toggleCurrentCell();
      return;
    }

    if (state.mode === "step" && event.key === "Backspace") {
      event.preventDefault();
      toggleStepOnOff(state.cursorStep);
      return;
    }
  });

  document.addEventListener("keyup", (event) => {
    state.heldKeys.delete(event.key.toLowerCase());
  });
}

function buildPiano() {
  const piano = document.getElementById("piano");
  piano.innerHTML = "";

  const notes = [
    { n: 60, black: false }, // C
    { n: 61, black: true },
    { n: 62, black: false },
    { n: 63, black: true },
    { n: 64, black: false },
    { n: 65, black: false },
    { n: 66, black: true },
    { n: 67, black: false },
    { n: 68, black: true },
    { n: 69, black: false },
    { n: 70, black: true },
    { n: 71, black: false }
  ];

  notes.forEach(note => {
    const key = document.createElement("div");
    key.className = "piano-key" + (note.black ? " black" : "");

    key.addEventListener("click", () => {
      previewChord([note.n], 110, 200);
    });

    piano.appendChild(key);
  });
}

function init() {
  populateChannels();
  bindEvents();
  updateGridScale();
  render();
  initMidi();
}

init();