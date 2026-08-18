import { analyzeAudioFile } from "./cpp/audioChartWasm";
import type { Difficulty } from "./cpp/audioChartWasm";
import patterns from "../assets/patterns.json";
import type { Chart } from "./game/chart";

const TIME_BASE = 480;
const BEATS_PER_PAGE = 4;

/** Ordered easiest to hardest, which is the order the difficulty picker steps through. */
export const DIFFICULTIES: Difficulty[] = [
  "easy",
  "normal",
  "hard",
  "expert",
  "chaos",
];

export type { Difficulty };

/**
 * Generates the chart for one difficulty. Decoding detaches the buffer it is
 * handed, so a copy is passed and the caller keeps its own for playback and for
 * generating the other difficulties later.
 */
export async function generateChart(
  audio: ArrayBuffer,
  difficulty: Difficulty,
): Promise<Chart> {
  return analyzeAudioFile(audio.slice(0), patterns, {
    timeBase: TIME_BASE,
    beatsPerPage: BEATS_PER_PAGE,
    difficulty,
  });
}
