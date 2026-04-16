import { styleDefaults } from "./data/styles.js";
import { volcaProfiles } from "./data/volcaProfiles.js";
import { clamp } from "../../shared/utils/math.js";
import { qs } from "../../shared/utils/dom.js";
import { saveJson, loadJson } from "../../shared/storage/jsonStorage.js";
import {
  requestMidiAccess,
  listMidiOutputs,
  resolveMidiOutput,
  sendClockToOutput,
  sendTransportToOutput,
  getTransportSnapshot,
  getTransportStep,
  setTransportBpm,
  startTransport,
  stopTransport,
  subscribeTransport,
  getMidiSessionDevice,
  persistMidiSessionFromState,
  evaluateMidiRoutingConflict,
  MIDI_DEVICE
} from "../../shared/midi/midiLayer.js";

const STORAGE_KEY = "volca-sequencer-save";
const VOLCA_SELECTION_KEY = "volca-selected";
const DRUM_ROLL_OCTAVE_MIN = 1;
const DRUM_ROLL_OCTAVE_MAX = 5;
const DRUM_ROLL_NOTE_ROWS = [
  { name: "B", noteIndex: 11 },
  { name: "A#", noteIndex: 10 },
  { name: "A", noteIndex: 9 },
  { name: "G#", noteIndex: 8 },
  { name: "G", noteIndex: 7 },
  { name: "F#", noteIndex: 6 },
  { name: "F", noteIndex: 5 },
  { name: "E", noteIndex: 4 },
  { name: "D#", noteIndex: 3 },
  { name: "D", noteIndex: 2 },
  { name: "C#", noteIndex: 1 },
  { name: "C", noteIndex: 0 }
];
/** Volca Drum: meerdere parts tegelijk — CC + note op exact dezelfde ms geeft vaak gedropte/verkeerde pitch. */
const DRUM_MULTI_CC_LEAD_MS = 14;
/** Zie `Volca sequencer.txt`: micro-delay tussen kanalen/hits op dezelfde tick om MIDI-bus rust te geven. */
const DRUM_MULTI_CC_STAGGER_MS = 6;
/** Zie `Volca sequencer.txt`: micro-delay tussen gelijktijdige hits — 5 ms om MIDI-bus / Volca rust te geven. */
const DRUM_MULTI_NOTE_STAGGER_MS = 5;
/** Langere gate → Note-Off minder gelijk met andere kanalen (Volca negeert lengte vaak toch). */
const DRUM_MULTI_NOTE_GATE_MIN_MS = 52;
const VOLUME_LEVELS = [
  { step: 1, label: "heel zacht", velocity: 88 },
  { step: 2, label: "zacht", velocity: 96 },
  { step: 3, label: "half volume", velocity: 104 },
  { step: 4, label: "normaal", velocity: 112 },
  { step: 5, label: "harder", velocity: 122 }
];
const DEFAULT_STEP_VELOCITY = VOLUME_LEVELS[2].velocity;
let styleSequencerDraft = null;

