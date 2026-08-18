// Geometry of the song carousel, in design pixels.
//
// Every card occupies a CENTER_SIZE box and is scaled down to its apparent
// size, so the stage animates transforms only and never touches layout. All
// of it is a function of one continuous position in song indexes, which is
// what lets a drag pass through the same states the spring settles into.

export const CENTER_SIZE = 320;
export const ADJACENT_SIZE = 230;
export const FAR_SIZE = 150;

export const STAGE_HEIGHT = CENTER_SIZE + 20;
export const STEP_TO_ADJACENT = CENTER_SIZE / 2 + ADJACENT_SIZE / 2 + 30;
export const STEP_TO_FAR = ADJACENT_SIZE / 2 + FAR_SIZE / 2 + 24;

export const SCALE_STOPS = [
  1,
  ADJACENT_SIZE / CENTER_SIZE,
  FAR_SIZE / CENTER_SIZE,
];
export const OPACITY_STOPS = [1, 0.85, 0.45];
// Stands in for a brightness/grayscale filter on the cover: an overlay's
// opacity composites, a filter re-rasterises the image every frame.
export const DIM_STOPS = [0, 0.45, 0.62];

/** Reads `stops` as values at whole-card distances, interpolating between
 *  them and holding the last one from there on. */
export function interpolateStops(distance: number, stops: number[]): number {
  const top = stops.length - 1;
  if (distance >= top) {
    return stops[top];
  }
  const lower = Math.floor(distance);
  const fraction = distance - lower;
  return stops[lower] + (stops[lower + 1] - stops[lower]) * fraction;
}

/** Horizontal displacement of a card sitting `offset` songs from the centre.
 *  Odd and continuous, so a fractional offset lands between the two states it
 *  sits between. */
export function cardShift(offset: number): number {
  const distance = Math.abs(offset);
  const direction = Math.sign(offset);
  if (distance <= 1) {
    return direction * distance * STEP_TO_ADJACENT;
  }
  if (distance <= 2) {
    return direction * (STEP_TO_ADJACENT + (distance - 1) * STEP_TO_FAR);
  }
  return (
    direction * (STEP_TO_ADJACENT + STEP_TO_FAR + (distance - 2) * FAR_SIZE)
  );
}

/** Lets the stage keep following a drag past the first or last song, at a
 *  fraction of the travel, so the ends push back instead of stopping dead. */
export function withEdgeResistance(
  index: number,
  lastIndex: number,
  resistance: number,
): number {
  if (index < 0) {
    return index * resistance;
  }
  if (index > lastIndex) {
    return lastIndex + (index - lastIndex) * resistance;
  }
  return index;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
