import { describe, expect, test } from "bun:test";
import {
  formatCount,
  formatDuration,
  levelForDifficulty,
  statsForChart,
} from "../frontend/src/lib/trackStats";
import type { Chart } from "../frontend/src/lib/game/chart";
import { NoteType } from "../frontend/src/lib/game/types";

function chartWith(noteCount: number, lengthSeconds: number): Chart {
  return {
    bpm: 174.4,
    time_base: 480,
    length: lengthSeconds,
    start_offset_time: 0,
    note_list: Array.from({ length: noteCount }, () => ({ type: NoteType.Tap })),
    page_list: [],
  };
}

describe("statsForChart", () => {
  test("reports tempo, length and note count of the chart", () => {
    const stats = statsForChart(chartWith(900, 238));

    expect(stats.bpm).toBe(174);
    expect(stats.durationSeconds).toBe(238);
    expect(stats.noteCount).toBe(900);
  });
});

describe("formatDuration", () => {
  test("pads the seconds to two digits", () => {
    expect(formatDuration(238)).toBe("3:58");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(0)).toBe("0:00");
  });

  test("never renders a negative clock", () => {
    expect(formatDuration(-10)).toBe("0:00");
  });
});

describe("formatCount", () => {
  test("groups thousands", () => {
    expect(formatCount(1284)).toBe("1,284");
  });
});

describe("levelForDifficulty", () => {
  test("rises with the difficulty when no chart has been built", () => {
    const levels = (["easy", "normal", "hard", "expert", "chaos"] as const).map(
      (difficulty) => levelForDifficulty(difficulty),
    );

    for (let index = 1; index < levels.length; index++) {
      expect(levels[index]).toBeGreaterThan(levels[index - 1]);
    }
  });

  test("reads the built chart's density rather than the estimate", () => {
    const dense = levelForDifficulty("easy", chartWith(1200, 200));
    const sparse = levelForDifficulty("chaos", chartWith(60, 200));

    expect(dense).toBeGreaterThan(sparse);
  });

  test("stays inside the 1..15 scale", () => {
    expect(levelForDifficulty("chaos", chartWith(6000, 100))).toBe(15);
    expect(levelForDifficulty("easy", chartWith(1, 600))).toBe(1);
  });
});
