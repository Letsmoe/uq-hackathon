import { SLOTS_PER_BEAT } from "./select";

export const BEATS_PER_PAGE = 4;
export const SLOTS_PER_PAGE = SLOTS_PER_BEAT * BEATS_PER_PAGE;

/**
 * Where the scan line stands when it reaches a slot: 0 is the top edge of the
 * playfield, 1 the bottom. Notes are static and the beam sweeps, so this is
 * also where the note is drawn, and two notes sharing a y are drawn on top of
 * each other however far apart in time they are.
 *
 * Pages alternate direction, which means the beam folds back at every page
 * boundary. Time is therefore not a proxy for distance up the screen: two
 * notes either side of a fold are seconds apart and at the very same height.
 */
export function scanYAt(slot: number): number {
  const page = Math.floor(slot / SLOTS_PER_PAGE);
  const phase = (slot - page * SLOTS_PER_PAGE) / SLOTS_PER_PAGE;

  if (runsDownward(page)) {
    return phase;
  }

  return 1 - phase;
}

export interface ScanYRange {
  from: number;
  to: number;
}

/** The band of playfield a note covers; a hold tail may run through a fold. */
export function scanYRange(fromSlot: number, toSlot: number): ScanYRange {
  const start = scanYAt(fromSlot);
  const end = scanYAt(toSlot);
  const edges = foldEdgesBetween(fromSlot, toSlot);

  return {
    from: Math.min(start, end, ...edges),
    to: Math.max(start, end, ...edges),
  };
}

/** Distance between two bands, zero once they touch. */
export function scanYGap(first: ScanYRange, second: ScanYRange): number {
  return Math.max(0, first.from - second.to, second.from - first.to);
}

/**
 * The extremes a span reaches are the fold points it passes, and a fold is
 * always an edge of the playfield.
 */
function foldEdgesBetween(fromSlot: number, toSlot: number): number[] {
  const firstPage = Math.floor(fromSlot / SLOTS_PER_PAGE);
  const lastPage = Math.floor(toSlot / SLOTS_PER_PAGE);

  if (lastPage <= firstPage) {
    return [];
  }

  if (lastPage - firstPage > 1) {
    return [0, 1];
  }

  if (runsDownward(firstPage)) {
    return [1];
  }

  return [0];
}

function runsDownward(page: number): boolean {
  return ((page % 2) + 2) % 2 === 0;
}
