import type { Voice } from "../dsp/onsets";
import type { BeatGrid } from "../dsp/tempo";
import type { DifficultySpec } from "./difficulty";
import { SLOTS_PER_BEAT, type NoteEvent, type NoteKind } from "./select";
import { scanYGap, scanYRange, type ScanYRange } from "./pageGeometry";

// Notes are drawn at x * screenWidth with a fixed pixel radius, so on the
// narrowest screen the game targets a note body spans about MIN_NOTE_GAP of the
// playfield. The margins keep a note body fully on screen.
const PLAYFIELD_MIN_X = 0.08;
const PLAYFIELD_MAX_X = 0.92;
// Half-widths of what gets drawn, as a share of the playfield. Two things
// clear each other once they are the sum of their half-widths apart, so two
// note bodies need a full body between them and a hold tail, being a narrow
// slab, needs much less.
const NOTE_HALF_WIDTH = 0.1;
const HOLD_TAIL_HALF_WIDTH = 0.03;
// Drag nodes are drawn smaller than a tap, so they clear their neighbours at a
// smaller distance. Nodes of the same drag are one gesture and are exempt from
// each other.
const CHAIN_HALF_WIDTH = NOTE_HALF_WIDTH * 0.62;

// Members of a chord are drawn at the same height, so they need the same
// clearance from each other as any other pair of bodies.
const CHORD_GAP = NOTE_HALF_WIDTH * 2;

// A note body and its shadow stand about this tall, as a share of the
// playfield. Two notes closer than this vertically need horizontal clearance;
// in between, the two bodies trace an ellipse, which is what requiredGap solves.
const NOTE_HEIGHT = 0.17;

// Seconds a note is on screen around its own hit time. Two notes further apart
// than this never share the screen, so they may sit at the same height.
const CO_VISIBLE_SEC = 1.3;

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

/** A patch of playfield that is already taken. */
interface Occupancy {
  fromSlot: number;
  toSlot: number;
  scanY: ScanYRange;
  x: number;
  halfWidth: number;
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

  const note = buildPlacedNote(event, anchor, grid, state);

  if (!note) {
    return null;
  }

  rememberPlaced(note, grid, state);

  return note;
}

function buildPlacedNote(
  event: NoteEvent,
  anchor: number,
  grid: BeatGrid,
  state: LayoutState,
): PlacedNote | null {
  const dragNodes = placeDragNodes(event, anchor, grid, state);

  if (!dragNodes) {
    return null;
  }

  return {
    slot: event.slot,
    kind: event.kind,
    xs: spreadChord(anchor, event.chordSize),
    durationSlots: event.durationSlots,
    dragNodes,
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
    if (worstClearance(candidate, half, span, NOTE_HALF_WIDTH, grid, state) >= 0) {
      return candidate;
    }
  }

  return null;
}

