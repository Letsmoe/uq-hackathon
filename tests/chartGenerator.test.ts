import { test, expect, describe } from "bun:test";
import { analyzeAudio, type AudioAnalysis } from "../frontend/src/lib/chart/analyze";
import { buildChart } from "../frontend/src/lib/chart/generator/chart";
import { DIFFICULTIES, specForDifficulty } from "../frontend/src/lib/chart/generator/difficulty";
import { getScanLineY, tickToSeconds } from "../frontend/src/lib/game/chart";
import type { Chart, ChartNote } from "../frontend/src/lib/game/chart";
import { NoteType } from "../frontend/src/lib/game/types";
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

    expect(hitCount(chart) / chart.length).toBeLessThanOrEqual(spec.targetNotesPerSecond * 1.1);
  });

  test("difficulty raises the note count monotonically", () => {
    const counts = DIFFICULTIES.map((difficulty) => hitCount(buildChart(analysis, difficulty)));

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

  test.each(DIFFICULTIES)("%s never draws two notes on top of each other", (difficulty) => {
    const chart = buildChart(analysis, difficulty);

    expectNoOverlap(chart);
  });

  test.each(DIFFICULTIES)("%s keeps holds a minority of its notes", (difficulty) => {
    const chart = buildChart(analysis, difficulty);
    const spec = specForDifficulty(difficulty);
    const holds = chart.note_list.filter((note) => (note.duration ?? 0) > 0);

    expect(holds.length / chart.note_list.length).toBeLessThanOrEqual(spec.holdShare);
  });

  test("holds and drags both reach the chart", () => {
    const holds = buildChart(analysis, "normal").note_list.filter(
      (note) => (note.duration ?? 0) > 0,
    );
    const drags = buildChart(analysis, "chaos").note_list.filter(
      (note) => note.type === NoteType.Chain,
    );

    expect(holds.length).toBeGreaterThan(0);
    expect(drags.length).toBeGreaterThan(0);
  });

  test.each(DIFFICULTIES)("%s keeps drags a texture rather than the chart", (difficulty) => {
    const chart = buildChart(analysis, difficulty);
    const spec = specForDifficulty(difficulty);
    const dragNodes = chart.note_list
      .filter((note) => note.type === NoteType.Chain)
      .reduce((total, note) => total + (note.nodes?.length ?? 0), 0);

    expect(dragNodes / hitCount(chart)).toBeLessThanOrEqual(spec.dragShare + 0.15);
  });

  test.each(DIFFICULTIES)("%s leaves room to release a hold", (difficulty) => {
    const chart = buildChart(analysis, difficulty);
    const spec = specForDifficulty(difficulty);

    expectHoldsRelease(chart, spec.minNoteIntervalSec);
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

    // The replay is clipped at its own end and loses any opening note that
    // collides with what the previous section left on screen, so it is asserted
    // as a subsequence of the source rather than as an exact copy.
    const shifted = inSource.map((tick) => tick + shiftTicks);

    expect(inRepeat.length).toBeGreaterThan(0);
    expect(inRepeat.length).toBeGreaterThan(inSource.length * 0.8);
    expectSubsequence(inRepeat, shifted);
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

/** What the player actually hits: a drag counts once per node. */
function hitCount(chart: Chart): number {
  return chart.note_list.reduce((total, note) => {
    if (note.nodes) {
      return total + note.nodes.length;
    }

    return total + 1;
  }, 0);
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

// What a note takes up on screen, as a share of the playfield. Notes are
// static and the beam sweeps over them, so two of them at the same height are
// drawn on top of each other however far apart in time they are.
const NOTE_HEIGHT = 0.17;
const NOTE_HALF_WIDTH = 0.1;
const HOLD_TAIL_HALF_WIDTH = 0.03;
// A drag node is drawn smaller than a tap, so it clears its neighbours at a
// smaller distance.
const CHAIN_HALF_WIDTH = NOTE_HALF_WIDTH * 0.62;
const CO_VISIBLE_SEC = 1.3;

function requiredGapAt(heightGap: number, halfWidths: number): number {
  const closeness = 1 - (heightGap / NOTE_HEIGHT) ** 2;

  return halfWidths * Math.sqrt(Math.max(0, closeness));
}

interface DrawnNote {
  /** Index of the chart note this came from; a hold draws two of these. */
  owner: number;
  startSec: number;
  endSec: number;
  /** Where it sits on the playfield: 0 is the top edge, 1 the bottom. */
  yFrom: number;
  yTo: number;
  x: number;
  halfWidth: number;
}

function drawnNotes(chart: Chart): DrawnNote[] {
  return chart.note_list.flatMap((note, owner) => {
    if (note.nodes) {
      return note.nodes.map((node) => ({
        ...drawnBody(chart, node.tick, node.x),
        halfWidth: CHAIN_HALF_WIDTH,
        owner,
      }));
    }

    return holdOrBody(chart, note, owner);
  });
}

function holdOrBody(chart: Chart, note: ChartNote, owner: number): DrawnNote[] {
  const head = { ...drawnBody(chart, note.tick!, note.x!), owner };

  if (!note.duration) {
    return [head];
  }

  return [head, { ...drawnTail(chart, note), owner }];
}

function drawnBody(chart: Chart, tick: number, x: number): DrawnNote {
  const timeSec = tickToSeconds(tick, chart.bpm, chart.time_base);
  const y = getScanLineY(timeSec, chart.page_list, chart.bpm, chart.time_base);

  return {
    owner: -1,
    startSec: timeSec,
    endSec: timeSec,
    yFrom: y,
    yTo: y,
    x,
    halfWidth: NOTE_HALF_WIDTH,
  };
}

/** The slab between a hold's head and its tail end, folds included. */
function drawnTail(chart: Chart, note: ChartNote): DrawnNote {
  const startSec = tickToSeconds(note.tick!, chart.bpm, chart.time_base);
  const endSec = tickToSeconds(note.tick! + note.duration!, chart.bpm, chart.time_base);
  const samples = sampleScanY(chart, startSec, endSec);

  return {
    owner: -1,
    startSec,
    endSec,
    yFrom: Math.min(...samples),
    yTo: Math.max(...samples),
    x: note.x!,
    halfWidth: HOLD_TAIL_HALF_WIDTH,
  };
}

function sampleScanY(chart: Chart, startSec: number, endSec: number): number[] {
  const steps = 24;
  const samples: number[] = [];

  for (let step = 0; step <= steps; step++) {
    const timeSec = startSec + ((endSec - startSec) * step) / steps;
    samples.push(getScanLineY(timeSec, chart.page_list, chart.bpm, chart.time_base));
  }

  return samples;
}

function heightGapBetween(first: DrawnNote, second: DrawnNote): number {
  return Math.max(0, first.yFrom - second.yTo, second.yFrom - first.yTo);
}

function sharesTheScreen(first: DrawnNote, second: DrawnNote): boolean {
  const timeGap = Math.max(0, first.startSec - second.endSec, second.startSec - first.endSec);

  return timeGap < CO_VISIBLE_SEC;
}

function expectNoOverlap(chart: Chart): void {
  const drawn = drawnNotes(chart).sort((first, second) => first.startSec - second.startSec);

  for (let index = 1; index < drawn.length; index++) {
    expectClearOfEarlier(drawn, index);
  }
}

function expectClearOfEarlier(drawn: DrawnNote[], index: number): void {
  const note = drawn[index];

  for (let earlier = index - 1; earlier >= 0; earlier--) {
    const other = drawn[earlier];

    if (other.owner === note.owner) continue;
    if (!sharesTheScreen(note, other)) continue;

    const heightGap = heightGapBetween(note, other);
    const needed = requiredGapAt(heightGap, note.halfWidth + other.halfWidth);

    expect(Math.abs(note.x - other.x)).toBeGreaterThanOrEqual(needed - 1e-6);
  }
}

function expectSubsequence(candidate: number[], within: number[]): void {
  let cursor = 0;

  for (const value of candidate) {
    cursor = within.indexOf(value, cursor);

    expect(cursor).toBeGreaterThanOrEqual(0);
    cursor++;
  }
}

function expectHoldsRelease(chart: Chart, minIntervalSec: number): void {
  const drawn = drawnNotes(chart).sort((first, second) => first.startSec - second.startSec);

  for (let index = 0; index < drawn.length; index++) {
    expectTailClearsNext(drawn, index, minIntervalSec);
  }
}

function expectTailClearsNext(drawn: DrawnNote[], index: number, minIntervalSec: number): void {
  const hold = drawn[index];

  if (hold.endSec === hold.startSec) {
    return;
  }

  const next = drawn.find((other) => other.startSec > hold.startSec + 1e-6);

  if (!next) {
    return;
  }

  expect(next.startSec - hold.endSec).toBeGreaterThanOrEqual(minIntervalSec * 0.95);
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
