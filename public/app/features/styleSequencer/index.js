import { styleDefaults } from "./data/styles.js";
import { volcaProfiles } from "./data/volcaProfiles.js";
import { clamp } from "../../shared/utils/math.js";
import { qs } from "../../shared/utils/dom.js";
import { saveJson, loadJson } from "../../shared/storage/jsonStorage.js";
import { requestMidiAccess, listMidiOutputs } from "../../shared/midi/access.js";

const STORAGE_KEY = "volca-sequencer-save";
const VOLCA_SELECTION_KEY = "volca-selected";
const DRUM_ROLL_NOTES = [76, 74, 72, 71, 69, 67, 65, 64, 62, 60];

export function styleSequencerFeature() {
  return { mount };

  async function mount(root) {
    root.innerHTML = template();

    const els = {};
    let audioCtx = null;
    let globalPointerUpHandler = null;
    let globalKeydownHandler = null;

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
      midiAccess: null,
      midiOutputId: "",
      midiEnabled: false,
      midiClockEnabled: true,
      drumMultiMode: false,
      lastClockTick: 0,
      tracks: [],
      trackTemplates: [],
      maxTracks: 0
    };

    const settingMeta = {
      probability: { label: "Probability", short: "P", min: 0, max: 100, step: 5, suffix: "%" },
      swing: { label: "Swing", short: "S", min: 0, max: 75, step: 5, suffix: "%" },
      accent: { label: "Accent", short: "A", min: 20, max: 127, step: 5, suffix: "" }
    };

    init();

    return () => {
      if (state.timerId) clearTimeout(state.timerId);
      if (globalPointerUpHandler) window.removeEventListener("pointerup", globalPointerUpHandler);
      if (globalKeydownHandler) document.removeEventListener("keydown", globalKeydownHandler);
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
        "midiOutputSelect",
        "midiChannelSelect",
        "clockEnable",
        "drumMultiWrap",
        "drumMultiToggle",
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
      populateStyles();
      populateChannels();
      bindEvents();
      toggleSettingsPanel(true);
      setupAudio();
      setupMidi();

      // Keep the Volca selector in sync across views.
      const savedVolca = localStorage.getItem(VOLCA_SELECTION_KEY);
      if (savedVolca) {
        els.volcaSelect.value = savedVolca;
        state.volca = savedVolca;
      } else {
        localStorage.setItem(VOLCA_SELECTION_KEY, els.volcaSelect.value);
      }

      // If user selected FM in another view, jump immediately.
      if (els.volcaSelect.value === "fm") {
        window.location.hash = "#/fm";
        return;
      }

      // This will also generate pattern + render when requested.
      applyVolcaProfile(true);

      globalPointerUpHandler = () => {
        state.drawMode = null;
      };
      window.addEventListener("pointerup", globalPointerUpHandler);
    }

    function bindEls() {
      templateIds().forEach((id) => (els[id] = qs(id)));
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
        localStorage.setItem(VOLCA_SELECTION_KEY, next);
        if (next === "fm") {
          window.location.hash = "#/fm";
          return;
        }
        applyVolcaProfile(true);
      });
      els.bpmInput.addEventListener("input", () => {
        state.bpm = clamp(Number(els.bpmInput.value) || 120, 40, 240);
        els.bpmInput.value = state.bpm;
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
        const next = clamp(Number(els.velocityInput.value), 0, 127);
        const track = state.tracks[trackIndex];
        if (!track) return closeVelocityDialog();
        const cell = normalizeCell(track.steps[stepIndex]);
        cell.velocity = next;
        track.steps[stepIndex] = cell;
        closeVelocityDialog();
        render();
        setStatus(`${track.name} step ${stepIndex + 1} velocity ${next}`);
      });
      els.velocityCancelBtn.addEventListener("click", closeVelocityDialog);
      els.velocityModal.addEventListener("click", (e) => {
        if (e.target === els.velocityModal) closeVelocityDialog();
      });
      els.midiEnable.addEventListener("change", () => {
        state.midiEnabled = els.midiEnable.checked;
        setStatus(state.midiEnabled ? "MIDI aan" : "MIDI uit");
      });
      els.midiOutputSelect.addEventListener("change", () => {
        state.midiOutputId = els.midiOutputSelect.value;
        setStatus(`MIDI output: ${els.midiOutputSelect.selectedOptions[0]?.textContent || "geen"}`);
      });
      els.midiChannelSelect.addEventListener("change", () => setStatus(`Kanaal ${els.midiChannelSelect.value}`));
      els.clockEnable.addEventListener("change", () => {
        state.midiClockEnabled = els.clockEnable.checked;
      });
      els.drumMultiToggle.addEventListener("change", () => {
        state.drumMultiMode = !!els.drumMultiToggle.checked;
        render();
        setStatus(state.drumMultiMode ? "Drum Multi aan (6ch)" : "Drum Single aan (1ch)");
      });
      els.settingsToggleBtn.addEventListener("click", toggleSettingsPanel);

      globalKeydownHandler = onKeydown;
      document.addEventListener("keydown", globalKeydownHandler);
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
      els.midiOutputSelect.value = current || "";
      state.midiOutputId = els.midiOutputSelect.value;
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
        steps: Array.from({ length: state.length }, () => ({ on: false, velocity: 100 })),
        rollNotes: Array.from({ length: state.length }, () => null)
      };
    }

    function applyVolcaProfile(resetPattern) {
      state.volca = els.volcaSelect.value;
      if (state.volca === "fm") return;
      const profile = volcaProfiles[state.volca];
      if (!profile) return;
      els.midiChannelSelect.value = String(profile.channel);
      els.midiHint.textContent = `Advies ${profile.name}: kanaal ${profile.channel} · tracks ${profile.initialVisible}/${profile.maxTracks} zichtbaar · swing = timing · accent = best effort`;
      state.trackTemplates = profile.tracks.map((t, index) => ({ ...t, index }));
      state.maxTracks = Math.min(profile.maxTracks || profile.tracks.length, state.trackTemplates.length);
      const visibleCount = Math.min(profile.initialVisible || 4, state.maxTracks);
      state.tracks = state.trackTemplates.slice(0, visibleCount).map((t, index) => createTrackFromTemplate(t, index));
      state.activeTrack = 0;
      state.activeSetting = "probability";
      const defaultBpm = styleDefaults[state.style].bpm;
      state.bpm = defaultBpm;
      els.bpmInput.value = defaultBpm;
      updateDrumMultiUI();
      if (resetPattern) generatePattern();
      render();
    }

    function updateDrumMultiUI() {
      const isDrum = state.volca === "drum";
      els.drumMultiWrap.classList.toggle("hidden", !isDrum);
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
      els.velocityInput.value = String(clamp(Number(cell.velocity) || 0, 0, 127));
      els.velocityModal.dataset.trackIndex = String(trackIndex);
      els.velocityModal.dataset.stepIndex = String(stepIndex);
      els.velocityModal.classList.remove("hidden");
      els.velocityModal.setAttribute("aria-hidden", "false");
      els.velocityInput.focus();
      els.velocityInput.select();
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
          return { on: !!prev, velocity: 100 };
        });
        track.rollNotes = Array.from({ length: state.length }, (_, i) => {
          const prev = track.rollNotes?.[i];
          return Number.isFinite(prev) ? clamp(Number(prev), 0, 127) : null;
        });
        track.cursorStep = clamp(track.cursorStep ?? 0, 0, state.length - 1);
      });
      if (state.currentStep >= state.length) state.currentStep = 0;
    }

    function clearPattern() {
      state.tracks.forEach((track) => {
        track.steps = Array.from({ length: state.length }, () => ({ on: false, velocity: 100 }));
        track.rollNotes = Array.from({ length: state.length }, () => null);
      });
      render();
      setStatus("Pattern gewist");
    }

    function generatePattern() {
      const cfg = styleDefaults[state.style];
      if (!cfg) return;
      state.bpm = cfg.bpm;
      els.bpmInput.value = cfg.bpm;
      state.tracks.forEach((track) => {
        track.steps = Array.from({ length: state.length }, () => ({ on: false, velocity: 100 }));
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

    function defaultRollNoteForTrack(track) {
      const sorted = [...DRUM_ROLL_NOTES].sort((a, b) => a - b);
      const target = clamp(Number(track.midiNote) || 60, 0, 127);
      let best = sorted[0];
      let bestDist = Math.abs(target - best);
      for (let i = 1; i < sorted.length; i++) {
        const d = Math.abs(target - sorted[i]);
        if (d < bestDist) {
          best = sorted[i];
          bestDist = d;
        }
      }
      return best;
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

    function updateTrackControls() {
      const profile = volcaProfiles[state.volca];
      const minimum = Math.min(profile.initialVisible || 4, state.maxTracks);
      els.trackCountText.textContent = `${state.tracks.length}/${state.maxTracks} tracks`;
      els.trackHelpText.textContent =
        profile.name === "Volca Beats"
          ? "Standaard: Kick, Snare, Closed Hat, Hi Tom. Genereer vult die 4 volgens stijl + groove; andere tracks leeg. Track + voegt sounds toe."
          : profile.name === "Volca Drum" && state.drumMultiMode
            ? "Drum Multi staat aan: per track eigen MIDI kanaal + uitgeklapte piano roll."
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
          velBtn.textContent = String(vel);
          velBtn.title = "Velocity (0-127)";
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
          <button class="track-btn icon-btn solo-btn ${track.solo ? "solo-state" : ""}" data-action="solo" title="Solo" aria-label="Solo track"><span aria-hidden="true">S</span></button>
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
      wrap.innerHTML = `
        <div class="drum-roll-head">
          <span>Drum+ Piano Roll</span>
          <label class="drum-roll-channel">
            Ch
            <select data-role="drum-track-channel">
              ${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}" ${track.midiChannel === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}
            </select>
          </label>
        </div>
      `;

      const grid = document.createElement("div");
      grid.className = "drum-roll-grid";

      DRUM_ROLL_NOTES.forEach((note) => {
        const row = document.createElement("div");
        row.className = "drum-roll-row";

        const label = document.createElement("div");
        label.className = "drum-roll-note";
        label.textContent = midiNoteName(note);
        row.appendChild(label);

        for (let stepIndex = 0; stepIndex < state.length; stepIndex++) {
          const cell = document.createElement("button");
          cell.type = "button";
          const current = track.rollNotes?.[stepIndex];
          const isOn = current === note;
          cell.className = `drum-roll-cell${isOn ? " on" : ""}`;
          cell.textContent = isOn ? "●" : "";
          cell.addEventListener("click", () => {
            setActiveTrack(trackIndex, false);
            const already = track.rollNotes?.[stepIndex] === note;
            track.rollNotes[stepIndex] = already ? null : note;
            const c = normalizeCell(track.steps[stepIndex]);
            c.on = track.rollNotes[stepIndex] !== null;
            track.steps[stepIndex] = c;
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
      cell.on = nextValue;
      if (typeof cell.velocity !== "number") cell.velocity = 100;
      track.steps[stepIndex] = cell;
      render();
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
      state.tracks[index].solo = !state.tracks[index].solo;
      render();
      setStatus(`${state.tracks[index].name} ${state.tracks[index].solo ? "solo" : "solo uit"}`);
    }

    function toggleTrackSettings(index = state.activeTrack) {
      const track = state.tracks[index];
      track.settingsOpen = !track.settingsOpen;
      state.activeTrack = index;
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
          if (!Number.isFinite(track.rollNotes?.[stepIndex])) {
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
      return { on: !!cell, velocity: 100 };
    }

    function onKeydown(e) {
      const tag = document.activeElement?.tagName;
      const isTyping = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
      if (e.code === "Space" && !isTyping) {
        e.preventDefault();
        togglePlay();
        return;
      }
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

    function shiftActiveRollNote(delta) {
      if (!(state.volca === "drum" && state.drumMultiMode)) return false;
      const track = state.tracks[state.activeTrack];
      if (!track) return false;
      const stepIndex = ensureTrackCursor(state.activeTrack);
      const cell = normalizeCell(track.steps[stepIndex]);
      if (!cell.on) return false;

      const sorted = [...DRUM_ROLL_NOTES].sort((a, b) => a - b);
      const current = Number.isFinite(track.rollNotes?.[stepIndex])
        ? track.rollNotes[stepIndex]
        : defaultRollNoteForTrack(track);
      const idx = sorted.indexOf(current);
      const currentIdx = idx >= 0 ? idx : sorted.findIndex((n) => n >= current);
      const safeIdx = clamp(currentIdx >= 0 ? currentIdx : 0, 0, sorted.length - 1);
      const nextIdx = clamp(safeIdx + delta, 0, sorted.length - 1);
      track.rollNotes[stepIndex] = sorted[nextIdx];
      render();
      setStatus(`${track.name} step ${stepIndex + 1} noot ${midiNoteName(sorted[nextIdx])}`);
      return true;
    }

    function togglePlay() {
      if (!audioCtx) return;
      if (audioCtx.state === "suspended") audioCtx.resume();
      state.isPlaying = !state.isPlaying;
      els.playBtn.textContent = state.isPlaying ? "Stop" : "Play";
      if (state.isPlaying) {
        state.currentStep = 0;
        state.nextStepTime = audioCtx.currentTime + 0.05;
        state.lastClockTick = performance.now();
        render();
        scheduler();
        sendMidiTransport(true);
        setStatus("Play");
      } else {
        clearTimeout(state.timerId);
        sendMidiTransport(false);
        setStatus("Stop");
        render();
      }
    }

    function scheduler() {
      const lookAhead = 0.1;
      while (state.nextStepTime < audioCtx.currentTime + lookAhead) {
        scheduleStep(state.currentStep, state.nextStepTime);
        advanceStep();
      }
      if (state.isPlaying) state.timerId = setTimeout(scheduler, 25);
    }

    function advanceStep() {
      const secondsPerStep = 60 / state.bpm / 4;
      state.nextStepTime += secondsPerStep;
      state.currentStep = (state.currentStep + 1) % state.length;
    }

    function scheduleStep(stepIndex, time) {
      const soloActive = state.tracks.some((t) => t.solo);
      const secondsPerStep = 60 / state.bpm / 4;
      state.tracks.forEach((track) => {
        const cell = normalizeCell(track.steps[stepIndex]);
        if (!cell.on) return;
        if (track.mute) return;
        if (soloActive && !track.solo) return;
        if (Math.random() * 100 > track.probability) return;
        const swingOffset = getSwingOffsetSeconds(track.swing, stepIndex, secondsPerStep);
        const playTime = time + swingOffset;
        const accentData = getAccentData(track.accent, stepIndex, secondsPerStep);
        const velNorm = clamp(cell.velocity, 0, 127) / 127;
        if (velNorm <= 0) return;
        const noteOverride = getTrackStepNote(track, stepIndex);
        playTrack(track, playTime, accentData, velNorm, noteOverride);
        sendMidiNote(track, playTime, accentData, velNorm, noteOverride);
      });
    function getTrackStepNote(track, stepIndex) {
      if (state.volca === "drum" && state.drumMultiMode) {
        const roll = track.rollNotes?.[stepIndex];
        if (Number.isFinite(roll)) return clamp(Number(roll), 0, 127);
      }
      return track.midiNote;
    }

      if (state.midiEnabled && state.midiClockEnabled) sendMidiClockBurst();
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

    function playTrack(
      track,
      time,
      accentData = getAccentData(track.accent, 0, 60 / state.bpm / 4),
      velNorm = 1,
      noteOverride = track.midiNote
    ) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const noise = audioCtx.createBufferSource();
      const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.04, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise.buffer = buffer;

      const freq = noteOverride !== track.midiNote ? midiToFreq(noteOverride) : track.freq;
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(accentData.gain * velNorm, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + accentData.gate);

      if (track.name.toLowerCase().includes("hat")) {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 3000;
        noise.connect(filter).connect(gain).connect(audioCtx.destination);
        noise.start(time);
        noise.stop(time + Math.min(0.06, accentData.gate));
      } else if (track.name.toLowerCase().includes("snare")) {
        noise.connect(gain).connect(audioCtx.destination);
        osc.connect(gain).connect(audioCtx.destination);
        noise.start(time);
        noise.stop(time + Math.min(0.1, accentData.gate + 0.02));
        osc.start(time);
        osc.stop(time + Math.min(0.11, accentData.gate + 0.03));
      } else {
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(time);
        osc.stop(time + Math.min(0.14, accentData.gate + 0.03));
      }
    }

    function midiToFreq(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function getMidiOutput() {
      if (!state.midiAccess || !state.midiEnabled || !state.midiOutputId) return null;
      return state.midiAccess.outputs.get(state.midiOutputId) || null;
    }

    function sendMidiTransport(start) {
      const output = getMidiOutput();
      if (!output) return;
      output.send([start ? 0xfa : 0xfc]);
    }

    function sendMidiClockBurst() {
      const output = getMidiOutput();
      if (!output) return;
      const now = performance.now();
      if (now - state.lastClockTick < 15) return;
      state.lastClockTick = now;
      output.send([0xf8]);
    }

    function sendMidiNote(
      track,
      whenTime = audioCtx.currentTime,
      accentData = getAccentData(track.accent, 0, 60 / state.bpm / 4),
      velNorm = 1,
      noteOverride = track.midiNote
    ) {
      const output = getMidiOutput();
      if (!output) return;
      const chosenChannel = state.volca === "drum" && state.drumMultiMode
        ? clamp(Number(track.midiChannel) || 1, 1, 16)
        : clamp(Number(els.midiChannelSelect.value) || 1, 1, 16);
      const ch = chosenChannel - 1;
      const on = 0x90 + ch;
      const off = 0x80 + ch;
      const velocity = clamp(Math.round(accentData.velocity * velNorm), 1, 127);
      const baseMs = performance.now() + Math.max(0, (whenTime - audioCtx.currentTime) * 1000);
      const gateMs = Math.round(55 + accentData.normalized * 45);
      const note = clamp(Number(noteOverride) || track.midiNote, 0, 127);
      output.send([on, note, velocity], baseMs);
      output.send([off, note, 0], baseMs + gateMs);

      if (accentData.retrigger) {
        const retriggerAt = baseMs + accentData.retriggerDelayMs;
        output.send([on, note, clamp(accentData.retriggerVelocity, 1, 127)], retriggerAt);
        output.send([off, note, 0], retriggerAt + Math.max(26, gateMs - 20));
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
        tracks: state.tracks.map(({ name, midiNote, freq, mute, solo, probability, swing, accent, steps, settingsOpen, cursorStep, midiChannel, rollNotes }) => ({
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
          rollNotes
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
        rollNotes: Array.from({ length: state.length }, (_, i) => {
          const n = track.rollNotes?.[i];
          return Number.isFinite(n) ? clamp(Number(n), 0, 127) : null;
        }),
        id: crypto.randomUUID()
      }));

      els.bpmInput.value = state.bpm;
      render();
      setStatus("Pattern geladen");
    }

    function setStatus(msg) {
      els.statusText.textContent = msg;
    }
  }
}

function template() {
  return `
    <header class="topbar card">
      <div>
        <h1>Volca Style Sequencer</h1>
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

          <div class="midi-hint" id="midiHint">Advies Volca Beats: kanaal 1</div>
        </section>

        <section class="shortcuts card">
          <div><strong>Shortcuts</strong></div>
          <div>
            1–9 = track kiezen · M = mute · S = solo · I = instellingen · P/S/A = instelling kiezen · +/- = aanpassen · Shift+M = alle mutes uit · Shift+S = alle solo uit · Spatie = play/stop
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
          <label for="velocityInput">Velocity (0–127)</label>
          <input id="velocityInput" type="number" min="0" max="127" step="1" value="100" />
        </div>
        <div class="buttons-wrap">
          <button id="velocityConfirmBtn">OK</button>
          <button id="velocityCancelBtn" class="secondary" type="button">Annuleren</button>
        </div>
      </div>
    </div>
  `;
}

