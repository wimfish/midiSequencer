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

const KEYBOARD_MAP = [
  { key: "z", midi: 48, label: "C3" },
  { key: "s", midi: 49, label: "C#3" },
  { key: "x", midi: 50, label: "D3" },
  { key: "d", midi: 51, label: "D#3" },
  { key: "c", midi: 52, label: "E3" },
  { key: "v", midi: 53, label: "F3" },
  { key: "g", midi: 54, label: "F#3" },
  { key: "b", midi: 55, label: "G3" },
  { key: "h", midi: 56, label: "G#3" },
  { key: "n", midi: 57, label: "A3" },
  { key: "j", midi: 58, label: "A#3" },
  { key: "m", midi: 59, label: "B3" },
  { key: "q", midi: 60, label: "C4" },
  { key: "2", midi: 61, label: "C#4" },
  { key: "w", midi: 62, label: "D4" },
  { key: "3", midi: 63, label: "D#4" },
  { key: "e", midi: 64, label: "E4" },
  { key: "r", midi: 65, label: "F4" },
  { key: "5", midi: 66, label: "F#4" },
  { key: "t", midi: 67, label: "G4" },
  { key: "6", midi: 68, label: "G#4" },
  { key: "y", midi: 69, label: "A4" },
  { key: "7", midi: 70, label: "A#4" },
  { key: "u", midi: 71, label: "B4" }
];

const KEY_TO_MIDI = Object.fromEntries(KEYBOARD_MAP.map(item => [item.key, item.midi]));
const STORAGE_KEY = "volca-fm-prototype-v4";
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
  cursorRow: NOTE_ROWS.findIndex(row => row.midi === 60),
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
  return NOTE_ROWS[state.cursorRow].midi + Number(state.octaveShift);
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

function transposeTopNote(stepIndex, delta) {
  const notes = getStepNotes(stepIndex);

  if (!notes.length) {
    const base = clamp(60 + Number(state.octaveShift) + delta, 36, 96);
    setStepNotes(stepIndex, [base]);
    setStatus(`Step ${stepIndex + 1} → ${noteNameFromMidi(base)}`);
    render();
    return;
  }

  const next = [...notes];
  next[next.length - 1] = clamp(next[next.length - 1] + delta, 36, 96);
  setStepNotes(stepIndex, next);
  setStatus(`Step ${stepIndex + 1} topnote → ${noteNameFromMidi(next[next.length - 1])}`);
  render();
}

function clearPattern() {
  state.pattern = createEmptyPattern(state.steps);
  state.currentStep = 0;
  state.cursorStep = 0;
  state.cursorRow = NOTE_ROWS.findIndex(row => row.midi === 60);
  render();
  setStatus("Pattern gewist");
}

function resizePattern(nextSteps) {
  const next = Array.from({ length: nextSteps }, (_, i) => normalizeStep(state.pattern[i] || []));
  state.steps = nextSteps;
  state.pattern = next;
  state.currentStep = 0;
  state.cursorStep = clamp(state.cursorStep, 0, state.steps - 1);
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

  NOTE_ROWS.forEach((row, rowIndex) => {
    const rowEl = document.createElement("div");
    rowEl.className = "grid-row";


    for (let stepIndex = 0; stepIndex < state.steps; stepIndex += 1) {
      const cell = document.createElement("button");
      cell.type = "button";

      const stepNotes = getStepNotes(stepIndex);
      const rowMidi = row.midi + Number(state.octaveShift);
      const isNoteHere = stepNotes.includes(rowMidi);
      const isCursor = state.cursorStep === stepIndex && state.cursorRow === rowIndex;
      const isDenied = state.deniedCellKey === getCellKey(stepIndex, rowMidi);

      cell.className = `cell${isCursor ? " cursor" : ""}${isNoteHere ? " has-note" : ""}${isDenied ? " flash-denied" : ""}`;
      cell.dataset.step = String(stepIndex);
      cell.dataset.row = String(rowIndex);

      cell.addEventListener("click", () => {
        state.cursorStep = stepIndex;
        state.cursorRow = rowIndex;

        if (state.mode === "step") {
          toggleCurrentCell();
        } else {
          previewChord([rowMidi], 112, 180);
          setStatus(`Live: ${noteNameFromMidi(rowMidi)}`);
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

  KEYBOARD_MAP.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const black = item.label.includes("#");
    btn.className = `piano-key${black ? " black" : ""}`;
    btn.dataset.key = item.key;

    const note = document.createElement("div");
    note.className = "note";
    note.textContent = item.label;

    const keybind = document.createElement("div");
    keybind.className = "keybind";
    keybind.textContent = `${item.key.toUpperCase()} = ${item.label}`;

    btn.appendChild(note);
    btn.appendChild(keybind);

    btn.addEventListener("click", () => {
      const midi = clamp(item.midi + Number(state.octaveShift), 36, 96);

      if (state.mode === "step") {
        toggleNoteInStep(state.cursorStep, midi);
      } else {
        previewChord([midi], 112, 180);
        setStatus(`Live: ${noteNameFromMidi(midi)}`);
      }

      flashPianoKey(item.key);
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
    state.cursorRow = clamp(Number(data.cursorRow) || 0, 0, NOTE_ROWS.length - 1);

    els.modeSelect.value = state.mode;
    els.stepCountSelect.value = String(state.steps);
    els.tempoInput.value = String(state.tempo);
    els.gateInput.value = String(state.gate);
    els.octaveShift.value = String(state.octaveShift);
    els.midiChannelSelect.value = String(state.midiChannel);

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

function moveCursorStep(delta) {
  state.cursorStep = (state.cursorStep + delta + state.steps) % state.steps;
  render();
}

function moveCursorRow(delta) {
  state.cursorRow = (state.cursorRow + delta + NOTE_ROWS.length) % NOTE_ROWS.length;
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

function init() {
  populateChannels();
  bindEvents();
  render();
  initMidi();
}

init();