export function styleSequencerFeature() {
  return { mount };

  async function mount(root) {
    root.innerHTML = template();

    const els = {};
    let audioCtx = null;
    let globalPointerUpHandler = null;
    let globalKeydownHandler = null;
    let playbackIntervalId = null;
    let transportUnsubscribe = null;
    let lastProcessedTransportStep = -1;
    let lastTransportOutputId = "";
    let styleUsedDraftOnMount = false;

    const state = {
      style: "Drum & Bass",
      variation: "default",
      length: 16,
      bpm: 174,
      volca: "beats",
      currentStep: 0,
      activeTrack: 0,
      activeSetting: "probability",
      isPlaying: false,
      nextStepTime: 0,
      timerId: null,
      drawMode: null,
      octaveHotkeyHeld: false,
      midiAccess: null,
      midiOutputId: "",
      midiEnabled: false,
      midiOutputActive: true,
      midiClockEnabled: true,
      midiTransportCommands: false,
      drumMultiMode: false,
      drumMultiSendNoteOff: true,
      drumCcLeadMs: DRUM_MULTI_CC_LEAD_MS,
      drumCcStaggerMs: DRUM_MULTI_CC_STAGGER_MS,
      drumNoteStaggerMs: DRUM_MULTI_NOTE_STAGGER_MS,
      lastClockTick: 0,
      tracks: [],
      trackTemplates: [],
      maxTracks: 0,
      drumRollPointerHold: null
    };

    const settingMeta = {
      probability: { label: "Probability", short: "P", min: 0, max: 100, step: 5, suffix: "%" },
      swing: { label: "Swing", short: "S", min: 0, max: 75, step: 5, suffix: "%" },
      accent: { label: "Accent", short: "A", min: 20, max: 127, step: 5, suffix: "" }
    };

    init();

    return () => {
      styleSequencerDraft = snapshotState();
      stopPlaybackLoop();
      if (state.isPlaying) sendMidiTransport(false, lastTransportOutputId || state.midiOutputId);
      if (transportUnsubscribe) transportUnsubscribe();
      if (globalPointerUpHandler) window.removeEventListener("pointerup", globalPointerUpHandler);
      if (globalKeydownHandler) document.removeEventListener("keydown", globalKeydownHandler);
      document.removeEventListener("keyup", onKeyup);
      if (state.midiAccess) state.midiAccess.onstatechange = null;
    };

    function templateIds() {
      return [
        "styleSelect",
        "variationSelect",
        "lengthSelect",
        "volcaSelect",
        "bpmInput",
        "generateBtn",
        "clearBtn",
        "playBtn",
        "saveBtn",
        "loadBtn",
        "addTrackBtn",
        "removeTrackBtn",
        "trackCountText",
        "trackHelpText",
        "tracksContainer",
        "statusText",
        "midiEnable",
        "styleMidiOutputActiveToggle",
        "midiActiveModeState",
        "midiRouteDebug",
        "midiOutputSelect",
        "midiChannelSelect",
        "clockEnable",
        "midiTransportCommandsToggle",
        "drumMultiWrap",
        "drumMultiToggle",
        "drumMultiNoteOffWrap",
        "drumMultiNoteOffToggle",
        "drumBufferMsInput",
        "drumCcStaggerMsInput",
        "drumNoteStaggerMsInput",
        "midiHint",
        "settingsToggleBtn",
        "controlStack",
        "advancedPanel",
        "addTrackModal",
        "addTrackSelect",
        "addTrackConfirmBtn",
        "addTrackCancelBtn",
        "velocityModal",
        "velocityInput",
        "velocityConfirmBtn",
        "velocityCancelBtn"
      ];
    }

    function init() {
      bindEls();
      els.drumBufferMsInput.value = String(state.drumCcLeadMs);
      els.drumCcStaggerMsInput.value = String(state.drumCcStaggerMs);
      els.drumNoteStaggerMsInput.value = String(state.drumNoteStaggerMs);
      populateStyles();
      populateChannels();
      bindEvents();
      toggleSettingsPanel(true);
      setupAudio();
      setupMidi();
      transportUnsubscribe = subscribeTransport(handleTransportChange);

      // Keep the Volca selector in sync across views.
      const savedVolca = localStorage.getItem(VOLCA_SELECTION_KEY);
      if (savedVolca && savedVolca !== "fm") {
        els.volcaSelect.value = savedVolca;
        state.volca = savedVolca;
      } else {
        els.volcaSelect.value = "drum";
        state.volca = "drum";
        localStorage.setItem(VOLCA_SELECTION_KEY, "drum");
      }

      // If user selected FM in another view, jump immediately.
      if (els.volcaSelect.value === "fm") {
        window.location.hash = "#/fm";
        return;
      }

      const shouldUseDraft =
        !!styleSequencerDraft && (!savedVolca || savedVolca === styleSequencerDraft.volca);
      styleUsedDraftOnMount = shouldUseDraft;
      if (shouldUseDraft) {
        restoreState(styleSequencerDraft);
      } else {
        applyVolcaProfile(false);
        generatePattern();
      }

      globalPointerUpHandler = () => {
        state.drawMode = null;
        state.drumRollPointerHold = null;
      };
      window.addEventListener("pointerup", globalPointerUpHandler);
    }

    function bindEls() {
      templateIds().forEach((id) => (els[id] = qs(id, root)));
    }

    function populateStyles() {
      Object.keys(styleDefaults).forEach((style) => {
        const opt = document.createElement("option");
        opt.value = style;
        opt.textContent = style;
        els.styleSelect.appendChild(opt);
      });
      els.styleSelect.value = state.style;
    }

    function populateChannels() {
      for (let i = 1; i <= 16; i++) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = String(i);
        els.midiChannelSelect.appendChild(opt);
      }
      els.midiChannelSelect.value = "1";
    }

    function bindEvents() {
      els.styleSelect.addEventListener("change", () => {
        state.style = els.styleSelect.value;
        state.bpm = styleDefaults[state.style].bpm;
        els.bpmInput.value = state.bpm;
        setTransportBpm(state.bpm);
        generatePattern();
      });
      els.variationSelect.addEventListener("change", () => {
        state.variation = els.variationSelect.value;
        generatePattern();
      });
      els.lengthSelect.addEventListener("change", () => {
        state.length = Number(els.lengthSelect.value);
        regenerateTrackLengths();
        render();
      });
      els.volcaSelect.addEventListener("change", () => {
        const next = els.volcaSelect.value;
        if (next === "fm") {
          // Keep the last non-FM style target persisted.
          els.volcaSelect.value = state.volca;
          window.location.hash = "#/fm";
          return;
        }
        localStorage.setItem(VOLCA_SELECTION_KEY, next);
        applyVolcaProfile(false);
        generatePattern();
      });
      els.bpmInput.addEventListener("input", () => {
        state.bpm = clamp(Number(els.bpmInput.value) || 120, 40, 240);
        els.bpmInput.value = state.bpm;
        setTransportBpm(state.bpm);
        setStatus(`BPM ${state.bpm}`);
      });
      els.generateBtn.addEventListener("click", generatePattern);
      els.clearBtn.addEventListener("click", clearPattern);
      els.playBtn.addEventListener("click", togglePlay);
      els.saveBtn.addEventListener("click", savePattern);
      els.loadBtn.addEventListener("click", loadPattern);
      els.addTrackBtn.addEventListener("click", () => openAddTrackDialog());
      els.removeTrackBtn.addEventListener("click", () => removeTrack());
      els.addTrackConfirmBtn.addEventListener("click", () => {
        const idx = Number(els.addTrackSelect.value);
        const template = state.trackTemplates.find((t) => t.index === idx);
        addTrackFromTemplate(template, true);
        closeAddTrackDialog();
      });
      els.addTrackCancelBtn.addEventListener("click", closeAddTrackDialog);
      els.addTrackModal.addEventListener("click", (e) => {
        if (e.target === els.addTrackModal) closeAddTrackDialog();
      });

      els.velocityConfirmBtn.addEventListener("click", () => {
        const trackIndex = Number(els.velocityModal.dataset.trackIndex);
        const stepIndex = Number(els.velocityModal.dataset.stepIndex);
        const nextLevel = clamp(Number(els.velocityInput.value) || 3, 1, 5);
        const next = velocityFromVolumeLevel(nextLevel);
        const track = state.tracks[trackIndex];
        if (!track) return closeVelocityDialog();
        const cell = normalizeCell(track.steps[stepIndex]);
        cell.velocity = next;
        track.steps[stepIndex] = cell;
        closeVelocityDialog();
        render();
        setStatus(`${track.name} step ${stepIndex + 1} volume ${nextLevel} (${next})`);
      });
      els.velocityCancelBtn.addEventListener("click", closeVelocityDialog);
      els.velocityModal.addEventListener("click", (e) => {
        if (e.target === els.velocityModal) closeVelocityDialog();
      });
      els.midiEnable.addEventListener("change", () => {
        state.midiEnabled = els.midiEnable.checked;
        if (state.isPlaying && state.midiEnabled && state.midiOutputActive && state.midiOutputId) {
          sendMidiTransport("continue");
        }
        updateMidiActiveModeState();
        setStatus(state.midiEnabled ? "MIDI aan" : "MIDI uit");
        persistMidiSessionFromState(MIDI_DEVICE.STYLE, state);
      });
      els.styleMidiOutputActiveToggle.addEventListener("change", () => {
        state.midiOutputActive = !!els.styleMidiOutputActiveToggle.checked;
        updateMidiActiveModeState();
        if (!state.midiOutputActive) {
          setStatus(state.midiEnabled ? "Output tijdelijk uit" : "MIDI uit + output uit");
          return;
        }
        if (state.isPlaying && state.midiEnabled && state.midiOutputId) {
          sendMidiTransport("continue");
        }
        setStatus(state.midiEnabled ? "Output actief" : "Output actief (MIDI staat uit)");
        persistMidiSessionFromState(MIDI_DEVICE.STYLE, state);
      });
      els.midiOutputSelect.addEventListener("change", () => {
        const previousOutputId = state.midiOutputId;
        state.midiOutputId = els.midiOutputSelect.value;
        updateMidiActiveModeState();
        if (state.isPlaying && previousOutputId && previousOutputId !== state.midiOutputId) {
          sendMidiTransport(false, previousOutputId);
        }
        if (state.isPlaying && state.midiEnabled && state.midiOutputActive && state.midiOutputId) {
          sendMidiTransport("continue");
        }
        setStatus(`MIDI output: ${els.midiOutputSelect.selectedOptions[0]?.textContent || "geen"}`);
        persistMidiSessionFromState(MIDI_DEVICE.STYLE, state);
      });
      els.midiChannelSelect.addEventListener("change", () => setStatus(`Kanaal ${els.midiChannelSelect.value}`));
      els.midiChannelSelect.addEventListener("change", updateMidiActiveModeState);
      els.clockEnable.addEventListener("change", () => {
        state.midiClockEnabled = els.clockEnable.checked;
        persistMidiSessionFromState(MIDI_DEVICE.STYLE, state);
      });
      els.midiTransportCommandsToggle.addEventListener("change", () => {
        state.midiTransportCommands = !!els.midiTransportCommandsToggle.checked;
        persistMidiSessionFromState(MIDI_DEVICE.STYLE, state);
        setStatus(
          state.midiTransportCommands
            ? "MIDI Start/Stop naar hardware aan"
            : "Alleen clock + noten (geen MMC Start/Stop)"
        );
      });
      els.drumMultiToggle.addEventListener("change", () => {
        state.drumMultiMode = !!els.drumMultiToggle.checked;
        render();
        setStatus(state.drumMultiMode ? "Drum Multi aan (6ch)" : "Drum Single aan (1ch)");
      });
      els.drumMultiNoteOffToggle.addEventListener("change", () => {
        state.drumMultiSendNoteOff = !!els.drumMultiNoteOffToggle.checked;
        setStatus(state.drumMultiSendNoteOff ? "Drum Multi Note-Off aan" : "Drum Multi Note-Off uit (test)");
      });
      els.drumBufferMsInput.addEventListener("input", () => {
        state.drumCcLeadMs = clamp(Number(els.drumBufferMsInput.value) || DRUM_MULTI_CC_LEAD_MS, 0, 40);
        els.drumBufferMsInput.value = String(state.drumCcLeadMs);
        setStatus(`Drum buffer vooraf ${state.drumCcLeadMs} ms`);
      });
      els.drumCcStaggerMsInput.addEventListener("input", () => {
        state.drumCcStaggerMs = clamp(Number(els.drumCcStaggerMsInput.value) || DRUM_MULTI_CC_STAGGER_MS, 0, 20);
        els.drumCcStaggerMsInput.value = String(state.drumCcStaggerMs);
        setStatus(`Drum CC stagger ${state.drumCcStaggerMs} ms`);
      });
      els.drumNoteStaggerMsInput.addEventListener("input", () => {
        state.drumNoteStaggerMs = clamp(Number(els.drumNoteStaggerMsInput.value) || DRUM_MULTI_NOTE_STAGGER_MS, 0, 20);
        els.drumNoteStaggerMsInput.value = String(state.drumNoteStaggerMs);
        setStatus(`Drum note stagger ${state.drumNoteStaggerMs} ms`);
      });
      els.settingsToggleBtn.addEventListener("click", toggleSettingsPanel);

      globalKeydownHandler = onKeydown;
      document.addEventListener("keydown", globalKeydownHandler);
      document.addEventListener("keyup", onKeyup);
    }

    function toggleSettingsPanel(forceOpen) {
      const shouldOpen =
        typeof forceOpen === "boolean" ? forceOpen : els.controlStack.classList.contains("compact");
      els.controlStack.classList.toggle("compact", !shouldOpen);
      els.settingsToggleBtn.setAttribute("aria-expanded", String(shouldOpen));
      els.settingsToggleBtn.textContent = shouldOpen ? "▲ Instellingen omhoog" : "▼ Instellingen omlaag";
    }

    function setupAudio() {
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContext();
    }

    async function setupMidi() {
      const res = await requestMidiAccess();
      if (!res.ok) {
        els.midiHint.textContent = res.reason;
        return;
      }

      state.midiAccess = res.access;
      refreshMidiOutputs();
      state.midiAccess.onstatechange = refreshMidiOutputs;
      handleStyleMidiSessionAfterOutputsReady();
    }

    function refreshMidiOutputs() {
      if (!state.midiAccess) return;
      const current = els.midiOutputSelect.value;
      els.midiOutputSelect.innerHTML = '<option value="">Geen output</option>';
      for (const output of listMidiOutputs(state.midiAccess)) {
        const opt = document.createElement("option");
        opt.value = output.id;
        opt.textContent = output.name;
        els.midiOutputSelect.appendChild(opt);
      }
      els.midiOutputSelect.value = state.midiOutputId || current || "";
      state.midiOutputId = els.midiOutputSelect.value;
    }

    function mergeMidiSessionIntoStyleState() {
      const s = getMidiSessionDevice("style");
      state.midiEnabled = !!s.midiEnabled;
      state.midiOutputActive = s.midiOutputActive !== false;
      state.midiClockEnabled = s.midiClockEnabled !== false;
      state.midiTransportCommands = !!s.midiTransportCommands;
      state.midiOutputId = s.midiOutputId || "";
      els.midiEnable.checked = state.midiEnabled;
      els.styleMidiOutputActiveToggle.checked = state.midiOutputActive;
      els.clockEnable.checked = state.midiClockEnabled;
      els.midiTransportCommandsToggle.checked = state.midiTransportCommands;
      if (state.midiAccess) {
        els.midiOutputSelect.value = state.midiOutputId;
        if (els.midiOutputSelect.value !== state.midiOutputId) {
          state.midiOutputId = els.midiOutputSelect.value;
        }
      }
      updateMidiActiveModeState();
    }

    function handleStyleMidiSessionAfterOutputsReady() {
      if (styleUsedDraftOnMount) {
        persistMidiSessionFromState(MIDI_DEVICE.STYLE, state);
      } else {
        mergeMidiSessionIntoStyleState();
      }
    }

    function snapshotState() {
      return {
        style: state.style,
        variation: state.variation,
        length: state.length,
        bpm: state.bpm,
        volca: state.volca,
        activeTrack: state.activeTrack,
        activeSetting: state.activeSetting,
        midiOutputId: state.midiOutputId,
        midiEnabled: state.midiEnabled,
        midiOutputActive: state.midiOutputActive,
        midiClockEnabled: state.midiClockEnabled,
        midiTransportCommands: state.midiTransportCommands,
        drumMultiMode: state.drumMultiMode,
        drumMultiSendNoteOff: state.drumMultiSendNoteOff,
        drumCcLeadMs: state.drumCcLeadMs,
        drumCcStaggerMs: state.drumCcStaggerMs,
        drumNoteStaggerMs: state.drumNoteStaggerMs,
        tracks: state.tracks.map((track) => structuredClone(track))
      };
    }

    function restoreState(saved) {
      state.style = saved.style || state.style;
      state.variation = saved.variation || state.variation;
      state.length = clamp(Number(saved.length) || state.length, 8, 64);
      state.bpm = clamp(Number(saved.bpm) || state.bpm, 40, 240);
      state.volca = saved.volca || state.volca;
      state.activeTrack = Number(saved.activeTrack) || 0;
      state.activeSetting = saved.activeSetting || state.activeSetting;
      state.midiOutputId = saved.midiOutputId || "";
      state.midiEnabled = saved.midiEnabled ?? state.midiEnabled;
      state.midiOutputActive = saved.midiOutputActive ?? state.midiOutputActive;
      state.midiClockEnabled = saved.midiClockEnabled ?? state.midiClockEnabled;
      state.midiTransportCommands = saved.midiTransportCommands ?? state.midiTransportCommands;
      state.drumMultiMode = !!saved.drumMultiMode;
      state.drumMultiSendNoteOff = saved.drumMultiSendNoteOff ?? state.drumMultiSendNoteOff;
      state.drumCcLeadMs = clamp(Number(saved.drumCcLeadMs) || state.drumCcLeadMs, 0, 40);
      state.drumCcStaggerMs = clamp(Number(saved.drumCcStaggerMs) || state.drumCcStaggerMs, 0, 20);
      state.drumNoteStaggerMs = clamp(Number(saved.drumNoteStaggerMs) || state.drumNoteStaggerMs, 0, 20);
      els.styleSelect.value = state.style;
      els.variationSelect.value = state.variation;
      els.lengthSelect.value = String(state.length);
      els.volcaSelect.value = state.volca;
      els.bpmInput.value = String(state.bpm);
      els.midiEnable.checked = !!state.midiEnabled;
      els.styleMidiOutputActiveToggle.checked = !!state.midiOutputActive;
      els.clockEnable.checked = !!state.midiClockEnabled;
      els.midiTransportCommandsToggle.checked = !!state.midiTransportCommands;
      updateMidiActiveModeState();
      els.drumMultiToggle.checked = !!state.drumMultiMode;
      els.drumMultiNoteOffToggle.checked = !!state.drumMultiSendNoteOff;
      els.drumBufferMsInput.value = String(state.drumCcLeadMs);
      els.drumCcStaggerMsInput.value = String(state.drumCcStaggerMs);
      els.drumNoteStaggerMsInput.value = String(state.drumNoteStaggerMs);
      applyVolcaProfile(false);
      state.tracks = (saved.tracks || []).map((track) => ({ ...track, id: crypto.randomUUID() }));
      state.activeTrack = clamp(state.activeTrack, 0, Math.max(0, state.tracks.length - 1));
      regenerateTrackLengths();
      updateDrumMultiUI();
      render();
      setTransportBpm(state.bpm);
      persistMidiSessionFromState(MIDI_DEVICE.STYLE, state);
    }

    function createTrackFromTemplate(template, index) {
      return {
        id: crypto.randomUUID(),
        index,
        name: template.name,
        midiNote: template.midiNote,
        freq: template.freq,
        mute: false,
        solo: false,
        probability: 100,
        swing: 0,
        accent: 100,
        midiChannel: clamp((template.index ?? index) + 1, 1, 16),
        settingsOpen: false,
        cursorStep: 0,
        steps: Array.from({ length: state.length }, () => ({ on: false, velocity: DEFAULT_STEP_VELOCITY })),
        rollNotes: Array.from({ length: state.length }, () => null),
        rollInputOctave: midiToDrumRollOctave(template.midiNote)
      };
    }

    function applyVolcaProfile(resetPattern) {
      state.volca = els.volcaSelect.value;
      if (state.volca === "fm") return;
      const profile = volcaProfiles[state.volca];
      if (!profile) return;
      els.midiChannelSelect.value = String(profile.channel);
      const drumMidiNote =
        state.volca === "drum"
          ? " · Volca Drum + Drum Multi: CC 28 alleen bij gewijzigde pitch per part; note-stagger 5 ms tussen kanalen."
          : "";
      els.midiHint.textContent = `Advies ${profile.name}: kanaal ${profile.channel} · tracks ${profile.initialVisible}/${profile.maxTracks} zichtbaar · swing = timing · accent = best effort${drumMidiNote}`;
      state.trackTemplates = profile.tracks.map((t, index) => ({ ...t, index }));
      state.maxTracks = Math.min(profile.maxTracks || profile.tracks.length, state.trackTemplates.length);
      const visibleCount = Math.min(profile.initialVisible || 4, state.maxTracks);
      state.tracks = state.trackTemplates.slice(0, visibleCount).map((t, index) => createTrackFromTemplate(t, index));
      state.activeTrack = 0;
      state.activeSetting = "probability";
      if (resetPattern) {
        generatePattern();
      }
      updateDrumMultiUI();
      render();
    }

    function updateDrumMultiUI() {
      const isDrum = state.volca === "drum";
      els.drumMultiWrap.classList.toggle("hidden", !isDrum);
      els.drumMultiNoteOffWrap.classList.toggle("hidden", !isDrum);
      if (!isDrum) {
        state.drumMultiMode = false;
        els.drumMultiToggle.checked = false;
      }
    }

    function addTrack(announce = true) {
      // Backwards compatible: keep old behavior for load flow, but choose the first available template.
      const remaining = getRemainingTemplates();
      if (!remaining.length) {
        if (announce) setStatus("Geen extra sound beschikbaar");
        return false;
      }
      return addTrackFromTemplate(remaining[0], announce);
    }

    function addTrackFromTemplate(template, announce = true) {
      if (state.tracks.length >= state.maxTracks) {
        if (announce) setStatus("Maximum aantal tracks bereikt");
        return false;
      }
      if (!template) {
        if (announce) setStatus("Geen extra sound beschikbaar");
        return false;
      }
      const exists = state.tracks.some((t) => t.midiNote === template.midiNote);
      if (exists) {
        if (announce) setStatus(`${template.name} bestaat al`);
        return false;
      }
      const track = createTrackFromTemplate(template, state.tracks.length);
      state.tracks.push(track);
      state.activeTrack = state.tracks.length - 1;
      render();
      if (announce) setStatus(`${track.name} toegevoegd (${state.tracks.length}/${state.maxTracks})`);
      return true;
    }

    function getRemainingTemplates() {
      const used = new Set(state.tracks.map((t) => t.midiNote));
      return state.trackTemplates.filter((t) => !used.has(t.midiNote));
    }

    function openAddTrackDialog() {
      const remaining = getRemainingTemplates();
      if (!remaining.length) {
        setStatus("Geen extra sound beschikbaar");
        return;
      }

      const modal = els.addTrackModal;
      const select = els.addTrackSelect;
      select.innerHTML = "";
      remaining.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = String(t.index);
        opt.textContent = t.name;
        select.appendChild(opt);
      });

      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      select.focus();
    }

    function closeAddTrackDialog() {
      const modal = els.addTrackModal;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
    }

    function openVelocityDialog(trackIndex, stepIndex) {
      const track = state.tracks[trackIndex];
      if (!track) return;
      const cell = normalizeCell(track.steps[stepIndex]);
      els.velocityInput.value = String(volumeLevelFromVelocity(cell.velocity));
      els.velocityModal.dataset.trackIndex = String(trackIndex);
      els.velocityModal.dataset.stepIndex = String(stepIndex);
      els.velocityModal.classList.remove("hidden");
      els.velocityModal.setAttribute("aria-hidden", "false");
      els.velocityInput.focus();
    }

    function closeVelocityDialog() {
      els.velocityModal.classList.add("hidden");
      els.velocityModal.setAttribute("aria-hidden", "true");
      els.velocityModal.dataset.trackIndex = "";
      els.velocityModal.dataset.stepIndex = "";
    }

    function removeTrack(announce = true) {
      const profile = volcaProfiles[state.volca];
      const minimum = Math.min(profile.initialVisible || 4, state.maxTracks);
      if (state.tracks.length <= minimum) {
        if (announce) setStatus(`Minimaal ${minimum} tracks zichtbaar voor ${profile.name}`);
        return false;
      }
      const removed = state.tracks.pop();
      state.activeTrack = clamp(state.activeTrack, 0, state.tracks.length - 1);
      render();
      if (announce) setStatus(`${removed.name} verwijderd`);
      return true;
    }

    function regenerateTrackLengths() {
      state.tracks.forEach((track) => {
        track.steps = Array.from({ length: state.length }, (_, i) => {
          const prev = track.steps[i];
          if (prev && typeof prev === "object") return { on: !!prev.on, velocity: clamp(Number(prev.velocity) || 100, 0, 127) };
          // Back-compat from boolean saves.
          return { on: !!prev, velocity: DEFAULT_STEP_VELOCITY };
        });
        track.rollNotes = Array.from({ length: state.length }, (_, i) =>
          parseRollSlot(track.rollNotes?.[i])
        );
        track.cursorStep = clamp(track.cursorStep ?? 0, 0, state.length - 1);
      });
      if (state.currentStep >= state.length) state.currentStep = 0;
    }

    function clearPattern() {
      state.tracks.forEach((track) => {
        track.steps = Array.from({ length: state.length }, () => ({ on: false, velocity: DEFAULT_STEP_VELOCITY }));
        track.rollNotes = Array.from({ length: state.length }, () => null);
      });
      resetDrumMultiCc28Memory();
      render();
      setStatus("Pattern gewist");
    }

    function generatePattern() {
      const cfg = styleDefaults[state.style];
      if (!cfg) return;
      resetDrumMultiCc28Memory();
      state.tracks.forEach((track) => {
        track.steps = Array.from({ length: state.length }, () => ({ on: false, velocity: DEFAULT_STEP_VELOCITY }));
        track.rollNotes = Array.from({ length: state.length }, () => null);
        fillTrackFromStylePreset(track, cfg, state.variation, state.length);
      });
      render();
      setStatus(`${state.style} · ${grooveLabel(state.variation)} · ${cfg.bpm} BPM`);
    }

    function grooveLabel(variation) {
      const opt = [...els.variationSelect.options].find((o) => o.value === variation);
      return opt?.textContent || variation;
    }

    /** Voorgeprogrammeerde patronen voor Kick, Snare, Closed Hat (hi-hat), Hi Tom (ghost) — op tracknaam. */
    function fillTrackFromStylePreset(track, cfg, variation, length) {
      const key = (track.name || "").trim().toLowerCase();
      const oneBar = 16;
      const repeatCount = Math.max(1, length / oneBar);
      const localSteps = Array.from({ length: oneBar }, () => false);
      if (key === "kick") applyKick(localSteps, cfg.kick, variation);
      else if (key === "snare") applySnare(localSteps, cfg.snare, variation);
      else if (key === "closed hat") applyHat(localSteps, cfg.hihat, variation);
      else if (key === "hi tom") applyGhost(localSteps, cfg.ghost, variation);
      else return;
      for (let r = 0; r < repeatCount; r++) {
        for (let i = 0; i < Math.min(oneBar, length - r * oneBar); i++) {
          const globalStep = r * oneBar + i;
          const isOn = !!localSteps[i];
          track.steps[globalStep].on = isOn;
          if (isOn) {
            track.rollNotes[globalStep] = defaultRollNoteForTrack(track);
          } else {
            track.rollNotes[globalStep] = null;
          }
        }
      }
    }

    function normalizeRollInputOctave(v) {
      return clamp(Number(v) || DRUM_ROLL_OCTAVE_MIN, DRUM_ROLL_OCTAVE_MIN, DRUM_ROLL_OCTAVE_MAX);
    }

    function midiToDrumRollOctave(midi) {
      const octave = Math.floor((clamp(Number(midi) || 60, 0, 127) / 12)) - 1;
      return clamp(octave, DRUM_ROLL_OCTAVE_MIN, DRUM_ROLL_OCTAVE_MAX);
    }

    function drumRollMidiFromNoteAndOctave(noteIndex, octave) {
      return clamp((normalizeRollInputOctave(octave) + 1) * 12 + clamp(noteIndex, 0, 11), 0, 127);
    }

    function defaultRollNoteForTrack(track) {
      const target = clamp(Number(track.midiNote) || 60, 0, 127);
      const noteIndex = target % 12;
      const octave = normalizeRollInputOctave(track.rollInputOctave ?? midiToDrumRollOctave(target));
      return drumRollMidiFromNoteAndOctave(noteIndex, octave);
    }

    /** Pianoroll-slot uit state/JSON: alleen geldig als het echt een MIDI-noot is (ook na string uit storage). */
    function parseRollSlot(value) {
      if (value === null || value === undefined || value === "") return null;
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return clamp(Math.round(n), 0, 127);
    }

    function applyKick(steps, pattern, variation) {
      if (pattern === "four") [0, 4, 8, 12].forEach((i) => (steps[i] = true));
      else pattern.forEach((i) => (steps[i] = true));
      if (variation === "busy" && !steps[14]) steps[14] = true;
      if (variation === "minimal") [2, 6, 10, 14].forEach((i) => {
        if (Math.random() < 0.9) steps[i] = false;
      });
      if (variation === "groovy" && !steps[11]) steps[11] = true;
      if (variation === "broken") {
        steps[8] = false;
        steps[10] = true;
      }
    }

    function applySnare(steps, pattern, variation) {
      pattern.forEach((i) => (steps[i] = true));
      if (variation === "busy") steps[15] = true;
      if (variation === "minimal") steps[15] = false;
      if (variation === "broken") {
        steps[12] = false;
        steps[11] = true;
      }
    }

    function applyHat(steps, mode, variation) {
      const sets = {
        offbeat: [2, 6, 10, 14],
        straight: [0, 2, 4, 6, 8, 10, 12, 14],
        busy: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14, 15],
        half: [2, 10],
        sparse: [0, 8],
        lazy: [3, 7, 11, 15]
      };
      (sets[mode] || sets.offbeat).forEach((i) => (steps[i] = true));
      if (variation === "minimal") [0, 4, 8, 12].forEach((i) => (steps[i] = false));
      if (variation === "busy") [1, 5, 9, 13].forEach((i) => (steps[i] = true));
    }

    function applyGhost(steps, pattern, variation) {
      pattern.forEach((i) => (steps[i] = true));
      if (variation === "default") steps[3] = false;
      if (variation === "minimal")
        pattern.forEach((i, idx) => {
          if (idx > 0) steps[i] = false;
        });
      if (variation === "groovy") steps[9] = true;
      if (variation === "busy") steps[5] = true;
    }

    /** Meerdere tracks op hetzelfde MIDI-kanaal → zelfde Volca-part; CC/pitch overschrijven elkaar. */
    function duplicateDrumMultiMidiChannels() {
      if (state.volca !== "drum" || !state.drumMultiMode) return [];
      const seen = new Map();
      const dups = new Set();
      for (const t of state.tracks) {
        const ch = clamp(Number(t.midiChannel) || 1, 1, 16);
        if (seen.has(ch)) dups.add(ch);
        else seen.set(ch, t.name);
      }
      return [...dups].sort((a, b) => a - b);
    }

    function updateTrackControls() {
      let profile = volcaProfiles[state.volca];
      if (!profile) {
        state.volca = els.volcaSelect?.value || "beats";
        profile = volcaProfiles[state.volca] || volcaProfiles.beats;
      }
      const minimum = Math.min(profile.initialVisible || 4, state.maxTracks);
      els.trackCountText.textContent = `${state.tracks.length}/${state.maxTracks} tracks`;
      const dupCh = duplicateDrumMultiMidiChannels();
      const dupHint =
        dupCh.length > 0
          ? ` Let op: tracks delen MIDI-kanaal ${dupCh.join(", ")} — parts beïnvloeden elkaar; kies unieke Ch per part (1–6).`
          : "";
      els.trackHelpText.textContent =
        profile.name === "Volca Beats"
          ? "Standaard: Kick, Snare, Closed Hat, Hi Tom. Genereer vult die 4 volgens stijl + groove; andere tracks leeg. Track + voegt sounds toe."
          : profile.name === "Volca Drum" && state.drumMultiMode
            ? `Drum Multi: vaste 12x${state.length} piano roll zonder scroll. Houd klik vast en druk 1-5 voor octaaf per noot.${dupHint}`
            : `Bij ${profile.name} start je met ${minimum} tracks en kun je uitbreiden tot ${state.maxTracks}.`;
      els.addTrackBtn.disabled = state.tracks.length >= state.maxTracks;
      els.removeTrackBtn.disabled = state.tracks.length <= minimum;
    }

    function render() {
      updateTrackControls();
      els.tracksContainer.innerHTML = "";
      els.tracksContainer.classList.toggle(
        "has-active-track",
        state.activeTrack !== null && state.activeTrack !== undefined
      );

      state.tracks.forEach((track, trackIndex) => {
        const isActive = trackIndex === state.activeTrack;
        const isOpen = !!track.settingsOpen;

        const wrap = document.createElement("section");
        wrap.className = `track len-${state.length}${isActive ? " active" : ""}${isOpen ? " panel-open" : " panel-closed"}`;
        wrap.dataset.trackIndex = trackIndex;

        const head = document.createElement("div");
        head.className = "track-head";

        const title = document.createElement("div");
        title.className = "track-title";
        title.innerHTML = `
          <div class="track-title-stack">
            <button type="button" class="track-toggle-label ${isOpen ? "open" : ""}" data-action="settings" aria-expanded="${isOpen ? "true" : "false"}">
              <span class="track-toggle-caret">${isOpen ? "▼" : "▶"}</span>
              <span class="track-name">${track.name}</span>
            </button>
            <div class="track-badge">BPM ${state.bpm} · Note ${track.midiNote} · <b>Slot ${trackIndex + 1}</b></div>
          </div>
        `;

        const preview = document.createElement("div");
        preview.className = `track-preview grid-shell inline-grid-shell${isActive ? " active-electra" : ""}${isActive && state.isPlaying ? " playing-electra" : ""}`;
        const previewGrid = document.createElement("div");
        previewGrid.className = "step-grid preview-grid";
        track.steps.forEach((_isOn, stepIndex) => {
          const wrapStep = document.createElement("div");
          wrapStep.className = "step-wrap";

          const step = document.createElement("button");
          step.type = "button";
          const isCursor = isActive && ensureTrackCursor(trackIndex) === stepIndex;
          const cell = normalizeCell(track.steps[stepIndex]);
          step.className = `step${cell.on ? " on" : ""}${state.currentStep === stepIndex && state.isPlaying ? " current" : ""}${isCursor ? " selected" : ""}`;
          const vel = clamp(Number(cell.velocity) || 0, 0, 127);
          const volumeLevel = volumeLevelFromVelocity(vel);
          step.style.setProperty("--vel", String(cell.on ? vel / 127 : 0));
          step.innerHTML = `<span class="step-num">${stepIndex + 1}</span>`;
          step.dataset.trackIndex = trackIndex;
          step.dataset.stepIndex = stepIndex;
          step.tabIndex = 0;
          step.addEventListener("click", () => {
            setActiveTrack(trackIndex, false);
            track.cursorStep = stepIndex;
            toggleStep(trackIndex, stepIndex);
          });
          step.addEventListener("pointerdown", () => {
            setActiveTrack(trackIndex, false);
            track.cursorStep = stepIndex;
            state.drawMode = !normalizeCell(track.steps[stepIndex]).on;
            setStep(trackIndex, stepIndex, state.drawMode);
          });
          step.addEventListener("pointerenter", (ev) => {
            if (ev.buttons !== 1 || state.drawMode === null) return;
            track.cursorStep = stepIndex;
            setStep(trackIndex, stepIndex, state.drawMode);
          });

          const velBtn = document.createElement("button");
          velBtn.type = "button";
          velBtn.className = "step-vel-btn";
          velBtn.textContent = String(volumeLevel);
          velBtn.title = `Volume stand ${volumeLevel} (${vel})`;
          velBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setActiveTrack(trackIndex, false);
            track.cursorStep = stepIndex;
            openVelocityDialog(trackIndex, stepIndex);
          });

          wrapStep.appendChild(step);
          wrapStep.appendChild(velBtn);
          previewGrid.appendChild(wrapStep);
        });
        preview.appendChild(previewGrid);

        const actions = document.createElement("div");
        actions.className = "track-actions";
        actions.innerHTML = `
          <button class="track-btn icon-btn mute-btn ${track.mute ? "active-state" : ""}" data-action="mute" title="Mute" aria-label="Mute track"><span aria-hidden="true">M</span></button>
          <button class="track-btn icon-btn solo-btn ${track.solo ? "solo-state" : ""}" data-action="solo" title="Solo — alleen deze track (andere solo uit)" aria-label="Solo track"><span aria-hidden="true">S</span></button>
          <button class="track-btn icon-btn settings-btn ${track.settingsOpen ? "active-state" : ""}" data-action="settings" title="Instellingen" aria-label="Instellingen"><span aria-hidden="true">⚙</span></button>
          <button class="track-btn icon-btn delete-btn" data-action="delete" title="Verwijder track" aria-label="Verwijder track"><span aria-hidden="true">✕</span></button>
        `;

        head.appendChild(title);
        head.appendChild(preview);
        head.appendChild(actions);

        const panel = document.createElement("div");
        panel.className = `track-panel ${isOpen ? "open" : ""}`;

        if (isOpen) {
          const controlsRow = document.createElement("div");
          controlsRow.className = "panel-controls-row";
          controlsRow.innerHTML = `
            ${renderSettingRow(track, "probability")}
            ${renderSettingRow(track, "swing")}
            ${renderSettingRow(track, "accent")}
          `;
          controlsRow.addEventListener("click", (e) => {
            const row = e.target.closest(".range-row");
            if (!row) return;
            setActiveSetting(row.dataset.prop, false);
          });
          controlsRow.addEventListener("input", (e) => {
            const prop = e.target.dataset.prop;
            if (!prop) return;
            setActiveTrack(trackIndex, false);
            setActiveSetting(prop, false);
            track[prop] = clampValueForProp(prop, Number(e.target.value));
            render();
          });
          panel.appendChild(controlsRow);

          if (state.volca === "drum" && state.drumMultiMode) {
            panel.appendChild(renderDrumRoll(track, trackIndex));
          }
        }

        head.addEventListener("click", (e) => {
          setActiveTrack(trackIndex, false);
          const actionTarget = e.target.closest("[data-action]");
          const action = actionTarget ? actionTarget.dataset.action : "";
          if (!action) return;
          if (action === "mute") toggleMute(trackIndex);
          if (action === "solo") toggleSolo(trackIndex);
          if (action === "settings") toggleTrackSettings(trackIndex);
          if (action === "delete") deleteTrack(trackIndex);
        });

        panel.addEventListener("click", (e) => {
          const actionTarget = e.target.closest("[data-action]");
          if (!actionTarget) return;
          setActiveTrack(trackIndex, false);
          const action = actionTarget.dataset.action;
          if (action === "mute") toggleMute(trackIndex);
          if (action === "solo") toggleSolo(trackIndex);
          if (action === "settings") toggleTrackSettings(trackIndex);
          if (action === "delete") deleteTrack(trackIndex);
        });

        wrap.addEventListener("click", (e) => {
          if (!e.target.closest(".step") && !e.target.closest(".track-head") && !e.target.closest(".track-panel")) {
            setActiveTrack(trackIndex);
          }
        });

        wrap.appendChild(head);
        wrap.appendChild(panel);
        els.tracksContainer.appendChild(wrap);
      });

      updatePlaybackVisuals();
    }

    function updatePlaybackVisuals() {
      if (!els.tracksContainer) return;
      els.tracksContainer.classList.toggle(
        "has-active-track",
        state.activeTrack !== null && state.activeTrack !== undefined
      );
      const trackEls = els.tracksContainer.querySelectorAll(".track");
      trackEls.forEach((wrap, trackIndex) => {
        const isActive = trackIndex === state.activeTrack;
        wrap.classList.toggle("active", isActive);
        const preview = wrap.querySelector(".track-preview");
        if (preview) {
          preview.classList.toggle("active-electra", isActive);
          preview.classList.toggle("playing-electra", isActive && state.isPlaying);
        }
        const selectedStep = ensureTrackCursor(trackIndex);
        const steps = wrap.querySelectorAll(".step");
        steps.forEach((stepEl, stepIndex) => {
          stepEl.classList.toggle("current", state.isPlaying && stepIndex === state.currentStep);
          stepEl.classList.toggle("selected", isActive && stepIndex === selectedStep);
        });
      });
    }

    function renderSettingRow(track, prop) {
      const meta = settingMeta[prop];
      const selected = track.settingsOpen && state.activeTrack !== null && prop === state.activeSetting;
      return `
        <label class="range-row panel-range ${selected ? "selected" : ""}" data-prop="${prop}">
          <div class="panel-range-top">
            <span class="panel-range-title">${meta.label}</span>
            <span class="panel-range-short">${meta.short}</span>
            <output class="panel-range-value">${track[prop]}${meta.suffix}</output>
          </div>
          <div class="panel-range-slider-wrap">
            <input type="range" min="${meta.min}" max="${meta.max}" step="1" value="${track[prop]}" data-prop="${prop}">
          </div>
        </label>
      `;
    }

    function renderDrumRoll(track, trackIndex) {
      const wrap = document.createElement("div");
      wrap.className = "drum-roll-wrap";
      track.rollInputOctave = normalizeRollInputOctave(track.rollInputOctave ?? midiToDrumRollOctave(track.midiNote));
      const selectedStep = ensureTrackCursor(trackIndex);
      wrap.innerHTML = `
        <div class="drum-roll-head">
          <span title="12 rijen = notennamen. Klik en houd vast, druk daarna 1-5 om octaaf te kiezen.">Drum+ piano roll</span>
          <div class="drum-roll-head-actions">
            <label class="drum-roll-channel">
              Ch
              <select data-role="drum-track-channel">
                ${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}" ${track.midiChannel === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}
              </select>
            </label>
          </div>
        </div>
      `;

      const grid = document.createElement("div");
      grid.className = "drum-roll-grid";
      grid.style.setProperty("--grid-cols", String(state.length));

      const stepsHead = document.createElement("div");
      stepsHead.className = "drum-roll-steps-head";
      const headSpacer = document.createElement("div");
      headSpacer.className = "drum-roll-note";
      headSpacer.textContent = "";
      stepsHead.appendChild(headSpacer);
      for (let stepIndex = 0; stepIndex < state.length; stepIndex++) {
        const headCell = document.createElement("div");
        headCell.className = `drum-roll-step-num${stepIndex === selectedStep ? " selected" : ""}`;
        headCell.textContent = String(stepIndex + 1);
        headCell.title = "Step kolom";
        headCell.addEventListener("click", () => {
          setActiveTrack(trackIndex, false);
          track.cursorStep = stepIndex;
          render();
          setStatus(`${track.name} step ${stepIndex + 1} geselecteerd`);
        });
        stepsHead.appendChild(headCell);
      }
      grid.appendChild(stepsHead);

      DRUM_ROLL_NOTE_ROWS.forEach((rowMeta) => {
        const row = document.createElement("div");
        row.className = "drum-roll-row";

        const label = document.createElement("div");
        label.className = "drum-roll-note";
        label.textContent = rowMeta.name;
        row.appendChild(label);

        for (let stepIndex = 0; stepIndex < state.length; stepIndex++) {
          const cell = document.createElement("button");
          cell.type = "button";
          const current = parseRollSlot(track.rollNotes?.[stepIndex]);
          const isOn = current !== null && current % 12 === rowMeta.noteIndex;
          const octaveClass = isOn ? ` octave-${midiToDrumRollOctave(current)}` : "";
          const selectedClass = stepIndex === selectedStep ? " selected-col" : "";
          cell.className = `drum-roll-cell${isOn ? " on" : ""}${octaveClass}${selectedClass}`;
          cell.textContent = isOn ? "●" : "";
          const applyRowAtOctave = (octave) => {
            const nextMidi = drumRollMidiFromNoteAndOctave(rowMeta.noteIndex, octave);
            const already = parseRollSlot(track.rollNotes?.[stepIndex]) === nextMidi;
            track.rollNotes[stepIndex] = already ? null : nextMidi;
            const c = normalizeCell(track.steps[stepIndex]);
            c.on = track.rollNotes[stepIndex] !== null;
            track.steps[stepIndex] = c;
          };
          cell.addEventListener("pointerdown", () => {
            setActiveTrack(trackIndex, false);
            track.cursorStep = stepIndex;
            applyRowAtOctave(track.rollInputOctave);
            state.drumRollPointerHold = { trackIndex, stepIndex, noteIndex: rowMeta.noteIndex };
            render();
          });
          row.appendChild(cell);
        }
        grid.appendChild(row);
      });

      wrap.appendChild(grid);

      wrap.querySelector('[data-role="drum-track-channel"]')?.addEventListener("change", (e) => {
        track.midiChannel = clamp(Number(e.target.value) || 1, 1, 16);
        setStatus(`${track.name} MIDI kanaal ${track.midiChannel}`);
        render();
      });
      return wrap;
    }

    function midiNoteName(midi) {
      const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const octave = Math.floor(midi / 12) - 1;
      return `${names[midi % 12]}${octave}`;
    }

    function ensureTrackCursor(trackIndex) {
      const track = state.tracks[trackIndex];
      if (!track) return 0;
      if (typeof track.cursorStep !== "number" || Number.isNaN(track.cursorStep)) {
        track.cursorStep = 0;
      }
      track.cursorStep = clamp(track.cursorStep, 0, state.length - 1);
      return track.cursorStep;
    }

    function moveActiveStep(delta) {
      const track = state.tracks[state.activeTrack];
      if (!track) return;
      const current = ensureTrackCursor(state.activeTrack);
      track.cursorStep = (current + delta + state.length) % state.length;
      render();
      setStatus(`${track.name} step ${track.cursorStep + 1}`);
    }

    function toggleSelectedStep() {
      const track = state.tracks[state.activeTrack];
      if (!track) return;
      const stepIndex = ensureTrackCursor(state.activeTrack);
      const cell = normalizeCell(track.steps[stepIndex]);
      const nextValue = !cell.on;
      setStep(state.activeTrack, stepIndex, nextValue);
      setStatus(`${track.name} step ${stepIndex + 1} ${nextValue ? "aan" : "uit"}`);
    }

    function setActiveTrack(index, announce = true) {
      state.activeTrack = index;
      ensureTrackCursor(index);
      render();
      if (announce) {
        const track = state.tracks[index];
        setStatus(`Track ${index + 1} actief: ${track.name} · step ${track.cursorStep + 1}`);
      }
    }

    function toggleMute(index) {
      state.tracks[index].mute = !state.tracks[index].mute;
      render();
      setStatus(`${state.tracks[index].name} ${state.tracks[index].mute ? "gemute" : "unmute"}`);
    }

    function toggleSolo(index) {
      const track = state.tracks[index];
      if (!track) return;
      const turningOn = !track.solo;
      if (turningOn) {
        state.tracks.forEach((t, i) => {
          t.solo = i === index;
        });
      } else {
        track.solo = false;
      }
      render();
      setStatus(`${track.name} ${track.solo ? "solo (alleen deze track)" : "solo uit"}`);
    }

    function toggleTrackSettings(index = state.activeTrack) {
      const i = clamp(Number(index), 0, Math.max(0, state.tracks.length - 1));
      const track = state.tracks[i];
      if (!track) return;
      track.settingsOpen = !track.settingsOpen;
      state.activeTrack = i;
      if (track.settingsOpen && !state.activeSetting) state.activeSetting = "probability";
      render();
      setStatus(`${track.name} instellingen ${track.settingsOpen ? "open" : "dicht"}`);
    }

    function deleteTrack(index) {
      const profile = volcaProfiles[state.volca];
      const minimum = Math.min(profile?.initialVisible || 1, state.maxTracks);
      if (state.tracks.length <= minimum) {
        setStatus(`Minimaal ${minimum} tracks zichtbaar voor ${profile?.name || "dit profiel"}`);
        return false;
      }

      const removed = state.tracks.splice(index, 1)[0];
      if (!removed) return false;

      // Re-index and clamp selection.
      state.tracks.forEach((t, i) => (t.index = i));
      state.activeTrack = clamp(state.activeTrack, 0, state.tracks.length - 1);
      render();
      setStatus(`${removed.name} verwijderd`);
      return true;
    }

    function moveActiveTrackPosition(delta) {
      const from = clamp(Number(state.activeTrack), 0, Math.max(0, state.tracks.length - 1));
      const to = clamp(from + delta, 0, Math.max(0, state.tracks.length - 1));
      if (from === to) return false;
      const [track] = state.tracks.splice(from, 1);
      if (!track) return false;
      state.tracks.splice(to, 0, track);
      state.tracks.forEach((t, i) => (t.index = i));
      state.activeTrack = to;
      render();
      setStatus(`${track.name} verplaatst naar positie ${to + 1}`);
      return true;
    }

    function setActiveSetting(prop, announce = true) {
      if (!settingMeta[prop]) return;
      state.activeSetting = prop;
      render();
      if (announce) setStatus(`${settingMeta[prop].label} geselecteerd voor ${state.tracks[state.activeTrack].name}`);
    }

    function adjustActiveSetting(delta) {
      const track = state.tracks[state.activeTrack];
      if (!track?.settingsOpen) return false;
      const meta = settingMeta[state.activeSetting];
      if (!meta) return false;
      track[state.activeSetting] = clamp(track[state.activeSetting] + delta * meta.step, meta.min, meta.max);
      render();
      setStatus(`${track.name} ${meta.label}: ${track[state.activeSetting]}${meta.suffix}`);
      return true;
    }

    function clampValueForProp(prop, value) {
      const meta = settingMeta[prop];
      if (!meta) return value;
      return clamp(value, meta.min, meta.max);
    }

    function toggleStep(trackIndex, stepIndex) {
      const cell = normalizeCell(state.tracks[trackIndex].steps[stepIndex]);
      setStep(trackIndex, stepIndex, !cell.on);
    }

    function setStep(trackIndex, stepIndex, value) {
      const track = state.tracks[trackIndex];
      if (!track) return;
      const cell = normalizeCell(track.steps[stepIndex]);
      cell.on = !!value;
      if (typeof cell.velocity !== "number") cell.velocity = 100;
      track.steps[stepIndex] = cell;
      if (state.volca === "drum") {
        if (cell.on) {
          if (parseRollSlot(track.rollNotes?.[stepIndex]) === null) {
            track.rollNotes[stepIndex] = defaultRollNoteForTrack(track);
          }
        } else if (track.rollNotes) {
          track.rollNotes[stepIndex] = null;
        }
      }
      track.cursorStep = clamp(stepIndex, 0, state.length - 1);
      render();
    }

    function normalizeCell(cell) {
      if (cell && typeof cell === "object") {
        return { on: !!cell.on, velocity: clamp(Number(cell.velocity) || 0, 0, 127) };
      }
      return { on: !!cell, velocity: DEFAULT_STEP_VELOCITY };
    }

    function velocityFromVolumeLevel(level) {
      const safeLevel = clamp(Number(level) || 3, 1, 5);
      return VOLUME_LEVELS[safeLevel - 1].velocity;
    }

    function volumeLevelFromVelocity(velocity) {
      const target = clamp(Number(velocity) || 0, 0, 127);
      let nearest = VOLUME_LEVELS[0];
      let nearestDiff = Math.abs(target - nearest.velocity);
      for (const candidate of VOLUME_LEVELS) {
        const diff = Math.abs(target - candidate.velocity);
        if (diff < nearestDiff) {
          nearest = candidate;
          nearestDiff = diff;
        }
      }
      return nearest.step;
    }

    function onKeydown(e) {
      if (root.hidden) return;
      if (e.key.toLowerCase() === "o") {
        state.octaveHotkeyHeld = true;
        return;
      }
      if (state.drumRollPointerHold) {
        const octaveNumber = Number(e.key);
        if (octaveNumber >= DRUM_ROLL_OCTAVE_MIN && octaveNumber <= DRUM_ROLL_OCTAVE_MAX) {
          e.preventDefault();
          const hold = state.drumRollPointerHold;
          const track = state.tracks[hold.trackIndex];
          if (!track) return;
          track.rollInputOctave = normalizeRollInputOctave(octaveNumber);
          const nextMidi = drumRollMidiFromNoteAndOctave(hold.noteIndex, octaveNumber);
          track.rollNotes[hold.stepIndex] = nextMidi;
          const c = normalizeCell(track.steps[hold.stepIndex]);
          c.on = true;
          track.steps[hold.stepIndex] = c;
          setStatus(`${track.name} step ${hold.stepIndex + 1} ${midiNoteName(nextMidi)} (octaaf ${octaveNumber})`);
          render();
          return;
        }
      }
      if (state.octaveHotkeyHeld) {
        const octaveNumber = Number(e.key);
        if (octaveNumber >= DRUM_ROLL_OCTAVE_MIN && octaveNumber <= DRUM_ROLL_OCTAVE_MAX) {
          e.preventDefault();
          const track = state.tracks[state.activeTrack];
          if (!track) return;
          track.rollInputOctave = normalizeRollInputOctave(octaveNumber);
          setStatus(`${track.name} standaard octaaf ${octaveNumber}`);
          render();
          return;
        }
      }

      const tag = document.activeElement?.tagName;
      const isTyping = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
      if (isTyping) return;

      const activeTrack = state.tracks[state.activeTrack];
      const activeSettingsOpen = activeTrack?.settingsOpen;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveActiveStep(-1);
        return;
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        moveActiveStep(1);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!shiftActiveRollNote(1)) toggleSelectedStep();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!shiftActiveRollNote(-1)) return;
        return;
      }
      const lower = e.key.toLowerCase();
      const num = Number(e.key);
      if (num >= 1 && num <= state.tracks.length) {
        setActiveTrack(num - 1);
        return;
      }
      if (e.shiftKey && lower === "m") {
        state.tracks.forEach((t) => (t.mute = false));
        render();
        setStatus("Alle mutes uit");
        return;
      }
      if (e.shiftKey && lower === "s") {
        state.tracks.forEach((t) => (t.solo = false));
        render();
        setStatus("Alle solo uit");
        return;
      }
      if (lower === "i") {
        toggleTrackSettings(state.activeTrack);
        return;
      }
      if (lower === "m") {
        toggleMute(state.activeTrack);
        return;
      }
      if (lower === "u") {
        e.preventDefault();
        moveActiveTrackPosition(-1);
        return;
      }
      if (lower === "d") {
        e.preventDefault();
        moveActiveTrackPosition(1);
        return;
      }
      if (lower === "p" && activeSettingsOpen) {
        setActiveSetting("probability");
        return;
      }
      if (lower === "a" && activeSettingsOpen) {
        setActiveSetting("accent");
        return;
      }
      if ((e.key === "+" || e.key === "=" || e.code === "NumpadAdd") && activeSettingsOpen) {
        e.preventDefault();
        if (adjustActiveSetting(1)) return;
      }
      if ((e.key === "-" || e.code === "NumpadSubtract") && activeSettingsOpen) {
        e.preventDefault();
        if (adjustActiveSetting(-1)) return;
      }
      if (lower === "s") {
        if (activeSettingsOpen) setActiveSetting("swing");
        else toggleSolo(state.activeTrack);
        return;
      }
      if (lower === "escape" && activeSettingsOpen) {
        toggleTrackSettings(state.activeTrack);
        return;
      }
      if (lower === "g") {
        generatePattern();
        return;
      }
      if (lower === "c") {
        clearPattern();
        return;
      }
      if (lower === "v") {
        const options = [...els.variationSelect.options].map((o) => o.value);
        const next = options[(options.indexOf(state.variation) + 1) % options.length];
        state.variation = next;
        els.variationSelect.value = next;
        generatePattern();
        return;
      }
    }

    function onKeyup(e) {
      if (root.hidden) return;
      if (e.key.toLowerCase() === "o") state.octaveHotkeyHeld = false;
    }

    function shiftActiveRollNote(delta) {
      if (!(state.volca === "drum" && state.drumMultiMode)) return false;
      const track = state.tracks[state.activeTrack];
      if (!track) return false;
      const stepIndex = ensureTrackCursor(state.activeTrack);
      const cell = normalizeCell(track.steps[stepIndex]);
      if (!cell.on) return false;

      const parsed = parseRollSlot(track.rollNotes?.[stepIndex]);
      const current = parsed !== null ? parsed : defaultRollNoteForTrack(track);
      track.rollNotes[stepIndex] = clamp(current + delta, 0, 127);
      render();
      setStatus(`${track.name} step ${stepIndex + 1} noot ${midiNoteName(track.rollNotes[stepIndex])}`);
      return true;
    }

    function togglePlay() {
      if (!audioCtx) return;
      if (audioCtx.state === "suspended") audioCtx.resume();
      if (state.isPlaying) stopTransport();
      else {
        setTransportBpm(state.bpm);
        startTransport();
      }
    }

    function getTrackStepNote(track, stepIndex) {
      if (state.volca === "drum" && state.drumMultiMode) {
        const fromRoll = parseRollSlot(track.rollNotes?.[stepIndex]);
        if (fromRoll !== null) return fromRoll;
        return defaultRollNoteForTrack(track);
      }
      return track.midiNote;
    }

    /**
     * Drum Multi: browser-preview altijd op MIDI-toonhoogte (niet track.freq uit het profiel).
     * Geldt voor elke aan stap; pianoroll of default vult de noot.
     */
    function stepUsesDrumMultiMidiPitch() {
      return state.volca === "drum" && state.drumMultiMode;
    }

    function scheduleStep(stepIndex, time) {
      const soloActive = state.tracks.some((t) => t.solo);
      const secondsPerStep = 60 / state.bpm / 4;
      const playList = [];
      state.tracks.forEach((track, trackOrder) => {
        const cell = normalizeCell(track.steps[stepIndex]);
        if (!cell.on) return;
        if (track.mute) return;
        if (soloActive && !track.solo) return;
        if (Math.random() * 100 > track.probability) return;
        const swingOffset = getSwingOffsetSeconds(track.swing, stepIndex, secondsPerStep);
        const playTime = time + swingOffset;
        const accentData = getAccentData(track.accent, stepIndex, secondsPerStep);
        const userVelocity = clamp(cell.velocity, 0, 127);
        if (userVelocity <= 0) return;
        playList.push({ track, trackOrder, playTime, accentData, userVelocity });
      });

      const drumMultiHitCount =
        state.volca === "drum" && state.drumMultiMode ? playList.length : 0;
      if (state.volca === "drum" && state.drumMultiMode) {
        // Bottom-first send order means the top-most visible track is sent last (= hoogste prioriteit).
        playList.sort((a, b) => b.trackOrder - a.trackOrder);
      }
      playList.forEach(({ track, trackOrder, playTime, accentData, userVelocity }) => {
        const noteOverride = getTrackStepNote(track, stepIndex);
        const drumMultiMidiPitch = stepUsesDrumMultiMidiPitch();
        const previewStaggerSec =
          state.volca === "drum" && state.drumMultiMode
            ? (Math.min(state.tracks.length - 1 - trackOrder, 8) * state.drumNoteStaggerMs) /
              1000
            : 0;
        playTrack(
          track,
          playTime,
          accentData,
          userVelocity,
          noteOverride,
          drumMultiMidiPitch,
          previewStaggerSec
        );
        sendMidiNote(track, playTime, accentData, userVelocity, noteOverride, trackOrder);
      });

      if (state.midiEnabled && state.midiOutputActive && state.midiClockEnabled) {
        if (drumMultiHitCount >= 2) {
          queueMicrotask(() => sendMidiClockBurst());
        } else {
          sendMidiClockBurst();
        }
      }
      updatePlaybackVisuals();
    }

    function getSwingOffsetSeconds(swingPercent, stepIndex, secondsPerStep) {
      if (stepIndex % 2 === 0 || swingPercent <= 0) return 0;
      return secondsPerStep * 0.34 * (swingPercent / 100);
    }

    function getAccentData(accentValue, stepIndex, secondsPerStep) {
      const normalized = clamp((accentValue - 20) / 107, 0, 1);
      return {
        normalized,
        velocity: Math.round(55 + normalized * 72),
        gain: 0.35 + normalized * 0.75,
        gate: 0.07 + normalized * 0.08,
        retrigger: normalized > 0.55,
        retriggerDelayMs: Math.min(28, Math.max(12, secondsPerStep * 1000 * (0.08 + normalized * 0.06))),
        retriggerVelocity: Math.round(35 + normalized * 38)
      };
    }

    function velocityToNormalized(userVelocity) {
      const normalized = clamp(Number(userVelocity) || 0, 0, 127) / 127;
      if (normalized <= 0) return 0;
      // Sterkere curve onderin: 1..20 blijft echt zacht, bovenin nog steeds vol.
      return Math.pow(normalized, 2.6);
    }

    function velocityToPreviewGain(userVelocity) {
      const level = volumeLevelFromVelocity(userVelocity);
      // Expliciete 5-standen voor browser preview zodat verschil duidelijk hoorbaar is.
      const gainByLevel = [0.07, 0.16, 0.34, 0.68, 0.95];
      return gainByLevel[level - 1] || gainByLevel[2];
    }

    function velocityToMidi(userVelocity) {
      const normalized = velocityToNormalized(userVelocity);
      if (normalized <= 0) return 0;
      return clamp(Math.round(normalized * 127), 1, 127);
    }

    function velocityToDrumPartLevelCc(userVelocity) {
      const level = volumeLevelFromVelocity(userVelocity);
      // Door jou gevraagde Volca-standen (ongeveer op 0..255 schaal):
      // 1: 30, 2: 90, 3: 160, 4: 200, 5: 248.
      // MIDI CC is 0..127, dus omgerekend naar:
      // 15, 45, 80, 100, 124.
      const ccByLevel = [15, 45, 80, 100, 124];
      return ccByLevel[level - 1] || ccByLevel[2];
    }

    function playTrack(
      track,
      time,
      accentData = getAccentData(track.accent, 0, 60 / state.bpm / 4),
      userVelocity = 100,
      noteOverride = track.midiNote,
      useMidiPitchForNote = false,
      timeShiftSec = 0
    ) {
      const t = time + timeShiftSec;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const noise = audioCtx.createBufferSource();
      const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.04, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buffer;

      const overrideN = Number(noteOverride);
      const baseMidi = Number(track.midiNote);
      const useMidiFreq =
        useMidiPitchForNote || (Number.isFinite(overrideN) && overrideN !== baseMidi);
      const freq =
        useMidiFreq && Number.isFinite(overrideN) ? midiToFreq(overrideN) : track.freq;
      const gainFromVelocity = velocityToPreviewGain(userVelocity);
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(accentData.gain * gainFromVelocity, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + accentData.gate);

      if (track.name.toLowerCase().includes("hat")) {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 3000;
        noise.connect(filter).connect(gain).connect(audioCtx.destination);
        noise.start(t);
        noise.stop(t + Math.min(0.06, accentData.gate));
      } else if (track.name.toLowerCase().includes("snare")) {
        noise.connect(gain).connect(audioCtx.destination);
        osc.connect(gain).connect(audioCtx.destination);
        noise.start(t);
        noise.stop(t + Math.min(0.1, accentData.gate + 0.02));
        osc.start(t);
        osc.stop(t + Math.min(0.11, accentData.gate + 0.03));
      } else {
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + Math.min(0.14, accentData.gate + 0.03));
      }
    }

    function midiToFreq(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function getMidiOutput() {
      return resolveMidiOutput({
        midiAccess: state.midiAccess,
        midiEnabled: state.midiEnabled,
        midiOutputActive: state.midiOutputActive,
        midiOutputId: state.midiOutputId
      });
    }

    function sendMidiTransport(command, targetOutputId = state.midiOutputId) {
      if (!state.midiTransportCommands) return;
      const ok = sendTransportToOutput({
        midiAccess: state.midiAccess,
        midiEnabled: state.midiEnabled,
        midiOutputActive: true,
        midiOutputId: targetOutputId,
        command
      });
      if (!ok) return;
      lastTransportOutputId = targetOutputId || "";
    }

    function sendMidiClockBurst() {
      const now = performance.now();
      if (now - state.lastClockTick < 15) return;
      state.lastClockTick = now;
      sendClockToOutput({
        midiAccess: state.midiAccess,
        midiEnabled: state.midiEnabled,
        midiOutputActive: state.midiOutputActive,
        midiOutputId: state.midiOutputId
      });
    }

    /**
     * Volca Drum (Korg): pitch per part via CC, niet via willekeurig note-on-nummer.
     * CC 28 = Pitch (samengevoegd in implementatiecharts). Mapping: Δ-semitoon t.o.v. part-basis → rond midden 64.
     */
    function drumRollToPitchCC(track, rollMidi) {
      const base = clamp(Number(track.midiNote) || 60, 0, 127);
      const r = clamp(Number(rollMidi), 0, 127);
      const delta = r - base;
      return clamp(64 + Math.round(delta * 4), 0, 127);
    }

    /** Wis per-track cache zodat na play/pattern-load de Volca opnieuw CC krijgt waar nodig. */
    function resetDrumMultiCc28Memory() {
      for (const track of state.tracks) {
        delete track._lastDrumMultiCc28Sent;
        delete track._lastDrumPartLevelSent;
      }
      state._lastDrumPartLevelByChannel = {};
    }

    /** Active filtering: alleen CC 28 sturen als pitch-CC t.o.v. vorige hit van deze track verandert. */
    function sendDrumMultiPitchCC(output, ch, track, rollMidi, whenMs) {
      const v = drumRollToPitchCC(track, rollMidi);
      if (track._lastDrumMultiCc28Sent === v) return;
      track._lastDrumMultiCc28Sent = v;
      const cc = 0xb0 + ch;
      output.send([cc, 28, v], whenMs);
    }

    /**
     * Active filtering voor CC19 (Part Level):
     * - Drum Multi: per track shadow-state
     * - Single kanaal: per MIDI-kanaal shadow-state
     */
    function sendDrumPartLevelCC(output, ch, track, levelValue, whenMs, useDrumMultiPitchCC) {
      const cc = 0xb0 + ch;
      if (useDrumMultiPitchCC) {
        if (track._lastDrumPartLevelSent === levelValue) return;
        track._lastDrumPartLevelSent = levelValue;
        output.send([cc, 19, levelValue], whenMs);
        return;
      }

      const byChannel = state._lastDrumPartLevelByChannel || {};
      if (byChannel[ch] === levelValue) return;
      byChannel[ch] = levelValue;
      state._lastDrumPartLevelByChannel = byChannel;
      output.send([cc, 19, levelValue], whenMs);
    }

    function sendMidiNote(
      track,
      whenTime = audioCtx.currentTime,
      accentData = getAccentData(track.accent, 0, 60 / state.bpm / 4),
      userVelocity = 100,
      noteOverride = track.midiNote,
      trackOrder = 0
    ) {
      const output = getMidiOutput();
      if (!output) return;
      const chosenChannel = state.volca === "drum" && state.drumMultiMode
        ? clamp(Number(track.midiChannel) || 1, 1, 16)
        : clamp(Number(els.midiChannelSelect.value) || 1, 1, 16);
      const ch = chosenChannel - 1;
      const on = 0x90 + ch;
      const off = 0x80 + ch;
      const baseMs = performance.now() + Math.max(0, (whenTime - audioCtx.currentTime) * 1000);
      const useDrumMultiPitchCC = state.volca === "drum" && state.drumMultiMode;
      const isVolcaDrum = state.volca === "drum";
      let gateMs = Math.round(55 + accentData.normalized * 45);
      if (useDrumMultiPitchCC) gateMs = Math.max(gateMs, DRUM_MULTI_NOTE_GATE_MIN_MS);
      const triggerMidi = clamp(Number(track.midiNote) || 60, 0, 127);
      const overrideN = Number(noteOverride);
      const pitchTarget = Number.isFinite(overrideN) ? clamp(overrideN, 0, 127) : triggerMidi;
      const note = useDrumMultiPitchCC ? triggerMidi : pitchTarget;
      const velocity = isVolcaDrum ? 127 : velocityToMidi(userVelocity);
      const drumPartLevel = isVolcaDrum ? velocityToDrumPartLevelCc(userVelocity) : 0;
      if (isVolcaDrum && drumPartLevel <= 0) return;
      if (!isVolcaDrum && velocity <= 0) return;
      const chSlot = clamp(chosenChannel - 1, 0, 15);
      const trackSpreadSlot = Math.min(Math.max(0, state.tracks.length - 1 - trackOrder), 8);
      const ccSpreadSlot = useDrumMultiPitchCC ? trackSpreadSlot : Math.min(chSlot, 8);
      const noteStaggerMs = ccSpreadSlot * state.drumNoteStaggerMs;

      if (useDrumMultiPitchCC) {
        let noteMs = baseMs;
        let ccMs = noteMs - state.drumCcLeadMs - ccSpreadSlot * state.drumCcStaggerMs;
        const now = performance.now();
        const minLead = state.drumCcLeadMs + 3;
        if (ccMs < now) {
          ccMs = now;
          noteMs = Math.max(noteMs, ccMs + minLead);
        }
        const noteOnMs = noteMs + noteStaggerMs;
        sendDrumPartLevelCC(output, ch, track, drumPartLevel, ccMs, useDrumMultiPitchCC);
        sendDrumMultiPitchCC(output, ch, track, pitchTarget, ccMs);
        output.send([on, note, velocity], noteOnMs);
        if (state.drumMultiSendNoteOff) output.send([off, note, 0], noteOnMs + gateMs);
      } else {
        if (isVolcaDrum) {
          const ccMs = Math.max(performance.now(), baseMs - 8);
          sendDrumPartLevelCC(output, ch, track, drumPartLevel, ccMs, useDrumMultiPitchCC);
        }
        output.send([on, note, velocity], baseMs);
        output.send([off, note, 0], baseMs + gateMs);
      }

      if (accentData.retrigger) {
        const retriggerAt = baseMs + accentData.retriggerDelayMs;
        const rv = clamp(Math.round(Math.max(1, velocity * 0.72)), 1, 127);
        if (useDrumMultiPitchCC) {
          let rNoteMs = retriggerAt;
          let rCcMs = rNoteMs - state.drumCcLeadMs - ccSpreadSlot * state.drumCcStaggerMs;
          const rNow = performance.now();
          const rMinLead = state.drumCcLeadMs + 3;
          if (rCcMs < rNow) {
            rCcMs = rNow;
            rNoteMs = Math.max(rNoteMs, rCcMs + rMinLead);
          }
          const rOnMs = rNoteMs + noteStaggerMs;
          sendDrumMultiPitchCC(output, ch, track, pitchTarget, rCcMs);
          output.send([on, note, rv], rOnMs);
          if (state.drumMultiSendNoteOff) output.send([off, note, 0], rOnMs + Math.max(26, gateMs - 20));
        } else {
          output.send([on, note, rv], retriggerAt);
          output.send([off, note, 0], retriggerAt + Math.max(26, gateMs - 20));
        }
      }
    }

    function savePattern() {
      const payload = {
        style: state.style,
        variation: state.variation,
        length: state.length,
        bpm: state.bpm,
        volca: state.volca,
        drumMultiMode: state.drumMultiMode,
        activeSetting: state.activeSetting,
        visibleTrackCount: state.tracks.length,
        tracks: state.tracks.map(({ name, midiNote, freq, mute, solo, probability, swing, accent, steps, settingsOpen, cursorStep, midiChannel, rollNotes, rollInputOctave }) => ({
          name,
          midiNote,
          freq,
          mute,
          solo,
          probability,
          swing,
          accent,
          steps,
          settingsOpen,
          cursorStep,
          midiChannel,
          rollNotes,
          rollInputOctave
        }))
      };
      saveJson(STORAGE_KEY, payload);
      setStatus("Pattern opgeslagen");
    }

    function loadPattern() {
      const data = loadJson(STORAGE_KEY);
      if (!data) {
        setStatus("Geen opgeslagen pattern");
        return;
      }

      state.style = data.style || state.style;
      state.variation = data.variation || state.variation;
      state.length = data.length || state.length;
      state.bpm = data.bpm || state.bpm;
      state.activeSetting = data.activeSetting || state.activeSetting;
      els.styleSelect.value = state.style;
      els.variationSelect.value = state.variation;
      els.lengthSelect.value = String(state.length);
      els.volcaSelect.value = data.volca || state.volca;
      applyVolcaProfile(false);
      state.drumMultiMode = !!data.drumMultiMode;
      els.drumMultiToggle.checked = state.drumMultiMode;
      updateDrumMultiUI();

      const wantedCount = clamp(data.visibleTrackCount || data.tracks.length || state.tracks.length, 1, state.maxTracks || state.tracks.length);
      while (state.tracks.length < wantedCount) addTrack(false);
      while (state.tracks.length > wantedCount) removeTrack(false);

      state.tracks = data.tracks.slice(0, state.tracks.length).map((track, idx) => ({
        ...state.tracks[idx],
        ...track,
        cursorStep: clamp(track.cursorStep ?? 0, 0, state.length - 1),
        midiChannel: clamp(Number(track.midiChannel) || Number(state.tracks[idx]?.midiChannel) || 1, 1, 16),
        rollInputOctave: normalizeRollInputOctave(track.rollInputOctave ?? state.tracks[idx]?.rollInputOctave ?? midiToDrumRollOctave(track.midiNote)),
        rollNotes: Array.from({ length: state.length }, (_, i) => parseRollSlot(track.rollNotes?.[i])),
        id: crypto.randomUUID()
      }));

      if (state.volca === "drum") {
        state.tracks.forEach((t) => {
          for (let i = 0; i < state.length; i++) {
            const cell = normalizeCell(t.steps[i]);
            if (cell.on && parseRollSlot(t.rollNotes?.[i]) === null) {
              t.rollNotes[i] = defaultRollNoteForTrack(t);
            }
          }
        });
      }

      resetDrumMultiCc28Memory();
      els.bpmInput.value = state.bpm;
      setTransportBpm(state.bpm);
      render();
      setStatus("Pattern geladen");
    }

    function setStatus(msg) {
      els.statusText.textContent = msg;
    }

    function updateMidiActiveModeState() {
      if (!els.midiActiveModeState) return;
      const active = !!state.midiEnabled && !!state.midiOutputActive && !!state.midiOutputId;
      els.midiActiveModeState.textContent = `ACTIVE MODE: ${active ? "AAN" : "UIT"}`;
      els.midiActiveModeState.classList.toggle("active-mode-on", active);
      els.midiActiveModeState.classList.toggle("active-mode-off", !active);
      if (els.midiRouteDebug) {
        const outputLabel = els.midiOutputSelect.selectedOptions[0]?.textContent || "geen output";
        const channelLabel = state.drumMultiMode ? "per-track kanaal" : `ch ${els.midiChannelSelect.value}`;
        const conflict = evaluateMidiRoutingConflict(MIDI_DEVICE.STYLE);
        const warn = conflict.hasConflict ? ` · ⚠ zelfde output als ${conflict.otherLabel}` : "";
        els.midiRouteDebug.textContent = `ROUTE: ${outputLabel} · ${channelLabel}${warn}`;
      }
    }

    function handleTransportChange(snapshot) {
      const nextBpm = clamp(Number(snapshot.bpm) || state.bpm, 40, 240);
      state.bpm = nextBpm;
      if (Number(els.bpmInput.value) !== nextBpm) els.bpmInput.value = String(nextBpm);
      if (snapshot.isPlaying === state.isPlaying) return;

      state.isPlaying = snapshot.isPlaying;
      els.playBtn.textContent = state.isPlaying ? "Stop" : "Play";
      if (state.isPlaying) {
        state.lastClockTick = performance.now();
        resetDrumMultiCc28Memory();
        lastProcessedTransportStep = getTransportStep() - 1;
        startPlaybackLoop();
        sendMidiTransport(true);
        setStatus("Play");
      } else {
        stopPlaybackLoop();
        sendMidiTransport(false);
        setStatus("Stop");
      }
      render();
    }

    function startPlaybackLoop() {
      stopPlaybackLoop();
      playbackIntervalId = window.setInterval(processTransportSteps, 25);
      processTransportSteps();
    }

    function stopPlaybackLoop() {
      if (!playbackIntervalId) return;
      window.clearInterval(playbackIntervalId);
      playbackIntervalId = null;
    }

    function processTransportSteps() {
      const snapshot = getTransportSnapshot();
      if (!snapshot.isPlaying) return;
      const currentTransportStep = getTransportStep();
      if (currentTransportStep <= lastProcessedTransportStep) return;
      for (let step = lastProcessedTransportStep + 1; step <= currentTransportStep; step++) {
        const localStep = step % state.length;
        state.currentStep = localStep;
        scheduleStep(localStep, audioCtx.currentTime);
      }
      lastProcessedTransportStep = currentTransportStep;
      updatePlaybackVisuals();
    }
  }
}