/** The nearest position at which one drawn thing clears everything around it. */
function clearPosition(
  wanted: number,
  slot: number,
  halfWidth: number,
  grid: BeatGrid,
  state: LayoutState,
): number | null {
  const span = { fromSlot: slot, toSlot: slot };

  for (const candidate of candidateAnchors(wanted, 1)) {
    if (worstClearance(candidate, 0, span, halfWidth, grid, state) >= 0) {
      return candidate;
    }
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
  const bodiesFit = note.xs.every(
    (x) => worstClearance(x, 0, span, NOTE_HALF_WIDTH, grid, state) >= 0,
  );

  if (!bodiesFit) {
    return false;
  }

  return note.dragNodes.every((node) => nodeFits(node, grid, state));
}

function nodeFits(node: DragNode, grid: BeatGrid, state: LayoutState): boolean {
  const span = { fromSlot: node.slot, toSlot: node.slot };

  return worstClearance(node.x, 0, span, CHAIN_HALF_WIDTH, grid, state) >= 0;
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
  halfWidth: number,
  grid: BeatGrid,
  state: LayoutState,
): number {
  const scanY = scanYRange(span.fromSlot, span.toSlot);
  let worst = Infinity;

  for (const taken of state.occupied) {
    if (!sharesTheScreen(taken, span, grid)) continue;

    const heightGap = scanYGap(taken.scanY, scanY);

    if (heightGap >= NOTE_HEIGHT) continue;

    worst = Math.min(worst, Math.abs(taken.x - x) - half - requiredGap(heightGap, halfWidth, taken));
  }

  return worst;
}

function sharesTheScreen(taken: Occupancy, span: SlotSpan, grid: BeatGrid): boolean {
  const slotGap = Math.max(0, taken.fromSlot - span.toSlot, span.fromSlot - taken.toSlot);

  return (slotGap / SLOTS_PER_BEAT) * grid.beatPeriodSec < CO_VISIBLE_SEC;
}

/**
 * Horizontal clearance a note needs from something already drawn, at a given
 * vertical separation. Level with it they must be a full pair of half-widths
 * apart; a note body's height above it they may share an x.
 */
function requiredGap(heightGap: number, halfWidth: number, taken: Occupancy): number {
  const closeness = 1 - (heightGap / NOTE_HEIGHT) * (heightGap / NOTE_HEIGHT);

  return (halfWidth + taken.halfWidth) * Math.sqrt(Math.max(0, closeness));
}

/**
 * A note claims a body-sized patch where it sits. A hold claims that patch too,
 * plus the narrow slab its tail runs down.
 */
function registerOccupancy(note: PlacedNote, state: LayoutState): void {
  const headY = scanYRange(note.slot, note.slot);

  for (const x of note.xs) {
    state.occupied.push({
      fromSlot: note.slot,
      toSlot: note.slot,
      scanY: headY,
      x,
      halfWidth: NOTE_HALF_WIDTH,
    });
  }

  registerHoldTail(note, state);

  note.dragNodes.forEach((node) => {
    state.occupied.push({
      fromSlot: node.slot,
      toSlot: node.slot,
      scanY: scanYRange(node.slot, node.slot),
      x: node.x,
      halfWidth: CHAIN_HALF_WIDTH,
    });
  });
}

function registerHoldTail(note: PlacedNote, state: LayoutState): void {
  if (note.durationSlots <= 0) {
    return;
  }

  const endSlot = note.slot + note.durationSlots;

  state.occupied.push({
    fromSlot: note.slot,
    toSlot: endSlot,
    scanY: scanYRange(note.slot, endSlot),
    x: note.xs[0],
    halfWidth: HOLD_TAIL_HALF_WIDTH,
  });
}

function pruneOccupancy(slot: number, grid: BeatGrid, state: LayoutState): void {
  const windowSlots = (CO_VISIBLE_SEC / grid.beatPeriodSec) * SLOTS_PER_BEAT;

  state.occupied = state.occupied.filter((taken) => taken.toSlot >= slot - windowSlots);
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

/**
 * Returns null when a node has nowhere clear to go. The sweep is one gesture,
 * so a chart with a node buried under another note is worse than no sweep.
 */
function placeDragNodes(
  event: NoteEvent,
  headX: number,
  grid: BeatGrid,
  state: LayoutState,
): DragNode[] | null {
  if (event.kind !== "drag") {
    return [];
  }

  const region = VOICE_REGION[event.voice];
  const nodes: DragNode[] = [];

  for (let index = 0; index < event.dragNodeSlots.length; index++) {
    const node = placeDragNode(event, index, region, headX, grid, state);

    if (!node) return null;

    nodes.push(node);
  }

  return nodes;
}

function placeDragNode(
  event: NoteEvent,
  index: number,
  region: { from: number; to: number },
  headX: number,
  grid: BeatGrid,
  state: LayoutState,
): DragNode | null {
  const slot = event.slot + event.dragNodeSlots[index];
  const wanted = dragNodeX(region, event.dragNodePitch[index], headX);
  const x = clearPosition(wanted, slot, CHAIN_HALF_WIDTH, grid, state);

  if (x === null) {
    return null;
  }

  return { slot, x };
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
