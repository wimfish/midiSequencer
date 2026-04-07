export const volcaProfiles = {
  beats: {
    name: "Volca Beats",
    channel: 1,
    initialVisible: 4,
    maxTracks: 6,
    tracks: [
      { name: "Kick", midiNote: 36, freq: 80 },
      { name: "Snare", midiNote: 38, freq: 190 },
      { name: "Hi-hat", midiNote: 42, freq: 4200 },
      { name: "Ghost/Tom", midiNote: 43, freq: 150 },
      { name: "Clap", midiNote: 39, freq: 2400 },
      { name: "Open Hat", midiNote: 46, freq: 5200 }
    ]
  },
  sample: {
    name: "Volca Sample",
    channel: 1,
    initialVisible: 6,
    maxTracks: 10,
    tracks: [
      { name: "Sample 1", midiNote: 36, freq: 80 },
      { name: "Sample 2", midiNote: 37, freq: 100 },
      { name: "Sample 3", midiNote: 38, freq: 190 },
      { name: "Sample 4", midiNote: 39, freq: 230 },
      { name: "Sample 5", midiNote: 40, freq: 4200 },
      { name: "Sample 6", midiNote: 41, freq: 3200 },
      { name: "Sample 7", midiNote: 42, freq: 150 },
      { name: "Sample 8", midiNote: 43, freq: 180 },
      { name: "Sample 9", midiNote: 44, freq: 520 },
      { name: "Sample 10", midiNote: 45, freq: 900 }
    ]
  },
  drum: {
    name: "Volca Drum",
    channel: 1,
    initialVisible: 6,
    maxTracks: 10,
    tracks: [
      { name: "Part 1", midiNote: 60, freq: 100 },
      { name: "Part 2", midiNote: 62, freq: 130 },
      { name: "Part 3", midiNote: 64, freq: 180 },
      { name: "Part 4", midiNote: 65, freq: 240 },
      { name: "Part 5", midiNote: 67, freq: 3600 },
      { name: "Part 6", midiNote: 69, freq: 4200 },
      { name: "Part 7", midiNote: 71, freq: 300 },
      { name: "Part 8", midiNote: 72, freq: 540 },
      { name: "Part 9", midiNote: 74, freq: 760 },
      { name: "Part 10", midiNote: 76, freq: 980 }
    ]
  }
};

