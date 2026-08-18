import type { Voice } from "../dsp/onsets";
import type { Section } from "../dsp/structure";
import type { BeatGrid } from "../dsp/tempo";
import type { DifficultySpec } from "./difficulty";
import type { GridOnset } from "./quantize";

/** Every grid position is a whole number of twelfths, the common denominator of 1/3 and 1/4. */
export const SLOTS_PER_BEAT = 12;

const VOICE_PRIORITY: Record<Voice, number> = {
  low: 1,
  mid: 0.95,
  high: 0.8,
};

const SUBDIVISION_PRIORITY: Record<number, number> = {
  1: 1.15,
  2: 1,
  3: 0.85,
  4: 0.8,
};

export const MIN_HOLD_BEATS = 0.75;
const MAX_HOLD_BEATS = 4;

// A hold ties up a hand until it releases, and releasing then tapping again
// takes longer than tapping twice, so this floor applies at every difficulty.
// Without it back to back holds are unplayable at the faster settings.
export const HOLD_RELEASE_SEC = 0.18;
const MAX_DRAG_SPACING_SLOTS = SLOTS_PER_BEAT / 2;
const QUIET_SECTION_FLOOR = 0.2;

export type NoteKind = "tap" | "hold" | "drag";

export interface NoteEvent {
  slot: number;
  kind: NoteKind;
  voice: Voice;
  strength: number;
  pitchNorm: number;
  /** Hold length in slots; zero for taps and drags. */
  durationSlots: number;
  chordSize: number;
  /** Slot offsets of the drag's trailing nodes, relative to slot. */
  dragNodeSlots: number[];
  dragNodePitch: number[];
}

export interface SectionEvents {
  section: Section;
  events: NoteEvent[];
}

export function selectEvents(
  quantized: GridOnset[],
  sections: Section[],
  spec: DifficultySpec,
  grid: BeatGrid,
): SectionEvents[] {
  return sections.map((section) => ({
    section,
    events: selectSectionEvents(quantized, section, spec, grid),
  }));
}

function selectSectionEvents(
  quantized: GridOnset[],
  section: Section,
  spec: DifficultySpec,
  grid: BeatGrid,
): NoteEvent[] {
  const candidates = candidatesFor(quantized, section, spec);
  const noteBudget = budgetFor(section, spec, grid);
  const chosen = chooseSlots(rankByPriority(candidates), spec, grid, noteBudget);

  return buildEvents(chosen, spec, grid);
}

// ── Candidate filtering and ranking ─────────────────────────────────────────

function candidatesFor(
  quantized: GridOnset[],
  section: Section,
  spec: DifficultySpec,
): GridOnset[] {
  return quantized.filter((onset) => {
    if (onset.beatPosition < section.startBeat) return false;
    if (onset.beatPosition >= section.endBeat) return false;
    if (!spec.voices.includes(onset.voice)) return false;

    return spec.allowedSubdivisions.includes(onset.subdivision);
  });
}

/**
 * Ranking, rather than a hard density gate, is what keeps the chart both full
 * and under control: the loudest and most metrically important hits are taken
 * first and the budget simply runs out on the rest.
 */
function rankByPriority(candidates: GridOnset[]): GridOnset[] {
  return [...candidates].sort((first, second) => priorityOf(second) - priorityOf(first));
}

function priorityOf(onset: GridOnset): number {
  return (
    onset.strength *
    VOICE_PRIORITY[onset.voice] *
    onset.metricWeight *
    SUBDIVISION_PRIORITY[onset.subdivision]
  );
}

/** Quiet sections earn proportionally fewer notes, which is what shapes the build-up. */
function budgetFor(section: Section, spec: DifficultySpec, grid: BeatGrid): number {
  const beats = section.endBeat - section.startBeat;
  const seconds = beats * grid.beatPeriodSec;
  const densityScale = QUIET_SECTION_FLOOR + (1 - QUIET_SECTION_FLOOR) * section.intensity;

  return Math.round(seconds * spec.targetNotesPerSecond * densityScale);
}

// ── Slot selection ──────────────────────────────────────────────────────────

type SlotMap = Map<number, GridOnset[]>;

