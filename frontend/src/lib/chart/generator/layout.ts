import type { Voice } from "../dsp/onsets";
import type { BeatGrid } from "../dsp/tempo";
import type { DifficultySpec } from "./difficulty";
import { SLOTS_PER_BEAT, type NoteEvent, type NoteKind } from "./select";

// Notes are drawn at x * screenWidth with a fixed pixel radius, so on the
// narrowest screen the game targets a note body spans about MIN_NOTE_GAP of the
// playfield. The margins keep a note body fully on screen.
const PLAYFIELD_MIN_X = 0.08;
const PLAYFIELD_MAX_X = 0.92;
const CHORD_GAP = 0.18;
const MIN_NOTE_GAP = 0.18;

// Time is the vertical axis: a note this far from another in time is already a
// note body away from it vertically and needs no horizontal clearance at all.
// In between the two bodies trace an ellipse, which is what requiredGap solves.
const OVERLAP_WINDOW_SEC = 0.24;

// Candidate anchors are tried outwards from the wanted position in these steps.
const NUDGE_STEP = 0.04;
const NUDGE_STEPS = 20;

/**
 * Each register gets its own stretch of the playfield, so the kick keeps coming
 * from one side and the hats from the other. Within its stretch a note's exact
 * position follows the pitch of the sound, which turns a rising melody into a
 * rising sweep across the screen.
 */
const VOICE_REGION: Record<Voice, { from: number; to: number }> = {
  low: { from: 0.1, to: 0.45 },
  mid: { from: 0.25, to: 0.75 },
  high: { from: 0.55, to: 0.9 },
};

const MIN_TRAVEL = 0.1;

// A slow sweep across bars keeps a repetitive section from parking in one spot
// without making any single step unpredictable.
const DRIFT_PERIOD_BARS = 8;
const DRIFT_AMPLITUDE = 0.12;
const SLOTS_PER_BAR = SLOTS_PER_BEAT * 4;

export interface DragNode {
  slot: number;
  x: number;
}

export interface PlacedNote {
  slot: number;
  kind: NoteKind;
  /** One x per member; a chord has several, everything else exactly one. */
  xs: number[];
  durationSlots: number;
  dragNodes: DragNode[];
}

/** A stretch of one lane that is already taken, in slots. */
interface Occupancy {
  fromSlot: number;
  toSlot: number;
  x: number;
}

interface SlotSpan {
  fromSlot: number;
  toSlot: number;
}

/** Placement carries across section boundaries so the hand never teleports. */
export interface LayoutState {
  previousX: number;
  previousSlot: number;
  occupied: Occupancy[];
}

export function newLayoutState(): LayoutState {
  return { previousX: 0.5, previousSlot: -SLOTS_PER_BAR, occupied: [] };
}

export function placeEvents(
  events: NoteEvent[],
  spec: DifficultySpec,
  grid: BeatGrid,
  state: LayoutState,
): PlacedNote[] {
  const placed: PlacedNote[] = [];

  for (const event of events) {
    const note = placeEvent(event, spec, grid, state);

    if (!note) continue;

    placed.push(note);
  }

  return placed;
}

export function rememberPlaced(note: PlacedNote, grid: BeatGrid, state: LayoutState): void {
  registerOccupancy(note, state);
  pruneOccupancy(note.slot, grid, state);

  state.previousX = restingX(note);
  state.previousSlot = endSlotOf(note);
}

/**
 * Returns null when the playfield has no room left around this moment. A note
 * drawn under another one cannot be read or hit, so dropping it is better than
 * placing it.
 */
function placeEvent(
  event: NoteEvent,
  spec: DifficultySpec,
  grid: BeatGrid,
  state: LayoutState,
): PlacedNote | null {
  const target = targetXFor(event.voice, event.pitchNorm, event.slot);
  const reachable = withinReach(target, event.slot, spec, grid, state);
  const anchor = avoidOverlap(reachable, event, grid, state);

  if (anchor === null) {
    return null;
  }

  const note = buildPlacedNote(event, anchor);

  rememberPlaced(note, grid, state);

  return note;
}

