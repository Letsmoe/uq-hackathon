import { test, expect, describe } from "bun:test";
import { analyzeAudio, type AudioAnalysis } from "../frontend/src/lib/chart/analyze";
import { buildChart } from "../frontend/src/lib/chart/generator/chart";
import { DIFFICULTIES, specForDifficulty } from "../frontend/src/lib/chart/generator/difficulty";
import { tickToSeconds } from "../frontend/src/lib/game/chart";
import type { Chart, ChartNote } from "../frontend/src/lib/game/chart";
import { SAMPLE_RATE, synthesizeTrack, type BarLayer } from "./synthesizeTrack";

const TRACK_BPM = 128;
const OFFSET_SEC = 0.25;

const FULL_BAR: BarLayer[] = ["kick", "snare", "hats"];
const KICK_BAR: BarLayer[] = ["kick"];

function repeatBar(layers: BarLayer[], count: number): BarLayer[][] {
  return Array.from({ length: count }, () => layers);
}

const track = synthesizeTrack({
  bpm: TRACK_BPM,
  offsetSec: OFFSET_SEC,
  bars: repeatBar(FULL_BAR, 32),
});

const analysis = analyzeAudio(track.mono, SAMPLE_RATE);

describe("audio analysis", () => {
  test("recovers the tempo of a synthetic track", () => {
    expect(analysis.grid).not.toBeNull();
    expect(analysis.grid!.bpm).toBeGreaterThan(TRACK_BPM * 0.98);
    expect(analysis.grid!.bpm).toBeLessThan(TRACK_BPM * 1.02);
  });

  test("locks the beat grid onto the first beat", () => {
    const { firstBeatSec, beatPeriodSec } = analysis.grid!;
    const phase = Math.abs(((OFFSET_SEC - firstBeatSec) / beatPeriodSec) % 1);

    expect(Math.min(phase, 1 - phase) * beatPeriodSec).toBeLessThan(0.03);
  });

  test("quantizes onsets onto known subdivisions", () => {
    expect(analysis.onsetsOnGrid.length).toBeGreaterThan(100);

    for (const onset of analysis.onsetsOnGrid) {
      expect([1, 2, 3, 4]).toContain(onset.subdivision);
    }
  });

  test("separates the three drum registers", () => {
    const voices = new Set(analysis.onsetsOnGrid.map((onset) => onset.voice));

    expect([...voices].sort()).toEqual(["high", "low", "mid"]);
  });
});

describe("chart building", () => {
  test.each(DIFFICULTIES)("%s places every note on a real hit", (difficulty) => {
    const chart = buildChart(analysis, difficulty);
    const times = noteTimes(chart);

    expect(times.length).toBeGreaterThan(20);

    for (const timeSec of times) {
      expect(nearestHitDistance(timeSec)).toBeLessThan(0.06);
    }
  });

  test.each(DIFFICULTIES)("%s honours its spacing and chord limits", (difficulty) => {
    const chart = buildChart(analysis, difficulty);
    const spec = specForDifficulty(difficulty);

    expectMinimumInterval(chart, spec.minNoteIntervalSec);
    expectChordWidth(chart, spec.maxNotesPerTick);
  });

  test.each(DIFFICULTIES)("%s stays under its density budget", (difficulty) => {
    const chart = buildChart(analysis, difficulty);
    const spec = specForDifficulty(difficulty);

    expect(chart.note_list.length / chart.length).toBeLessThanOrEqual(
      spec.targetNotesPerSecond * 1.1,
    );
  });

  test("difficulty raises the note count monotonically", () => {
    const counts = DIFFICULTIES.map((difficulty) => buildChart(analysis, difficulty).note_list.length);

    for (let index = 1; index < counts.length; index++) {
      expect(counts[index]).toBeGreaterThan(counts[index - 1]);
    }
  });

  test("every note sits inside the playfield", () => {
    for (const x of allNoteX(buildChart(analysis, "chaos"))) {
      expect(x).toBeGreaterThanOrEqual(0.08);
      expect(x).toBeLessThanOrEqual(0.92);
    }
  });

  test("pages tile the track without gaps", () => {
    const pages = buildChart(analysis, "hard").page_list;

    expect(pages.length).toBeGreaterThan(0);

    for (let index = 1; index < pages.length; index++) {
      expect(pages[index].start_tick).toBe(pages[index - 1].end_tick);
    }
  });

  test("note ids are handed out in play order", () => {
    const chart = buildChart(analysis, "expert");
    const times = noteTimes(chart);

    chart.note_list.forEach((note, index) => expect(note.id).toBe(index));

    for (let index = 1; index < times.length; index++) {
      expect(times[index]).toBeGreaterThanOrEqual(times[index - 1]);
    }
  });
});

