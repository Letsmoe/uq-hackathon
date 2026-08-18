import type { Chart, ChartNote, PageEntry } from "../../game/chart";
import type { Section } from "../dsp/structure";
import type { BeatGrid } from "../dsp/tempo";
import type { AudioAnalysis } from "../analyze";
import { specForDifficulty, type Difficulty, type DifficultySpec } from "./difficulty";
import { newLayoutState, placeEvents, type LayoutState, type PlacedNote } from "./layout";
import { selectEvents, SLOTS_PER_BEAT, type SectionEvents } from "./select";

export const TIME_BASE = 480;
export const BEATS_PER_PAGE = 4;
const TICKS_PER_SLOT = TIME_BASE / SLOTS_PER_BEAT;
const FALLBACK_BPM = 120;

const NOTE_TYPE = { tap: 0, hold: 2, drag: 3 } as const;

export function buildChart(analysis: AudioAnalysis, difficulty: Difficulty): Chart {
  if (!analysis.grid) {
    return emptyChart(analysis.durationSec);
  }

  const placed = placeAllSections(analysis, difficulty);

  return {
    bpm: analysis.grid.bpm,
    time_base: TIME_BASE,
    start_offset_time: 0,
    length: analysis.durationSec,
    page_list: buildPageList(analysis.grid, analysis.durationSec),
    note_list: toNoteList(placed, offsetTicksOf(analysis.grid)),
  };
}

function emptyChart(durationSec: number): Chart {
  return {
    bpm: FALLBACK_BPM,
    time_base: TIME_BASE,
    start_offset_time: 0,
    length: durationSec,
    page_list: buildPageList(fallbackGrid(durationSec), durationSec),
    note_list: [],
  };
}

function fallbackGrid(durationSec: number): BeatGrid {
  const beatPeriodSec = 60 / FALLBACK_BPM;

  return {
    bpm: FALLBACK_BPM,
    beatPeriodSec,
    firstBeatSec: 0,
    beatCount: Math.floor(durationSec / beatPeriodSec),
    downbeatPhase: 0,
  };
}

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * Sections the structure analysis marked as repeats replay the notes of the
 * section they repeat, shifted onto their own bars. A returning chorus then
 * plays exactly what it played the first time, which is what a human charter
 * would write and what makes a generated chart readable.
 */
function placeAllSections(analysis: AudioAnalysis, difficulty: Difficulty): PlacedNote[] {
  const spec = specForDifficulty(difficulty);
  const grid = analysis.grid!;
  const sectionEvents = selectEvents(analysis.onsetsOnGrid, analysis.sections, spec, grid);
  const state = newLayoutState();
  const perSection: PlacedNote[][] = [];

  for (let index = 0; index < sectionEvents.length; index++) {
    perSection.push(notesForSection(sectionEvents, index, perSection, spec, grid, state));
  }

  return perSection.flat();
}

function notesForSection(
  sectionEvents: SectionEvents[],
  index: number,
  perSection: PlacedNote[][],
  spec: DifficultySpec,
  grid: BeatGrid,
  state: LayoutState,
): PlacedNote[] {
  const entry = sectionEvents[index];
  const sourceIndex = entry.section.repeatOfIndex;
  const source = perSection[sourceIndex];

  if (source && source.length > 0) {
    return replaySection(source, sectionEvents[sourceIndex].section, entry.section, state);
  }

  return placeEvents(entry.events, spec, grid, state);
}

function replaySection(
  source: PlacedNote[],
  sourceSection: Section,
  section: Section,
  state: LayoutState,
): PlacedNote[] {
  const shiftBeats = section.startBeat - sourceSection.startBeat;
  const endSlot = section.endBeat * SLOTS_PER_BEAT;
  const replayed = source
    .map((note) => shiftNote(note, shiftBeats * SLOTS_PER_BEAT))
    .filter((note) => lastSlotOf(note) < endSlot);

  rememberLast(replayed, state);

  return replayed;
}