function buildPlacedNote(event: NoteEvent, anchor: number): PlacedNote {
  return {
    slot: event.slot,
    kind: event.kind,
    xs: spreadChord(anchor, event.chordSize),
    durationSlots: event.durationSlots,
    dragNodes: placeDragNodes(event, anchor),
  };
}

function targetXFor(voice: Voice, pitchNorm: number, slot: number): number {
  const region = VOICE_REGION[voice];
  const withinRegion = region.from + clamp01(pitchNorm) * (region.to - region.from);

  return clampToPlayfield(withinRegion + driftAt(slot));
}

/** Triangle wave over bars: predictable to read, but never static. */
function driftAt(slot: number): number {
  const bars = slot / SLOTS_PER_BAR;
  const phase = modulo(bars / DRIFT_PERIOD_BARS, 1);

  return (1 - 2 * Math.abs(2 * phase - 1)) * DRIFT_AMPLITUDE * 0.5;
}

/**
 * Caps how far the hand moves between notes. The allowance grows with the gap
 * since the last note ended, so a burst stays local, a note after a rest may
 * cross the field, and a note after a long hold is measured from the release.
 */
function withinReach(
  target: number,
  slot: number,
  spec: DifficultySpec,
  grid: BeatGrid,
  state: LayoutState,
): number {
  const gapSeconds = ((slot - state.previousSlot) / SLOTS_PER_BEAT) * grid.beatPeriodSec;
  const allowance = Math.max(MIN_TRAVEL, spec.handSpeedPerSecond * gapSeconds);
  const travel = target - state.previousX;

  if (Math.abs(travel) <= allowance) {
    return clampToPlayfield(target);
  }

  return clampToPlayfield(state.previousX + Math.sign(travel) * allowance);
}

// ── Overlap ─────────────────────────────────────────────────────────────────

/**
 * Two notes drawn on top of each other are unreadable and unhittable, so the
 * anchor moves to the nearest position that clears every note still on screen
 * around it. This overrides the reach budget, which is a comfort heuristic
 * rather than a correctness one.
 */
function avoidOverlap(
  anchor: number,
  event: NoteEvent,
  grid: BeatGrid,
  state: LayoutState,
): number | null {
  const span = { fromSlot: event.slot, toSlot: endSlotOfEvent(event) };
  const half = chordHalfWidth(event.chordSize);

  for (const candidate of candidateAnchors(anchor, event.chordSize)) {
    if (worstClearance(candidate, half, span, grid, state) >= 0) return candidate;
  }

  return null;
}

/**
 * Whether an already placed note still clears everything around it. A replayed
 * section keeps the notes of its source verbatim, so its first bar can land on
 * top of whatever the previous section ended with.
 */
export function placedFits(note: PlacedNote, grid: BeatGrid, state: LayoutState): boolean {
  const span = { fromSlot: note.slot, toSlot: endSlotOf(note) };

  return note.xs.every((x) => worstClearance(x, 0, span, grid, state) >= 0);
}

/** The wanted position first, then alternating outwards from it. */
function candidateAnchors(anchor: number, chordSize: number): number[] {
  const anchors = [clampAnchor(anchor, chordSize)];

  for (let step = 1; step <= NUDGE_STEPS; step++) {
    anchors.push(clampAnchor(anchor + step * NUDGE_STEP, chordSize));
    anchors.push(clampAnchor(anchor - step * NUDGE_STEP, chordSize));
  }

  return anchors;
}

/** Negative when some note already on screen sits too close to this position. */
function worstClearance(
  x: number,
  half: number,
  span: SlotSpan,
  grid: BeatGrid,
  state: LayoutState,
): number {
  let worst = Infinity;

  for (const taken of state.occupied) {
    const gapSec = timeGapSec(taken, span, grid);

    if (gapSec >= OVERLAP_WINDOW_SEC) continue;

    worst = Math.min(worst, Math.abs(taken.x - x) - half - requiredGap(gapSec));
  }

  return worst;
}

