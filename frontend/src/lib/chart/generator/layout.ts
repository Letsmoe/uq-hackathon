import type { Voice } from "../dsp/onsets";
import type { BeatGrid } from "../dsp/tempo";
import type { DifficultySpec } from "./difficulty";
import { SLOTS_PER_BEAT, type NoteEvent, type NoteKind } from "./select";

// Notes are drawn at x * screenWidth, so the outer margins keep the note
// graphics fully on screen.
const PLAYFIELD_MIN_X = 0.08;
const PLAYFIELD_MAX_X = 0.92;

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

const CHORD_GAP = 0.14;
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
  x: number;
  /** Extra x positions for the other members of a chord. */
  chordX: number[];
  durationSlots: number;
  dragNodes: DragNode[];
}

/** Placement carries across section boundaries so the hand never teleports. */
export interface LayoutState {
  previousX: number;
  previousSlot: number;
}

export function newLayoutState(): LayoutState {
  return { previousX: 0.5, previousSlot: -SLOTS_PER_BAR };
}

export function placeEvents(
  events: NoteEvent[],
  spec: DifficultySpec,
  grid: BeatGrid,
  state: LayoutState,
): PlacedNote[] {
  return events.map((event) => placeEvent(event, spec, grid, state));
}

function placeEvent(
  event: NoteEvent,
  spec: DifficultySpec,
  grid: BeatGrid,
  state: LayoutState,
): PlacedNote {
  const target = targetXFor(event.voice, event.pitchNorm, event.slot);
  const x = withinReach(target, event.slot, spec, grid, state);

  state.previousX = x;
  state.previousSlot = event.slot;

  return {
    slot: event.slot,
    kind: event.kind,
    x,
    chordX: spreadChord(x, event.chordSize),
    durationSlots: event.durationSlots,
    dragNodes: placeDragNodes(event, x),
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
 * since the last note, so a burst stays local and a note after a rest may cross
 * the field.
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

function spreadChord(x: number, chordSize: number): number[] {
  const extras: number[] = [];

  for (let member = 1; member < chordSize; member++) {
    extras.push(chordMemberX(x, member, chordSize));
  }

  return extras;
}

function chordMemberX(x: number, member: number, chordSize: number): number {
  const centeredIndex = member - (chordSize - 1) / 2;
  const spread = centeredIndex * CHORD_GAP;

  return clampToPlayfield(x + spread);
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