function chooseSlots(
  ranked: GridOnset[],
  spec: DifficultySpec,
  grid: BeatGrid,
  noteBudget: number,
): SlotMap {
  const minimumGapSlots = gapSlots(spec, grid);
  const chosen: SlotMap = new Map();
  let noteCount = 0;

  for (const onset of ranked) {
    if (noteCount >= noteBudget) break;
    if (!acceptOnset(chosen, onset, spec, minimumGapSlots)) continue;

    noteCount++;
  }

  return chosen;
}

function gapSlots(spec: DifficultySpec, grid: BeatGrid): number {
  const gapBeats = spec.minNoteIntervalSec / grid.beatPeriodSec;

  return Math.max(1, Math.round(gapBeats * SLOTS_PER_BEAT));
}

function acceptOnset(
  chosen: SlotMap,
  onset: GridOnset,
  spec: DifficultySpec,
  minimumGapSlots: number,
): boolean {
  const slot = Math.round(onset.beatPosition * SLOTS_PER_BEAT);
  const existing = chosen.get(slot);

  if (existing) {
    return widenChord(existing, onset, spec);
  }

  if (hasNeighbourWithin(chosen, slot, minimumGapSlots)) {
    return false;
  }

  chosen.set(slot, [onset]);

  return true;
}

function widenChord(existing: GridOnset[], onset: GridOnset, spec: DifficultySpec): boolean {
  if (existing.length >= spec.maxNotesPerTick) return false;

  existing.push(onset);

  return true;
}

/** Two taps closer than the difficulty's floor would fight for the same hand. */
function hasNeighbourWithin(chosen: SlotMap, slot: number, minimumGapSlots: number): boolean {
  for (let offset = 1; offset < minimumGapSlots; offset++) {
    if (chosen.has(slot - offset)) return true;
    if (chosen.has(slot + offset)) return true;
  }

  return false;
}

// ── Note kinds ──────────────────────────────────────────────────────────────

function buildEvents(chosen: SlotMap, spec: DifficultySpec, grid: BeatGrid): NoteEvent[] {
  const slots = [...chosen.keys()].sort((first, second) => first - second);
  const dragRuns = findDragRuns(slots, chosen, spec);

  return assembleEvents(slots, chosen, dragRuns, spec, grid);
}

function assembleEvents(
  slots: number[],
  chosen: SlotMap,
  dragRuns: Map<number, number[]>,
  spec: DifficultySpec,
  grid: BeatGrid,
): NoteEvent[] {
  const consumed = collectConsumedSlots(dragRuns);
  const events: NoteEvent[] = [];

  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];

    if (consumed.has(slot)) continue;

    events.push(buildEventAt(slot, index, slots, chosen, dragRuns, spec, grid));
  }

  return events;
}

function collectConsumedSlots(dragRuns: Map<number, number[]>): Set<number> {
  const consumed = new Set<number>();

  for (const run of dragRuns.values()) {
    run.forEach((slot) => consumed.add(slot));
  }

  return consumed;
}

function buildEventAt(
  slot: number,
  index: number,
  slots: number[],
  chosen: SlotMap,
  dragRuns: Map<number, number[]>,
  spec: DifficultySpec,
  grid: BeatGrid,
): NoteEvent {
  const run = dragRuns.get(slot);

  if (run) {
    return buildDragEvent(slot, run, chosen);
  }

  return buildTapOrHold(slot, slotAfter(slots, index), chosen, spec, grid);
}

function slotAfter(slots: number[], index: number): number {
  const next = slots[index + 1];

  if (next === undefined) {
    return Infinity;
  }

  return next;
}

function buildTapOrHold(
  slot: number,
  nextSlot: number,
  chosen: SlotMap,
  spec: DifficultySpec,
  grid: BeatGrid,
): NoteEvent {
  const onsets = chosen.get(slot)!;
  const leader = strongestOf(onsets);
  const base = baseEvent(slot, leader, chordSizeFor(onsets, spec));
  const durationSlots = holdLengthFor(leader, slot, nextSlot, spec, grid);

  if (durationSlots <= 0) {
    return base;
  }

  return { ...base, kind: "hold", durationSlots };
}

function baseEvent(slot: number, leader: GridOnset, chordSize: number): NoteEvent {
  return {
    slot,
    kind: "tap",
    voice: leader.voice,
    strength: leader.strength,
    pitchNorm: leader.pitchNorm,
    durationSlots: 0,
    chordSize,
    dragNodeSlots: [],
    dragNodePitch: [],
  };
}

