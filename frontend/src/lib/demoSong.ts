import { generateChart } from "./chartGeneration";
import type { Difficulty } from "./chartGeneration";
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
  const chart = await generateChart(buffer, difficulty);

  return { chart, buffer };
}
