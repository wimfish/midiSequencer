import { clamp } from "../../shared/utils/math.js";
import { saveJson, loadJson } from "../../shared/storage/jsonStorage.js";
import { requestMidiAccess, listMidiOutputs } from "../../shared/midi/access.js";

const STORAGE_KEY = "volca-fm-prototype-v10";
const MAX_NOTES_PER_STEP = 3;
const VOLCA_SELECTION_KEY = "volca-selected";

export function fmSequencerFeature() {
  return { mount };

  async function mount(root) {
    root.innerHTML = template();
    document.body.classList.add("fm-prototype-page");

    const els = {
      playBtn: document.getElementById("playBtn"),
      stopBtn: document.getElementById("stopBtn"),
      clearBtn: document.getElementById("clearBtn"),
      saveBtn: document.getElementById("saveBtn"),
      loadBtn: document.getElementById("loadBtn"),
      toggleSettingsBtn: document.getElementById("toggleSettingsBtn"),
      volcaSelect: document.getElementById("volcaSelect"),
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
      statusDisplay: document.getElementById("statusDisplay"),
      gridHeader: document.getElementById("gridHeader"),
      noteLabels: document.getElementById("noteLabels"),
      grid: document.getElementById("grid"),
      modeHint: document.getElementById("modeHint"),
      pianoWhiteKeys: document.getElementById("pianoWhiteKeys"),
      pianoBlackKeys: document.getElementById("pianoBlackKeys"),
      settingsPanel: document.getElementById("advancedPanel")
    };

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

    const PIANO_LAYOUT = [
      { midi: 48, kind: "white", leftIndex: 0 },
      { midi: 49, kind: "black", leftIndex: 0 },
      { midi: 50, kind: "white", leftIndex: 1 },
      { midi: 51, kind: "black", leftIndex: 1 },
      { midi: 52, kind: "white", leftIndex: 2 },
      { midi: 53, kind: "white", leftIndex: 3 },
      { midi: 54, kind: "black", leftIndex: 3 },
      { midi: 55, kind: "white", leftIndex: 4 },
      { midi: 56, kind: "black", leftIndex: 4 },
      { midi: 57, kind: "white", leftIndex: 5 },
      { midi: 58, kind: "black", leftIndex: 5 },
      { midi: 59, kind: "white", leftIndex: 6 },
      { midi: 60, kind: "white", leftIndex: 7 },
      { midi: 61, kind: "black", leftIndex: 7 },
      { midi: 62, kind: "white", leftIndex: 8 },
      { midi: 63, kind: "black", leftIndex: 8 },
      { midi: 64, kind: "white", leftIndex: 9 },
      { midi: 65, kind: "white", leftIndex: 10 },
      { midi: 66, kind: "black", leftIndex: 10 },
      { midi: 67, kind: "white", leftIndex: 11 },
      { midi: 68, kind: "black", leftIndex: 11 },
      { midi: 69, kind: "white", leftIndex: 12 },
      { midi: 70, kind: "black", leftIndex: 12 },
      { midi: 71, kind: "white", leftIndex: 13 }
    ];

    const KEY_TO_MIDI = Object.fromEntries(KEYBOARD_MAP.map((item) => [item.key, item.midi]));
    const MIDI_TO_KEY = Object.fromEntries(KEYBOARD_MAP.map((item) => [item.midi, item.key.toUpperCase()]));

    const state = {
      mode: "step",
      steps: 16,
      tempo: 132,
      gate: 70,
      octaveShift: 0,
      isPlaying: false,
      currentStep: 0,
      cursorStep: 0,
      cursorRow: BASE_NOTE_ROWS.findIndex((row) => row.midi === 60),
      pattern: Array.from({ length: 16 }, () => []),
      midiEnabled: true,
      midiAccess: null,
      midiOutputs: [],
      midiOutputId: "",
      midiChannel: 1,
      timerId: null,
      audioContext: null,
      heldKeys: new Set(),
      deniedCellKey: null,
      settingsOpen: true
    };

    let keydownHandler = null;
    let keyupHandler = null;
    let resizeHandler = null;

    init();
    await initMidi();

    return () => {
      stopPlayback();
      document.body.classList.remove("fm-prototype-page");
      if (keydownHandler) document.removeEventListener("keydown", keydownHandler);
      if (keyupHandler) document.removeEventListener("keyup", keyupHandler);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (state.midiAccess) state.midiAccess.onstatechange = null;
    };

    function setStatus(text) {
      els.statusText.textContent = text;
    }

    function setDisplay(text) {
      els.statusDisplay.textContent = text;
    }

    function noteNameFromMidi(midi) {
      const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const octave = Math.floor(midi / 12) - 1;
      return `${names[midi % 12]}${octave}`;
    }

    function getVisibleRows() {
      return BASE_NOTE_ROWS.map((row) => {
        const midi = row.midi + Number(state.octaveShift);
        return { midi, name: noteNameFromMidi(midi) };
      });
    }

    function updateGridScale() {
      document.documentElement.style.setProperty("--fm-step-count", String(state.steps));
      document.documentElement.style.setProperty("--fm-row-count", String(getVisibleRows().length));
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
        setStepNotes(stepIndex, notes.filter((note) => note !== midiNote));
        setStatus(`Step ${stepIndex + 1} noot verwijderd: ${noteNameFromMidi(midiNote)}`);
        setDisplay(`NOOT UIT: ${noteNameFromMidi(midiNote)}`);
        render();
        return true;
      }

      if (notes.length >= MAX_NOTES_PER_STEP) {
        flashDenied(stepIndex, midiNote);
        setStatus(`Step ${stepIndex + 1} zit al vol (max 3 noten)`);
        setDisplay("MAX 3 NOTEN PER STEP");
        return false;
      }

      setStepNotes(stepIndex, [...notes, midiNote]);
      setStatus(`Step ${stepIndex + 1} + ${noteNameFromMidi(midiNote)}`);
      setDisplay(`NOOT AAN: ${noteNameFromMidi(midiNote)}`);
      render();
      return true;
    }

    function toggleCurrentCell() {
      toggleNoteInStep(state.cursorStep, getCursorMidi());
    }

    function clearPattern() {
      state.pattern = createEmptyPattern(state.steps);
      state.currentStep = 0;
      state.cursorStep = 0;
      state.cursorRow = BASE_NOTE_ROWS.findIndex((row) => row.midi === 60);
      render();
      setStatus("Pattern gewist");
      setDisplay("PATTERN GEWIST");
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
      els.cursorInfo.textContent = `Step ${state.cursorStep + 1} · cursor ${cursorNote} · ${
        notes.length ? notes.map(noteNameFromMidi).join(" / ") : "leeg"
      }`;
    }

    function updateModeHint() {
      els.modeHint.textContent =
        state.mode === "step"
          ? "Step mode: klik noten in het grid of op de piano om steps op te bouwen."
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
        const isCurrent = state.isPlaying && state.currentStep === i;
        const isCursor = !state.isPlaying && state.cursorStep === i;
        const wrap = document.createElement("div");
        wrap.className = `step-head${hasData ? " has-data" : ""}${isCurrent ? " current" : ""}${isCursor ? " cursor" : ""}`;
        const led = document.createElement("span");
        led.className = "step-led";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "step-head-btn";
        btn.textContent = String(i + 1);
        btn.addEventListener("click", () => {
          state.cursorStep = i;
          render();
        });
        wrap.appendChild(led);
        wrap.appendChild(btn);
        els.gridHeader.appendChild(wrap);
      }
    }

    function buildLabels() {
      const rows = getVisibleRows();
      els.noteLabels.innerHTML = "";
      rows.forEach((row) => {
        const el = document.createElement("div");
        el.className = "note-label";
        const badge = document.createElement("span");
        badge.className = "note-label-badge";
        badge.textContent = row.name;
        el.appendChild(badge);
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
              setDisplay(`LIVE: ${noteNameFromMidi(row.midi)}`);
              render();
            }
          });
          rowEl.appendChild(cell);
        }
        els.grid.appendChild(rowEl);
      });
    }

    function midiInDisplayRange(midi) {
      const shifted = midi + Number(state.octaveShift);
      return shifted >= 36 && shifted <= 96;
    }

    function buildPianoKeyLabelWrap(noteText, keyText) {
      const note = document.createElement("span");
      note.className = "piano-note-label";
      note.textContent = noteText;
      const keybind = document.createElement("span");
      keybind.className = "piano-keybind-label";
      keybind.textContent = keyText;
      return { note, keybind };
    }

    function buildPiano() {
      els.pianoWhiteKeys.innerHTML = "";
      els.pianoBlackKeys.innerHTML = "";
      const rootStyle = getComputedStyle(document.documentElement);
      const whiteWidth = parseFloat(rootStyle.getPropertyValue("--fm-white-key-width")) || 68;
      const blackWidth = parseFloat(rootStyle.getPropertyValue("--fm-black-key-width")) || 40;
      const whiteGap = parseFloat(rootStyle.getPropertyValue("--fm-white-key-gap")) || 2;
      void blackWidth;
      PIANO_LAYOUT.forEach((item) => {
        const shiftedMidi = item.midi + Number(state.octaveShift);
        if (!midiInDisplayRange(item.midi)) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `piano-key ${item.kind}`;
        btn.dataset.midi = String(shiftedMidi);
        const keyText = MIDI_TO_KEY[item.midi] || "";
        const labels = buildPianoKeyLabelWrap(noteNameFromMidi(shiftedMidi), keyText);
        btn.appendChild(labels.note);
        btn.appendChild(labels.keybind);
        btn.addEventListener("click", () => {
          if (state.mode === "step") {
            toggleNoteInStep(state.cursorStep, shiftedMidi);
          } else {
            previewChord([shiftedMidi], 112, 180);
            setStatus(`Live: ${noteNameFromMidi(shiftedMidi)}`);
            setDisplay(`LIVE: ${noteNameFromMidi(shiftedMidi)}`);
          }
          flashPianoMidi(shiftedMidi);
        });
        if (item.kind === "white") {
          els.pianoWhiteKeys.appendChild(btn);
        } else {
          const boundaryX = (item.leftIndex + 1) * whiteWidth + item.leftIndex * whiteGap;
          btn.style.left = `${boundaryX}px`;
          els.pianoBlackKeys.appendChild(btn);
        }
      });
    }

    function render() {
      applyModeClass();
      updateGridScale();
      buildHeader();
      buildLabels();
      renderGrid();
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
      notes.forEach((midiNote) => output.send([noteOn, midiNote, velocity]));
      window.setTimeout(() => notes.forEach((midiNote) => output.send([noteOff, midiNote, 0])), durationMs);
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
        setDisplay(`STEP ${state.currentStep + 1} SPEELT`);
      }
      state.currentStep = (state.currentStep + 1) % state.steps;
    }

    function startPlayback() {
      if (state.isPlaying) return;
      state.isPlaying = true;
      setStatus("Playback gestart");
      setDisplay("PLAYBACK ACTIEF");
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
      setDisplay("PLAYBACK GESTOPT");
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
      saveJson(STORAGE_KEY, payload);
      setStatus("Prototype opgeslagen");
      setDisplay("PATTERN OPGESLAGEN");
    }

    function loadPattern() {
      const data = loadJson(STORAGE_KEY);
      if (!data) {
        setStatus("Geen opgeslagen pattern gevonden");
        setDisplay("GEEN SAVE GEVONDEN");
        return;
      }
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
      setDisplay("PATTERN GELADEN");
    }

    async function initMidi() {
      const res = await requestMidiAccess();
      if (!res.ok) {
        setStatus("Web MIDI niet beschikbaar, browser audio actief");
        setDisplay("BROWSER AUDIO ACTIEF");
        return;
      }
      state.midiAccess = res.access;
      state.midiOutputs = listMidiOutputs(state.midiAccess);
      populateMidiOutputs();
      state.midiAccess.onstatechange = () => {
        state.midiOutputs = listMidiOutputs(state.midiAccess);
        populateMidiOutputs();
      };
      setStatus("MIDI klaar");
      setDisplay("MIDI KLAAR");
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

    function flashPianoMidi(midi) {
      const btn = document.querySelector(`.piano-key[data-midi="${midi}"]`);
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
        setDisplay(`LIVE: ${noteNameFromMidi(midi)}`);
      }
      flashPianoMidi(midi);
      return true;
    }

    function toggleSettingsPanel() {
      state.settingsOpen = !state.settingsOpen;
      els.settingsPanel.style.display = state.settingsOpen ? "block" : "none";
      els.toggleSettingsBtn.textContent = state.settingsOpen ? "▲ INSTELLINGEN OMHOOG" : "▼ INSTELLINGEN OMLAAG";
    }

    function bindEvents() {
      els.volcaSelect.addEventListener("change", () => {
        const next = els.volcaSelect.value;
        localStorage.setItem(VOLCA_SELECTION_KEY, next);
        if (next !== "fm") {
          window.location.hash = "#/style";
        }
      });

      els.playBtn.addEventListener("click", () => {
        if (state.isPlaying) stopPlayback();
        else startPlayback();
      });
      els.stopBtn.addEventListener("click", stopPlayback);
      els.clearBtn.addEventListener("click", clearPattern);
      els.saveBtn.addEventListener("click", savePattern);
      els.loadBtn.addEventListener("click", loadPattern);
      els.toggleSettingsBtn.addEventListener("click", toggleSettingsPanel);
      els.modeSelect.addEventListener("change", () => {
        state.mode = els.modeSelect.value;
        render();
        setStatus(state.mode === "step" ? "Step mode actief" : "Live mode actief");
        setDisplay(state.mode === "step" ? "STEP MODE ACTIEF" : "LIVE MODE ACTIEF");
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
        setDisplay(state.midiEnabled ? "MIDI AAN" : "MIDI UIT");
      });
      els.midiOutputSelect.addEventListener("change", () => {
        state.midiOutputId = els.midiOutputSelect.value;
        setStatus(state.midiOutputId ? "MIDI output gekozen" : "Geen MIDI output gekozen");
        setDisplay(state.midiOutputId ? "OUTPUT GEKOZEN" : "GEEN OUTPUT");
      });
      els.midiChannelSelect.addEventListener("change", () => {
        state.midiChannel = Number(els.midiChannelSelect.value) || 1;
        setStatus(`MIDI kanaal ${state.midiChannel}`);
        setDisplay(`KANAAL ${state.midiChannel}`);
      });

      resizeHandler = () => {
        updateGridScale();
        render();
      };
      window.addEventListener("resize", resizeHandler);

      keydownHandler = (event) => {
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
          setStepNotes(state.cursorStep, []);
          setStatus(`Step ${state.cursorStep + 1} gewist`);
          setDisplay(`STEP ${state.cursorStep + 1} GEWIST`);
          render();
        }
      };
      document.addEventListener("keydown", keydownHandler);

      keyupHandler = (event) => {
        state.heldKeys.delete(event.key.toLowerCase());
      };
      document.addEventListener("keyup", keyupHandler);
    }

    function init() {
      populateChannels();

      // Keep the Volca selector in sync across views.
      const savedVolca = localStorage.getItem(VOLCA_SELECTION_KEY) || "fm";
      els.volcaSelect.value = savedVolca === "fm" ? "fm" : savedVolca;
      localStorage.setItem(VOLCA_SELECTION_KEY, els.volcaSelect.value);

      bindEvents();
      updateGridScale();
      render();
    }
  }
}