function template() {
  return `
    <header class="topbar card">
      <div>
        <h1>Volca Drum Sequencer</h1>
        <p class="sub">
          Klik een track of druk <strong>1–9</strong>, daarna <strong>M</strong> mute,
          <strong>S</strong> solo, <strong>I</strong> instellingen. Met instellingen open:
          <strong>P</strong> probability, <strong>S</strong> swing, <strong>A</strong> accent
          en <strong>+</strong>/<strong>-</strong> aanpassen.
        </p>
      </div>

      <div class="topbar-actions">
        <button
          id="settingsToggleBtn"
          class="secondary settings-toggle-btn"
          type="button"
          aria-expanded="true"
        >
          ▲ Instellingen omhoog
        </button>

        <div class="status" id="statusText">Klaar</div>
      </div>
    </header>

    <section id="controlStack" class="control-stack">
      <div id="advancedPanel" class="advanced-panel">
        <section class="controls card">
          <div class="field">
            <label for="lengthSelect">Steps</label>
            <select id="lengthSelect">
              <option>8</option>
              <option selected>16</option>
              <option>32</option>
              <option>64</option>
            </select>
          </div>

          <div class="field">
            <label for="volcaSelect">Volca</label>
            <select id="volcaSelect">
              <option value="beats">Volca Beats</option>
              <option value="sample">Volca Sample</option>
              <option value="drum">Volca Drum</option>
              <option value="fm">Volca FM</option>
            </select>
          </div>

          <div class="buttons-wrap buttons-wrap-wide">
            <button id="clearBtn" class="secondary">Clear</button>
            <button id="saveBtn" class="secondary">Save</button>
            <button id="loadBtn" class="secondary">Load</button>
          </div>
        </section>

        <section class="midi card">
          <div class="field toggle-field">
            <label for="midiEnable">MIDI</label>
            <label class="switch" for="midiEnable">
              <input id="midiEnable" type="checkbox" />
              <span class="switch-ui" aria-hidden="true"></span>
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

          <div class="field toggle-field">
            <label for="styleMidiOutputActiveToggle">Output actief</label>
            <label class="switch" for="styleMidiOutputActiveToggle">
              <input id="styleMidiOutputActiveToggle" type="checkbox" checked />
              <span class="switch-ui" aria-hidden="true"></span>
              <span class="switch-text">
                <span class="switch-on">Aan</span>
                <span class="switch-off">Uit</span>
              </span>
            </label>
          </div>
          <div class="midi-hint" id="midiActiveModeState">ACTIVE MODE: UIT</div>
          <div class="midi-hint" id="midiRouteDebug">ROUTE: geen output · ch 1</div>

          <div class="field small">
            <label for="midiChannelSelect">Kanaal</label>
            <select id="midiChannelSelect"></select>
          </div>

          <div class="field toggle-field">
            <label for="clockEnable">Clock</label>
            <label class="switch" for="clockEnable">
              <input id="clockEnable" type="checkbox" checked />
              <span class="switch-ui" aria-hidden="true"></span>
              <span class="switch-text">
                <span class="switch-on">Aan</span>
                <span class="switch-off">Uit</span>
              </span>
            </label>
          </div>

          <div class="field toggle-field">
            <label for="midiTransportCommandsToggle">Start/Stop (MMC)</label>
            <label class="switch" for="midiTransportCommandsToggle">
              <input id="midiTransportCommandsToggle" type="checkbox" />
              <span class="switch-ui" aria-hidden="true"></span>
              <span class="switch-text">
                <span class="switch-on">Aan</span>
                <span class="switch-off">Uit</span>
              </span>
            </label>
          </div>
          <div class="midi-hint">
            Uit = geen MIDI Start/Stop naar de Volca (vaak start anders de eigen play op Korg). Clock + noten blijven werken als MIDI aan staat.
          </div>

          <div id="drumMultiWrap" class="field toggle-field hidden">
            <label for="drumMultiToggle">Drum Multi (6ch)</label>
            <label class="switch" for="drumMultiToggle">
              <input id="drumMultiToggle" type="checkbox" />
              <span class="switch-ui" aria-hidden="true"></span>
              <span class="switch-text">
                <span class="switch-on">Aan</span>
                <span class="switch-off">Uit</span>
              </span>
            </label>
          </div>
          <div id="drumMultiNoteOffWrap" class="field toggle-field hidden">
            <label for="drumMultiNoteOffToggle">Drum Multi Note-Off</label>
            <label class="switch" for="drumMultiNoteOffToggle">
              <input id="drumMultiNoteOffToggle" type="checkbox" checked />
              <span class="switch-ui" aria-hidden="true"></span>
              <span class="switch-text">
                <span class="switch-on">Aan</span>
                <span class="switch-off">Uit</span>
              </span>
            </label>
          </div>
          <div class="field small">
            <label for="drumBufferMsInput">Drum buffer vooraf (ms)</label>
            <input id="drumBufferMsInput" type="number" min="0" max="40" step="1" value="14" />
          </div>
          <div class="field small">
            <label for="drumCcStaggerMsInput">Drum CC stagger (ms)</label>
            <input id="drumCcStaggerMsInput" type="number" min="0" max="20" step="1" value="6" />
          </div>
          <div class="field small">
            <label for="drumNoteStaggerMsInput">Drum note stagger (ms)</label>
            <input id="drumNoteStaggerMsInput" type="number" min="0" max="20" step="1" value="5" />
          </div>

          <div class="midi-hint" id="midiHint">Advies Volca Beats: kanaal 1</div>
        </section>

        <section class="shortcuts card">
          <div><strong>Shortcuts</strong></div>
          <div>
            1–9 = track kiezen · U/D = track omhoog/omlaag · M = mute · S = solo · I = instellingen · P/S/A = instelling kiezen · +/- = aanpassen · Shift+M = alle mutes uit · Shift+S = alle solo uit · Spatie = play/stop
          </div>
        </section>
      </div>

      <section class="quick-bar card">
        <div class="quick-bar-main">
          <div class="field">
            <label for="styleSelect">Stijl</label>
            <select id="styleSelect"></select>
          </div>

          <div class="field">
            <label for="variationSelect">Groove</label>
            <select id="variationSelect">
              <option value="default">Default</option>
              <option value="minimal">Minimal</option>
              <option value="groovy">Groovy</option>
              <option value="broken">Broken</option>
              <option value="busy">Busy</option>
            </select>
          </div>

          <div class="field bpm-field">
            <label for="bpmInput">BPM</label>
            <input id="bpmInput" type="number" min="40" max="240" value="174" />
          </div>

          <div class="buttons-wrap quick-buttons">
            <button id="generateBtn">Genereer</button>
            <button id="addTrackBtn" class="secondary">Track +</button>
            <button id="removeTrackBtn" class="secondary">Track -</button>
            <button id="playBtn" class="accent">Play</button>
          </div>
        </div>

        <div class="track-count-row">
          <span id="trackCountText">4/6 tracks</span>
          <span id="trackHelpText">
            Bij Volca Beats zijn de eerste 4 direct gevuld; 2 extra tracks kun je later toevoegen.
          </span>
        </div>
      </section>
    </section>

    <main id="tracksContainer" class="tracks"></main>

    <div id="addTrackModal" class="selector-modal hidden" aria-hidden="true">
      <div class="card">
        <div class="field">
          <label for="addTrackSelect">Kies sound</label>
          <select id="addTrackSelect"></select>
        </div>
        <div class="buttons-wrap">
          <button id="addTrackConfirmBtn">Toevoegen</button>
          <button id="addTrackCancelBtn" class="secondary" type="button">Annuleren</button>
        </div>
      </div>
    </div>

    <div id="velocityModal" class="selector-modal hidden" aria-hidden="true" data-track-index="" data-step-index="">
      <div class="card">
        <div class="field">
          <label for="velocityInput">Volume stand (1–5)</label>
          <select id="velocityInput">
            <option value="1">1 - heel zacht</option>
            <option value="2">2 - zacht</option>
            <option value="3" selected>3 - half volume</option>
            <option value="4">4 - normaal</option>
            <option value="5">5 - harder</option>
          </select>
        </div>
        <div class="buttons-wrap">
          <button id="velocityConfirmBtn">OK</button>
          <button id="velocityCancelBtn" class="secondary" type="button">Annuleren</button>
        </div>
      </div>
    </div>
  `;
}