describe("musical structure", () => {
  const structured = synthesizeTrack({
    bpm: TRACK_BPM,
    offsetSec: OFFSET_SEC,
    bars: [...repeatBar(KICK_BAR, 16), ...repeatBar(FULL_BAR, 16), ...repeatBar(KICK_BAR, 16)],
  });
  const structuredAnalysis = analyzeAudio(structured.mono, SAMPLE_RATE);

  test("splits the track where the instrumentation changes", () => {
    expect(structuredAnalysis.sections.length).toBeGreaterThan(1);
  });

  test("recognises the returning section", () => {
    const repeats = structuredAnalysis.sections.filter((section) => section.repeatOfIndex >= 0);

    expect(repeats.length).toBeGreaterThan(0);
  });

  test("a returning section replays the chart of its first appearance", () => {
    const chart = buildChart(structuredAnalysis, "hard");
    const repeated = structuredAnalysis.sections.find((section) => section.repeatOfIndex >= 0)!;
    const source = structuredAnalysis.sections[repeated.repeatOfIndex];
    const shiftTicks = (repeated.startBeat - source.startBeat) * chart.time_base;

    const inSource = ticksInBeatRange(chart, structuredAnalysis, source.startBeat, source.endBeat);
    const inRepeat = ticksInBeatRange(
      chart,
      structuredAnalysis,
      repeated.startBeat,
      repeated.endBeat,
    );

    // A repeat that runs shorter than its source is clipped at its own end, so
    // the replay is asserted as a prefix rather than as an exact copy.
    const shifted = inSource.map((tick) => tick + shiftTicks);

    expect(inRepeat.length).toBeGreaterThan(0);
    expect(shifted.slice(0, inRepeat.length)).toEqual(inRepeat);
  });

  test("the busier half of a track carries more notes", () => {
    const rising = synthesizeTrack({
      bpm: TRACK_BPM,
      offsetSec: OFFSET_SEC,
      bars: [...repeatBar(KICK_BAR, 16), ...repeatBar(FULL_BAR, 16)],
    });
    const chart = buildChart(analyzeAudio(rising.mono, SAMPLE_RATE), "hard");
    const times = noteTimes(chart);
    const halfway = chart.length / 2;

    const early = times.filter((timeSec) => timeSec < halfway).length;
    const late = times.filter((timeSec) => timeSec >= halfway).length;

    expect(late).toBeGreaterThan(early);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function startTickOf(note: ChartNote): number {
  if (note.nodes && note.nodes.length > 0) {
    return note.nodes[0].tick;
  }

  return note.tick!;
}

function noteTimes(chart: Chart): number[] {
  return chart.note_list.map((note) => tickToSeconds(startTickOf(note), chart.bpm, chart.time_base));
}

function allNoteX(chart: Chart): number[] {
  return chart.note_list.flatMap((note) => {
    if (note.nodes) {
      return note.nodes.map((node) => node.x);
    }

    return [note.x!];
  });
}

function nearestHitDistance(timeSec: number): number {
  let nearest = Infinity;

  for (const hit of track.hitTimes) {
    nearest = Math.min(nearest, Math.abs(hit - timeSec));
  }

  return nearest;
}

function ticksInBeatRange(
  chart: Chart,
  source: AudioAnalysis,
  startBeat: number,
  endBeat: number,
): number[] {
  const offsetTicks = Math.round((source.grid!.firstBeatSec * chart.bpm * chart.time_base) / 60);
  const startTick = offsetTicks + startBeat * chart.time_base;
  const endTick = offsetTicks + endBeat * chart.time_base;

  return chart.note_list
    .map(startTickOf)
    .filter((tick) => tick >= startTick && tick < endTick);
}

function expectMinimumInterval(chart: Chart, minIntervalSec: number): void {
  const distinct = [...new Set(noteTimes(chart))].sort((first, second) => first - second);

  for (let index = 1; index < distinct.length; index++) {
    expect(distinct[index] - distinct[index - 1]).toBeGreaterThan(minIntervalSec * 0.95);
  }
}

function expectChordWidth(chart: Chart, maxNotesPerTick: number): void {
  const counts = new Map<number, number>();

  for (const note of chart.note_list) {
    const tick = startTickOf(note);

    counts.set(tick, (counts.get(tick) || 0) + 1);
  }

  for (const count of counts.values()) {
    expect(count).toBeLessThanOrEqual(maxNotesPerTick);
  }
}