function lastSlotOf(note: PlacedNote): number {
  const nodes = note.dragNodes;

  if (nodes.length > 0) {
    return nodes[nodes.length - 1].slot;
  }

  return note.slot + note.durationSlots;
}

function shiftNote(note: PlacedNote, shift: number): PlacedNote {
  return {
    ...note,
    slot: note.slot + shift,
    dragNodes: note.dragNodes.map((node) => ({ ...node, slot: node.slot + shift })),
  };
}

function rememberLast(notes: PlacedNote[], state: LayoutState): void {
  const last = notes[notes.length - 1];

  if (!last) {
    return;
  }

  state.previousX = last.x;
  state.previousSlot = last.slot;
}

// ── Chart assembly ──────────────────────────────────────────────────────────

function offsetTicksOf(grid: BeatGrid): number {
  return Math.round(grid.firstBeatSec / secondsPerTick(grid.bpm));
}

function secondsPerTick(bpm: number): number {
  return 60 / (bpm * TIME_BASE);
}

function toNoteList(placed: PlacedNote[], offsetTicks: number): ChartNote[] {
  const notes = placed.flatMap((note) => toChartNotes(note, offsetTicks));

  notes.sort((first, second) => startTickOf(first) - startTickOf(second));
  notes.forEach((note, index) => {
    note.id = index;
  });

  return notes;
}

function startTickOf(note: ChartNote): number {
  if (note.nodes && note.nodes.length > 0) {
    return note.nodes[0].tick;
  }

  return note.tick!;
}

function toChartNotes(note: PlacedNote, offsetTicks: number): ChartNote[] {
  const tick = offsetTicks + note.slot * TICKS_PER_SLOT;

  if (note.kind === "drag") {
    return [dragNote(note, tick, offsetTicks)];
  }

  return [tapOrHoldNote(note, tick), ...chordNotes(note, tick)];
}

function tapOrHoldNote(note: PlacedNote, tick: number): ChartNote {
  return {
    type: NOTE_TYPE[note.kind],
    tick,
    x: note.x,
    duration: note.durationSlots * TICKS_PER_SLOT,
  };
}

function chordNotes(note: PlacedNote, tick: number): ChartNote[] {
  return note.chordX.map((x) => ({
    type: NOTE_TYPE.tap,
    tick,
    x,
    duration: 0,
  }));
}

function dragNote(note: PlacedNote, tick: number, offsetTicks: number): ChartNote {
  const head = { tick, x: note.x, duration: 0 };
  const tail = note.dragNodes.map((node) => ({
    tick: offsetTicks + node.slot * TICKS_PER_SLOT,
    x: node.x,
    duration: 0,
  }));

  return { type: NOTE_TYPE.drag, nodes: [head, ...tail] };
}

// ── Pages ───────────────────────────────────────────────────────────────────

/**
 * The lead-in page runs bottom to top so the scan line reaches the top exactly
 * on the first beat, where the first regular top to bottom page takes over.
 */
function buildPageList(grid: BeatGrid, durationSec: number): PageEntry[] {
  const ticksPerPage = TIME_BASE * BEATS_PER_PAGE;
  const totalTicks = Math.floor(durationSec / secondsPerTick(grid.bpm));
  const offsetTicks = offsetTicksOf(grid);
  const pages: PageEntry[] = [];

  if (offsetTicks > 0) {
    pages.push({ start_tick: 0, end_tick: offsetTicks, scan_line_direction: 1 });
  }

  return pages.concat(regularPages(offsetTicks, totalTicks, ticksPerPage));
}

function regularPages(fromTick: number, totalTicks: number, ticksPerPage: number): PageEntry[] {
  const pages: PageEntry[] = [];
  let direction = -1;

  for (let tick = fromTick; tick < totalTicks; tick += ticksPerPage) {
    pages.push({
      start_tick: tick,
      end_tick: tick + ticksPerPage,
      scan_line_direction: direction,
    });

    direction *= -1;
  }

  return pages;
}