function strongestOf(onsets: GridOnset[]): GridOnset {
  return onsets.reduce((best, onset) => {
    if (onset.strength <= best.strength) return best;

    return onset;
  });
}

/** Chords are reserved for moments where several registers hit together and hard. */
function chordSizeFor(onsets: GridOnset[], spec: DifficultySpec): number {
  const combined = onsets.reduce((total, onset) => total + onset.strength, 0);

  if (onsets.length < 2 || combined < spec.chordStrength) {
    return 1;
  }

  return Math.min(onsets.length, spec.maxNotesPerTick);
}

/**
 * A hold is only playable when the sound actually rings on and nothing else is
 * due before the tail ends, so both conditions gate it.
 */
function holdLengthFor(
  leader: GridOnset,
  slot: number,
  nextSlot: number,
  spec: DifficultySpec,
  grid: BeatGrid,
): number {
  if (!spec.allowHolds || leader.sustainBeats < MIN_HOLD_BEATS) {
    return 0;
  }

  const room = Math.min(
    leader.sustainBeats * SLOTS_PER_BEAT,
    MAX_HOLD_BEATS * SLOTS_PER_BEAT,
    nextSlot - slot - holdClearanceSlots(spec, grid),
  );

  if (room < MIN_HOLD_BEATS * SLOTS_PER_BEAT) {
    return 0;
  }

  return Math.round(room);
}

export function holdClearanceSlots(spec: DifficultySpec, grid: BeatGrid): number {
  const releaseSec = Math.max(HOLD_RELEASE_SEC, spec.minNoteIntervalSec);

  return (releaseSec / grid.beatPeriodSec) * SLOTS_PER_BEAT;
}

// ── Drags ───────────────────────────────────────────────────────────────────

/**
 * A run of evenly spaced single notes is what a player reads as a sweep, so it
 * becomes one drag rather than a wall of taps they have to hit individually.
 */
function findDragRuns(
  slots: number[],
  chosen: SlotMap,
  spec: DifficultySpec,
): Map<number, number[]> {
  const runs = new Map<number, number[]>();

  if (!spec.allowDrags) {
    return runs;
  }

  let index = 0;

  while (index < slots.length) {
    index = takeRunAt(slots, index, chosen, spec, runs);
  }

  return runs;
}

function takeRunAt(
  slots: number[],
  start: number,
  chosen: SlotMap,
  spec: DifficultySpec,
  runs: Map<number, number[]>,
): number {
  const run = evenlySpacedRun(slots, start, chosen);

  if (run.length < spec.minDragNotes) {
    return start + 1;
  }

  runs.set(run[0], run);

  return start + run.length;
}

function evenlySpacedRun(slots: number[], start: number, chosen: SlotMap): number[] {
  if (start + 1 >= slots.length || chosen.get(slots[start])!.length > 1) {
    return [slots[start]];
  }

  const spacing = slots[start + 1] - slots[start];

  if (spacing > MAX_DRAG_SPACING_SLOTS) {
    return [slots[start]];
  }

  return extendRun(slots, start, spacing, chosen);
}

function extendRun(
  slots: number[],
  start: number,
  spacing: number,
  chosen: SlotMap,
): number[] {
  const run = [slots[start]];

  for (let index = start + 1; index < slots.length; index++) {
    if (slots[index] - slots[index - 1] !== spacing) break;
    if (chosen.get(slots[index])!.length > 1) break;

    run.push(slots[index]);
  }

  return run;
}

function buildDragEvent(slot: number, run: number[], chosen: SlotMap): NoteEvent {
  const leader = strongestOf(chosen.get(slot)!);
  const trailing = run.slice(1);

  return {
    slot,
    kind: "drag",
    voice: leader.voice,
    strength: leader.strength,
    pitchNorm: leader.pitchNorm,
    durationSlots: 0,
    chordSize: 1,
    dragNodeSlots: trailing.map((nodeSlot) => nodeSlot - slot),
    dragNodePitch: trailing.map((nodeSlot) => strongestOf(chosen.get(nodeSlot)!).pitchNorm),
  };
}
