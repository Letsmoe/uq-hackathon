import type { Onset, Voice } from "../dsp/onsets";
import type { BeatGrid } from "../dsp/tempo";

/** Denominators a beat may be divided by, tried coarsest first. */
export const SUBDIVISIONS = [1, 2, 3, 4] as const;

const BEATS_PER_BAR = 4;

// An onset must land this close to a grid position to be treated as played on
// it. Anything looser turns reverb tails and ghost notes into notes.
const ABSOLUTE_TOLERANCE_SEC = 0.045;
const RELATIVE_TOLERANCE = 0.3;

/** An onset locked to the beat grid, with the metrical context a chart needs. */
export interface GridOnset {
  /** Position in beats from the first beat; always an exact multiple of 1/subdivision. */
  beatPosition: number;
  subdivision: number;
  voice: Voice;
  strength: number;
  pitchNorm: number;
  sustainBeats: number;
  /** How musically important the position is: downbeat highest, offbeat lowest. */
  metricWeight: number;
}

export function quantizeOnsets(onsets: Onset[], grid: BeatGrid): GridOnset[] {
  const snapped: GridOnset[] = [];

  for (const onset of onsets) {
    const quantized = snapOnset(onset, grid);

    if (!quantized) continue;

    snapped.push(quantized);
  }

  return dedupe(snapped);
}

function snapOnset(onset: Onset, grid: BeatGrid): GridOnset | null {
  const beatPosition = (onset.timeSec - grid.firstBeatSec) / grid.beatPeriodSec;

  if (beatPosition < 0 || beatPosition > grid.beatCount) {
    return null;
  }

  const subdivision = coarsestFittingSubdivision(beatPosition, grid.beatPeriodSec);

  if (subdivision === 0) {
    return null;
  }

  return buildGridOnset(onset, grid, beatPosition, subdivision);
}

/**
 * Prefers the coarsest grid the onset fits, so a note that could be read as a
 * quarter is not written as a sixteenth that happens to line up.
 */
function coarsestFittingSubdivision(beatPosition: number, beatPeriodSec: number): number {
  for (const subdivision of SUBDIVISIONS) {
    const spacingSec = beatPeriodSec / subdivision;
    const errorBeats = Math.abs(beatPosition - roundTo(beatPosition, subdivision));
    const tolerance = Math.min(ABSOLUTE_TOLERANCE_SEC, spacingSec * RELATIVE_TOLERANCE);

    if (errorBeats * beatPeriodSec <= tolerance) return subdivision;
  }

  return 0;
}

function roundTo(beatPosition: number, subdivision: number): number {
  return Math.round(beatPosition * subdivision) / subdivision;
}

function buildGridOnset(
  onset: Onset,
  grid: BeatGrid,
  rawPosition: number,
  subdivision: number,
): GridOnset {
  const beatPosition = roundTo(rawPosition, subdivision);

  return {
    beatPosition,
    subdivision,
    voice: onset.voice,
    strength: onset.strength,
    pitchNorm: onset.pitchNorm,
    sustainBeats: onset.sustainSec / grid.beatPeriodSec,
    metricWeight: metricWeightFor(beatPosition, grid.downbeatPhase),
  };
}

function metricWeightFor(beatPosition: number, downbeatPhase: number): number {
  const inBar = modulo(beatPosition - downbeatPhase, BEATS_PER_BAR);

  if (inBar === 0) return 1;
  if (Number.isInteger(inBar)) return 0.85;
  if (inBar * 2 === Math.round(inBar * 2)) return 0.6;

  return 0.4;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** One voice can only play one note per grid position; the loudest hit wins. */
function dedupe(onsets: GridOnset[]): GridOnset[] {
  const strongest = new Map<string, GridOnset>();

  for (const onset of onsets) {
    const key = `${onset.voice}@${onset.beatPosition}`;
    const existing = strongest.get(key);

    if (existing && existing.strength >= onset.strength) continue;

    strongest.set(key, onset);
  }

  return [...strongest.values()].sort(byBeatPosition);
}

function byBeatPosition(first: GridOnset, second: GridOnset): number {
  return first.beatPosition - second.beatPosition;
}
