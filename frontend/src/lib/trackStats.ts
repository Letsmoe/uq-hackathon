import { specForDifficulty } from "./chart/generator/difficulty";
import type { Difficulty } from "./chart/generator/difficulty";
import type { Chart } from "./game/chart";

/** Levels run 1..15, the span players read as "how hard is this chart". */
const MIN_LEVEL = 1;
const MAX_LEVEL = 15;
const LEVEL_PER_NOTE_PER_SECOND = 2.1;

export type TrackStats = {
  bpm: number;
  durationSeconds: number;
  noteCount: number;
};

export function statsForChart(chart: Chart): TrackStats {
  return {
    bpm: Math.round(chart.bpm),
    durationSeconds: chart.length,
    noteCount: chart.note_list.length,
  };
}

export function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * A chart's level is its note density. The generator aims at a notes-per-second
 * target per difficulty, so that target is the estimate until the chart has
 * been built and the chart itself answers for the song afterwards.
 */
export function levelForDifficulty(
  difficulty: Difficulty,
  chart?: Chart,
): number {
  const level = Math.round(
    notesPerSecond(difficulty, chart) * LEVEL_PER_NOTE_PER_SECOND,
  );

  return clampLevel(level);
}

function notesPerSecond(difficulty: Difficulty, chart?: Chart): number {
  if (!chart || chart.length <= 0) {
    return specForDifficulty(difficulty).targetNotesPerSecond;
  }

  return chart.note_list.length / chart.length;
}

function clampLevel(level: number): number {
  if (level < MIN_LEVEL) {
    return MIN_LEVEL;
  }

  if (level > MAX_LEVEL) {
    return MAX_LEVEL;
  }

  return level;
}
