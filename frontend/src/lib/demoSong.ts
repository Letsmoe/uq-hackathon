import { analyzeAudioFile } from "./cpp/audioChartWasm";
import type { Difficulty } from "./cpp/audioChartWasm";
import patterns from "../assets/patterns.json";
import type { Chart } from "./game/chart";

const DEMO_AUDIO_URL = "/demo.mp3";

export interface DemoSong {
  chart: Chart;
  buffer: ArrayBuffer;
}

/**
 * Loads the optional bundled demo track, so the game is playable without going
 * through an upload. On a tablet that is the only practical way to test.
 *
 * Returns null when no demo file is bundled, which is the case for any build
 * that ships: the game carries no music of its own.
 */
export async function loadDemoSong(
  difficulty: Difficulty = "normal",
): Promise<DemoSong | null> {
  const response = await fetch(DEMO_AUDIO_URL);
  if (!response.ok) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  // analyzeAudioFile detaches whatever it decodes, so it is handed a copy and
  // the original is kept for playback.
  const chart = await analyzeAudioFile(buffer.slice(0), patterns, {
    timeBase: 480,
    beatsPerPage: 4,
    difficulty,
  });

  return { chart, buffer };
}
