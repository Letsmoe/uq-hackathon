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
  allowDrags: boolean;
  /** Shortest run of evenly spaced notes that becomes a drag instead of taps. */
  minDragNotes: number;
  /** Budget for how far a hand may travel across the playfield per second. */
  handSpeedPerSecond: number;
  /** Combined strength a grid position needs before it widens into a chord. */
  chordStrength: number;
}

const SPECS: Record<Difficulty, DifficultySpec> = {
  easy: {
    voices: ["low"],
    allowedSubdivisions: [1],
    targetNotesPerSecond: 1.3,
    minNoteIntervalSec: 0.3,
    maxNotesPerTick: 1,
    allowHolds: true,
    allowDrags: false,
    minDragNotes: 99,
    handSpeedPerSecond: 0.55,
    chordStrength: 2,
  },
  normal: {
    voices: ["low", "mid"],
    allowedSubdivisions: [1, 2],
    targetNotesPerSecond: 2.3,
    minNoteIntervalSec: 0.2,
    maxNotesPerTick: 2,
    allowHolds: true,
    allowDrags: true,
    minDragNotes: 5,
    handSpeedPerSecond: 0.85,
    chordStrength: 1.5,
  },
  hard: {
    voices: ["low", "mid", "high"],
    allowedSubdivisions: [1, 2, 3],
    targetNotesPerSecond: 3.5,
    minNoteIntervalSec: 0.14,
    maxNotesPerTick: 3,
    allowHolds: true,
    allowDrags: true,
    minDragNotes: 4,
    handSpeedPerSecond: 1.25,
    chordStrength: 1.3,
  },
  expert: {
    voices: ["low", "mid", "high"],
    allowedSubdivisions: [1, 2, 3, 4],
    targetNotesPerSecond: 5,
    minNoteIntervalSec: 0.1,
    maxNotesPerTick: 3,
    allowHolds: true,
    allowDrags: true,
    minDragNotes: 4,
    handSpeedPerSecond: 1.7,
    chordStrength: 1.15,
  },
  chaos: {
    voices: ["low", "mid", "high"],
    allowedSubdivisions: [1, 2, 3, 4],
    targetNotesPerSecond: 6.5,
    minNoteIntervalSec: 0.075,
    maxNotesPerTick: 4,
    allowHolds: true,
    allowDrags: true,
    minDragNotes: 4,
    handSpeedPerSecond: 2.2,
    chordStrength: 1,
  },
};

export function specForDifficulty(difficulty: Difficulty): DifficultySpec {
  const spec = SPECS[difficulty];

  if (!spec) {
    return SPECS.normal;
  }

  return spec;
}
