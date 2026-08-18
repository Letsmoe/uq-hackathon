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
// A sweep may run as slow as one node per beat. Anything sparser reads as
// separate notes joined by a line rather than as one gesture.
const MAX_DRAG_SPACING_SLOTS = SLOTS_PER_BEAT;
// Quantisation puts a node a slot either side of where the run wants it, which
// should not end the run.
const DRAG_SPACING_TOLERANCE_SLOTS = 1;
// A sweep is a phrase, not a whole section: past this it stops reading as one
// gesture and the hand has nowhere left to go.
const MAX_DRAG_NODES = 12;
const QUIET_SECTION_FLOOR = 0.2;
// Onset detection turns up the odd weak blip in a decay or a room tail. They
// are not hits a player can hear, so they never earn a note however much room
// the budget has left.
const MIN_ONSET_STRENGTH = 0.5;

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

  return limitHolds(buildEvents(chosen, spec, grid), spec);
}

/**
 * Plenty of music sustains, so anything that merely rings on qualifies as a
 * hold and a chart built on that alone comes out as a wall of them. Holds are
 * an accent: only the longest few in a section survive, and the rest go back to
 * being taps.
 */
function limitHolds(events: NoteEvent[], spec: DifficultySpec): NoteEvent[] {
  const allowance = Math.floor(events.length * spec.holdShare);
  const kept = new Set(longestHoldSlots(events, allowance));

  return events.map((event) => {
    if (event.kind !== "hold" || kept.has(event.slot)) {
      return event;
    }

    return { ...event, kind: "tap" as NoteKind, durationSlots: 0 };
  });
}

function longestHoldSlots(events: NoteEvent[], allowance: number): number[] {
  return events
    .filter((event) => event.kind === "hold")
    .sort((first, second) => second.durationSlots - first.durationSlots)
    .slice(0, allowance)
    .map((event) => event.slot);
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
    if (onset.strength < MIN_ONSET_STRENGTH) return false;

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
  const room: SelectionRoom = {
    minimumGapSlots: gapSlots(spec, grid),
    chords: Math.floor(noteBudget * spec.chordShare),
  };
  const chosen: SlotMap = new Map();
  let noteCount = 0;

  for (const onset of ranked) {
    if (noteCount >= noteBudget) break;
    if (!acceptOnset(chosen, onset, spec, room)) continue;

    noteCount++;
  }

  return chosen;
}

/** What selection has left to hand out, spent as it walks the ranked onsets. */
interface SelectionRoom {
  minimumGapSlots: number;
  chords: number;
}

function gapSlots(spec: DifficultySpec, grid: BeatGrid): number {
  const gapBeats = spec.minNoteIntervalSec / grid.beatPeriodSec;

  return Math.max(1, Math.round(gapBeats * SLOTS_PER_BEAT));
}

function acceptOnset(
  chosen: SlotMap,
  onset: GridOnset,
  spec: DifficultySpec,
  room: SelectionRoom,
): boolean {
  const slot = Math.round(onset.beatPosition * SLOTS_PER_BEAT);
  const existing = chosen.get(slot);

  if (existing) {
    return widenChord(existing, onset, spec, room);
  }

  if (hasNeighbourWithin(chosen, slot, room.minimumGapSlots)) {
    return false;
  }

  chosen.set(slot, [onset]);

  return true;
}

/**
 * Several registers landing together is the normal case in mixed music, so a
 * chart that chords every one of them is a wall of doubles with no run of
 * single notes long enough to sweep. Chords are an accent, and the onsets
 * arrive strongest first, so the allowance falls to the hardest hits of the
 * section. Turning one down leaves its place in the budget for another slot.
 */
function widenChord(
  existing: GridOnset[],
  onset: GridOnset,
  spec: DifficultySpec,
  room: SelectionRoom,
): boolean {
  if (existing.length >= spec.maxNotesPerTick) return false;
  if (existing.length === 1 && room.chords <= 0) return false;

  if (existing.length === 1) {
    room.chords--;
  }

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

/**
 * The trailing slots of a run become nodes of the drag its head builds, so they
 * raise no note of their own. The head is not consumed: it is the one slot that
 * still has an event to build.
 */
function collectConsumedSlots(dragRuns: Map<number, number[]>): Set<number> {
  const consumed = new Set<number>();

  for (const run of dragRuns.values()) {
    run.slice(1).forEach((slot) => consumed.add(slot));
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

  const room = { slots: Math.floor(slots.length * spec.dragShare) };
  let index = 0;

  while (index < slots.length) {
    index = takeRunAt(slots, index, chosen, spec, room, runs);
  }

  return runs;
}

/**
 * Sweeps are a texture the chart reaches for now and then. Left uncapped they
 * swallow every even run in the track and the player spends the song dragging
 * rather than hitting notes.
 */
function takeRunAt(
  slots: number[],
  start: number,
  chosen: SlotMap,
  spec: DifficultySpec,
  room: { slots: number },
  runs: Map<number, number[]>,
): number {
  const run = evenlySpacedRun(slots, start, chosen, spec);

  if (run.length < spec.minDragNotes || run.length > room.slots) {
    return start + 1;
  }

  room.slots -= run.length;
  runs.set(run[0], run);

  return start + run.length;
}

function evenlySpacedRun(
  slots: number[],
  start: number,
  chosen: SlotMap,
  spec: DifficultySpec,
): number[] {
  if (start + 1 >= slots.length || !carriesOneNote(chosen, slots[start], spec)) {
    return [slots[start]];
  }

  const spacing = slots[start + 1] - slots[start];

  if (spacing > MAX_DRAG_SPACING_SLOTS) {
    return [slots[start]];
  }

  return extendRun(slots, start, spacing, chosen, spec);
}

/** A slot that plays as one note can carry a sweep; a chord cannot. */
function carriesOneNote(chosen: SlotMap, slot: number, spec: DifficultySpec): boolean {
  return chordSizeFor(chosen.get(slot)!, spec) === 1;
}

function extendRun(
  slots: number[],
  start: number,
  spacing: number,
  chosen: SlotMap,
  spec: DifficultySpec,
): number[] {
  const run = [slots[start]];

  for (let index = start + 1; index < slots.length; index++) {
    if (run.length >= MAX_DRAG_NODES) break;
    if (!evenlyFollows(slots[index] - slots[index - 1], spacing)) break;
    if (!carriesOneNote(chosen, slots[index], spec)) break;

    run.push(slots[index]);
  }

  return run;
}

function evenlyFollows(gap: number, spacing: number): boolean {
  return Math.abs(gap - spacing) <= DRAG_SPACING_TOLERANCE_SLOTS;
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
