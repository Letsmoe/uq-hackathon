import type { Voice } from "../dsp/onsets";

export type Difficulty = "easy" | "normal" | "hard" | "expert" | "chaos";

/** Ordered easiest to hardest, which is the order the difficulty picker steps through. */
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "expert", "chaos"];

/**
 * What separates one difficulty from the next. Difficulty is expressed as which
 * layers of the music get mapped and how finely, not as a random pattern level:
 * an easy chart is the kick drum on the beat, a hard chart adds the snare and
 * the hats, and only the top difficulties chase sixteenths and triplets.
 */
export interface DifficultySpec {
  voices: Voice[];
  allowedSubdivisions: number[];
  /** Density target the ranked selection aims at, before section scaling. */
  targetNotesPerSecond: number;
  minNoteIntervalSec: number;
  maxNotesPerTick: number;
  allowHolds: boolean;
  /** Ceiling on the share of a section's notes that may be holds. */
  holdShare: number;
  allowDrags: boolean;
  /** Shortest run of evenly spaced notes that becomes a drag instead of taps. */
  minDragNotes: number;
  /** Ceiling on the share of a section's slots that drags may swallow. */
  dragShare: number;
  /** Budget for how far a hand may travel across the playfield per second. */
  handSpeedPerSecond: number;
  /** Combined strength a grid position needs before it widens into a chord. */
  chordStrength: number;
  /** Ceiling on the share of a section's slots that may play as chords. */
  chordShare: number;
}

const SPECS: Record<Difficulty, DifficultySpec> = {
  easy: {
    voices: ["low"],
    allowedSubdivisions: [1],
    targetNotesPerSecond: 1.3,
    minNoteIntervalSec: 0.3,
    maxNotesPerTick: 1,
    allowHolds: true,
    holdShare: 0.14,
    allowDrags: false,
    minDragNotes: 99,
    dragShare: 0.0,
    handSpeedPerSecond: 0.55,
    chordStrength: 2,
    chordShare: 0.0,
  },
  normal: {
    voices: ["low", "mid"],
    allowedSubdivisions: [1, 2],
    targetNotesPerSecond: 2.3,
    minNoteIntervalSec: 0.2,
    maxNotesPerTick: 2,
    allowHolds: true,
    holdShare: 0.1,
    allowDrags: true,
    minDragNotes: 5,
    dragShare: 0.12,
    handSpeedPerSecond: 0.85,
    chordStrength: 1.5,
    chordShare: 0.06,
  },
  hard: {
    voices: ["low", "mid", "high"],
    allowedSubdivisions: [1, 2, 3],
    targetNotesPerSecond: 3.5,
    minNoteIntervalSec: 0.14,
    maxNotesPerTick: 3,
    allowHolds: true,
    holdShare: 0.08,
    allowDrags: true,
    minDragNotes: 3,
    dragShare: 0.18,
    handSpeedPerSecond: 1.25,
    chordStrength: 1.3,
    chordShare: 0.1,
  },
  expert: {
    voices: ["low", "mid", "high"],
    allowedSubdivisions: [1, 2, 3, 4],
    targetNotesPerSecond: 5,
    minNoteIntervalSec: 0.1,
    maxNotesPerTick: 3,
    allowHolds: true,
    holdShare: 0.06,
    allowDrags: true,
    minDragNotes: 3,
    dragShare: 0.22,
    handSpeedPerSecond: 1.7,
    chordStrength: 1.15,
    chordShare: 0.14,
  },
  chaos: {
    voices: ["low", "mid", "high"],
    allowedSubdivisions: [1, 2, 3, 4],
    targetNotesPerSecond: 6.5,
    minNoteIntervalSec: 0.075,
    maxNotesPerTick: 3,
    allowHolds: true,
    holdShare: 0.05,
    allowDrags: true,
    minDragNotes: 3,
    dragShare: 0.28,
    handSpeedPerSecond: 2.2,
    chordStrength: 1,
    chordShare: 0.18,
  },
};

export function specForDifficulty(difficulty: Difficulty): DifficultySpec {
  const spec = SPECS[difficulty];

  if (!spec) {
    return SPECS.normal;
  }

  return spec;
}