/** Seconds between two notes being on screen together; zero while they overlap in time. */
function timeGapSec(taken: Occupancy, span: SlotSpan, grid: BeatGrid): number {
  const slotGap = Math.max(0, taken.fromSlot - span.toSlot, span.fromSlot - taken.toSlot);

  return (slotGap / SLOTS_PER_BEAT) * grid.beatPeriodSec;
}

/**
 * Horizontal clearance two note bodies need at a given vertical separation.
 * Notes sharing a tick need the full gap; notes a whole window apart need none.
 */
function requiredGap(gapSec: number): number {
  const closeness = 1 - (gapSec / OVERLAP_WINDOW_SEC) * (gapSec / OVERLAP_WINDOW_SEC);

  return MIN_NOTE_GAP * Math.sqrt(Math.max(0, closeness));
}

function registerOccupancy(note: PlacedNote, state: LayoutState): void {
  const fromSlot = note.slot;
  const toSlot = endSlotOf(note);

  for (const x of note.xs) {
    state.occupied.push({ fromSlot, toSlot, x });
  }

  note.dragNodes.forEach((node) => {
    state.occupied.push({ fromSlot: node.slot, toSlot: node.slot, x: node.x });
  });
}

function pruneOccupancy(slot: number, grid: BeatGrid, state: LayoutState): void {
  const windowSlots = (OVERLAP_WINDOW_SEC / grid.beatPeriodSec) * SLOTS_PER_BEAT;

  state.occupied = state.occupied.filter((taken) => taken.toSlot >= slot - windowSlots * 2);
}

// ── Note geometry ───────────────────────────────────────────────────────────

function spreadChord(anchor: number, chordSize: number): number[] {
  const positions: number[] = [];

  for (let member = 0; member < chordSize; member++) {
    positions.push(clampToPlayfield(anchor + chordOffset(member, chordSize)));
  }

  return positions;
}

function chordOffset(member: number, chordSize: number): number {
  return (member - (chordSize - 1) / 2) * CHORD_GAP;
}

function chordHalfWidth(chordSize: number): number {
  return ((chordSize - 1) / 2) * CHORD_GAP;
}

/** Keeps the whole chord on screen rather than squashing its outer members. */
function clampAnchor(anchor: number, chordSize: number): number {
  const half = chordHalfWidth(chordSize);

  return Math.min(PLAYFIELD_MAX_X - half, Math.max(PLAYFIELD_MIN_X + half, anchor));
}

function placeDragNodes(event: NoteEvent, headX: number): DragNode[] {
  if (event.kind !== "drag") {
    return [];
  }

  const region = VOICE_REGION[event.voice];

  return event.dragNodeSlots.map((offset, index) => ({
    slot: event.slot + offset,
    x: dragNodeX(region, event.dragNodePitch[index], headX),
  }));
}

/** Drag nodes stay near the head so the sweep reads as one gesture. */
function dragNodeX(
  region: { from: number; to: number },
  pitchNorm: number,
  headX: number,
): number {
  const fromPitch = region.from + clamp01(pitchNorm) * (region.to - region.from);

  return clampToPlayfield(headX + (fromPitch - headX) * 0.6);
}

function endSlotOf(note: PlacedNote): number {
  if (note.dragNodes.length > 0) {
    return note.dragNodes[note.dragNodes.length - 1].slot;
  }

  return note.slot + note.durationSlots;
}

function endSlotOfEvent(event: NoteEvent): number {
  if (event.dragNodeSlots.length > 0) {
    return event.slot + event.dragNodeSlots[event.dragNodeSlots.length - 1];
  }

  return event.slot + event.durationSlots;
}

/** Where the hand ends up once the note is finished. */
function restingX(note: PlacedNote): number {
  if (note.dragNodes.length > 0) {
    return note.dragNodes[note.dragNodes.length - 1].x;
  }

  return note.xs[note.xs.length - 1];
}

function clampToPlayfield(x: number): number {
  return Math.min(PLAYFIELD_MAX_X, Math.max(PLAYFIELD_MIN_X, x));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
