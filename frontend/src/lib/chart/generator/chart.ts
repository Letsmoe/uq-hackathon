import type { Chart, ChartNote, PageEntry } from "../../game/chart";
import { NoteType } from "../../game/types";
import type { Section } from "../dsp/structure";
import type { BeatGrid } from "../dsp/tempo";
import type { AudioAnalysis } from "../analyze";
import { specForDifficulty, type Difficulty, type DifficultySpec } from "./difficulty";
import {
  newLayoutState,
  placedFits,
  placeEvents,
  rememberPlaced,
  type LayoutState,
  type PlacedNote,
} from "./layout";
import {
  holdClearanceSlots,
  selectEvents,
  MIN_HOLD_BEATS,
  SLOTS_PER_BEAT,
  type NoteKind,
  type SectionEvents,
} from "./select";
import { BEATS_PER_PAGE } from "./pageGeometry";

export { BEATS_PER_PAGE };

export const TIME_BASE = 480;
const TICKS_PER_SLOT = TIME_BASE / SLOTS_PER_BEAT;
const FALLBACK_BPM = 120;

const NOTE_TYPE_BY_KIND: Record<NoteKind, NoteType> = {
  tap: NoteType.Tap,
  hold: NoteType.Hold,
  drag: NoteType.Chain,
};

export function buildChart(analysis: AudioAnalysis, difficulty: Difficulty): Chart {
  if (!analysis.grid) {
    return emptyChart(analysis.durationSec);
  }

  const spec = specForDifficulty(difficulty);
  const placed = clampHoldTails(placeAllSections(analysis, difficulty), spec, analysis.grid);

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
    return replaySection(source, sectionEvents[sourceIndex].section, entry.section, grid, state);
  }

  return placeEvents(entry.events, spec, grid, state);
}

function replaySection(
  source: PlacedNote[],
  sourceSection: Section,
  section: Section,
  grid: BeatGrid,
  state: LayoutState,
): PlacedNote[] {
  const shiftBeats = section.startBeat - sourceSection.startBeat;
  const endSlot = section.endBeat * SLOTS_PER_BEAT;
  const shifted = source
    .map((note) => shiftNote(note, shiftBeats * SLOTS_PER_BEAT))
    .filter((note) => lastSlotOf(note) < endSlot);

  return keepFitting(shifted, grid, state);
}

/**
 * The replay is verbatim, so its opening can land on top of whatever the
 * previous section ended with. Those few notes are dropped rather than moved,
 * which would break the very repetition the replay exists for.
 */
function keepFitting(notes: PlacedNote[], grid: BeatGrid, state: LayoutState): PlacedNote[] {
  const kept: PlacedNote[] = [];

  for (const note of notes) {
    if (!placedFits(note, grid, state)) continue;

    rememberPlaced(note, grid, state);
    kept.push(note);
  }

  return kept;
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

/**
 * Note selection runs per section, so a hold at the end of one section cannot
 * see the first note of the next and a replayed section can land in front of a
 * different note than its source did. Tails are therefore trimmed once at the
 * end, where the whole chart is visible.
 */
function clampHoldTails(
  placed: PlacedNote[],
  spec: DifficultySpec,
  grid: BeatGrid,
): PlacedNote[] {
  const sorted = [...placed].sort((first, second) => first.slot - second.slot);
  const clearance = holdClearanceSlots(spec, grid);

  return sorted.map((note, index) => clampHold(note, sorted[index + 1], clearance));
}

function clampHold(note: PlacedNote, next: PlacedNote | undefined, clearance: number): PlacedNote {
  if (note.kind !== "hold" || !next) {
    return note;
  }

  const room = next.slot - note.slot - clearance;

  if (room < MIN_HOLD_BEATS * SLOTS_PER_BEAT) {
    return { ...note, kind: "tap", durationSlots: 0 };
  }

  return { ...note, durationSlots: Math.min(note.durationSlots, Math.floor(room)) };
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

  return note.xs.map((x, member) => memberNote(note, tick, x, member));
}

/**
 * Only the first member of a chord carries the hold; the rest are taps, since a
 * chord of holds would need one finger per member held at once.
 */
function memberNote(note: PlacedNote, tick: number, x: number, member: number): ChartNote {
  if (member > 0) {
    return { type: NoteType.Tap, tick, x, duration: 0 };
  }

  return {
    type: NOTE_TYPE_BY_KIND[note.kind],
    tick,
    x,
    duration: note.durationSlots * TICKS_PER_SLOT,
  };
}

function dragNote(note: PlacedNote, tick: number, offsetTicks: number): ChartNote {
  const head = { tick, x: note.xs[0], duration: 0 };
  const tail = note.dragNodes.map((node) => ({
    tick: offsetTicks + node.slot * TICKS_PER_SLOT,
    x: node.x,
    duration: 0,
  }));

  return { type: NoteType.Chain, nodes: [head, ...tail] };
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