function template() {
  return `
    <header class="topbar card">
      <div class="fm-hero-main">
        <h1>VOLCA FM SEQUENCER</h1>
        <p class="sub fm-sub">
          Twee modi: <strong>Step</strong> en <strong>Live</strong>. In Step programmeer je noten per step
          (max 3 per kolom). In Live speel je melodisch via toetsenbord of piano.
        </p>
      </div>

      <div class="topbar-actions">
        <button
          id="toggleSettingsBtn"
          class="secondary settings-toggle-btn"
          type="button"
          aria-expanded="true"
        >
          ▲ INSTELLINGEN OMHOOG
        </button>

        <div class="status" id="statusDisplay">FM PATTERN KLAAR</div>
      </div>
    </header>

    <section id="controlStack" class="control-stack">
      <div id="advancedPanel" class="advanced-panel">
        <section class="controls card fm-main-controls">
          <div class="field">
            <label for="volcaSelect">Volca</label>
            <select id="volcaSelect">
              <option value="beats">Volca Beats</option>
              <option value="sample">Volca Sample</option>
              <option value="drum">Volca Drum</option>
              <option value="fm" selected>Volca FM</option>
            </select>
          </div>

          <div class="field">
            <label for="modeSelect">Mode</label>
            <select id="modeSelect">
              <option value="step" selected>Step</option>
              <option value="live">Live</option>
            </select>
          </div>

          <div class="field">
            <label for="stepCountSelect">Steps</label>
            <select id="stepCountSelect">
              <option value="8">8</option>
              <option value="16" selected>16</option>
              <option value="32">32</option>
            </select>
          </div>

          <div class="buttons-wrap buttons-wrap-wide fm-transport-buttons">
            <button id="playBtn" type="button">PLAY</button>
            <button id="stopBtn" type="button">STOP</button>
            <button id="clearBtn" type="button">CLEAR</button>
            <button id="saveBtn" type="button">SAVE</button>
            <button id="loadBtn" type="button">LOAD</button>
          </div>
        </section>

        <section class="midi card fm-midi-panel">
          <div class="toggle-field">
            <label for="midiEnable">MIDI</label>
            <label class="switch" for="midiEnable">
              <input id="midiEnable" type="checkbox" checked />
              <span class="switch-ui"></span>
              <span class="switch-text">
                <span class="switch-on">Aan</span>
                <span class="switch-off">Uit</span>
              </span>
            </label>
          </div>

          <div class="field">
            <label for="midiOutputSelect">Output</label>
            <select id="midiOutputSelect">
              <option value="">Geen output</option>
            </select>
          </div>

          <div class="field">
            <label for="midiChannelSelect">Kanaal</label>
            <select id="midiChannelSelect"></select>
          </div>

          <div class="midi-hint" id="modeHint">
            Step mode: klik noten in het grid of op de piano om steps op te bouwen.
          </div>
        </section>

        <section class="controls card fm-performance-controls">
          <div class="field bpm-field">
            <label for="tempoInput">BPM</label>
            <input id="tempoInput" type="number" min="40" max="240" value="132" />
          </div>

          <div class="field">
            <label for="gateInput">Gate %</label>
            <input id="gateInput" type="number" min="5" max="95" value="70" />
          </div>

          <div class="field">
            <label for="octaveShift">Octaaf</label>
            <select id="octaveShift">
              <option value="-12">-1</option>
              <option value="0" selected>0</option>
              <option value="12">+1</option>
            </select>
          </div>
        </section>
      </div>
    </section>

    <section class="quick-bar card fm-status-panel">
      <div class="quick-bar-main fm-status-main">
        <div class="status" id="statusText">Klaar</div>
        <div class="fm-cursor-box" id="cursorInfo">Step 1 · cursor C4 · leeg</div>
        <div class="fm-live-help">Live Keyboard · Z–M en Q–U · of klik op de piano</div>
      </div>
    </section>

    <section class="card fm-sequencer-card fm-sequencer-card--hardware">
      <div class="fm-section-title">Piano Roll</div>

      <div class="fm-sequencer-inner fm-roll-frame">
        <div class="fm-roll-surface">
          <div class="fm-roll-header">
            <div class="fm-roll-header-spacer" aria-hidden="true"></div>
            <div class="grid-header" id="gridHeader"></div>
          </div>

          <div class="fm-roll-body">
            <div class="note-labels fm-note-buttons" id="noteLabels"></div>

            <div class="grid-wrap fm-grid-window">
              <div class="grid" id="grid"></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card fm-piano-card">
      <div class="fm-section-title">Live Keyboard</div>

      <div class="fm-piano-shell">
        <div class="piano-stage">
          <div class="piano-row piano-row-white" id="pianoWhiteKeys"></div>
          <div class="piano-row piano-row-black" id="pianoBlackKeys"></div>
        </div>
      </div>
    </section>
  `;
}

