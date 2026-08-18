// Geometry of the song carousel.
//
// Sizes are derived from the stage the carousel was given rather than authored
// against a fixed design resolution, so the cards fill whatever viewport they
// land in. Every card occupies a `centerSize` box and is scaled down to its
// apparent size, so the stage animates transforms only and never touches
// layout. All of it is a function of one continuous position in song indexes,
// which is what lets a drag pass through the same states the spring settles
// into.

/** Apparent size of a card, as a fraction of the centre card. */
const ADJACENT_RATIO = 0.71;
const FAR_RATIO = 0.47;

/** Gap between neighbouring cards, as a fraction of the centre card. */
const ADJACENT_GAP_RATIO = 0.09;
const FAR_GAP_RATIO = 0.07;

/** Share of the stage a centre card may claim in each axis. */
const HEIGHT_SHARE = 0.96;
const WIDTH_SHARE = 0.34;

const MIN_CENTER_SIZE = 140;
const MAX_CENTER_SIZE = 560;

export type CarouselMetrics = {
  centerSize: number;
  stepToAdjacent: number;
  stepToFar: number;
  scaleStops: number[];
};

export const OPACITY_STOPS = [1, 0.85, 0.45];
// Stands in for a brightness/grayscale filter on the cover: an overlay's
// opacity composites, a filter re-rasterises the image every frame.
export const DIM_STOPS = [0, 0.45, 0.62];

/** Sizes the cards to the stage. Width matters as well as height: a wide short
 *  stage would otherwise hand the neighbours more room than it has. */
export function metricsForStage(
  stageWidth: number,
  stageHeight: number,
): CarouselMetrics {
  const centerSize = clamp(
    Math.min(stageHeight * HEIGHT_SHARE, stageWidth * WIDTH_SHARE),
    MIN_CENTER_SIZE,
    MAX_CENTER_SIZE,
  );
  const adjacentSize = centerSize * ADJACENT_RATIO;
  const farSize = centerSize * FAR_RATIO;

  return {
    centerSize,
    stepToAdjacent:
      centerSize / 2 + adjacentSize / 2 + centerSize * ADJACENT_GAP_RATIO,
    stepToFar: adjacentSize / 2 + farSize / 2 + centerSize * FAR_GAP_RATIO,
    scaleStops: [1, ADJACENT_RATIO, FAR_RATIO],
  };
}

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
export function cardShift(offset: number, metrics: CarouselMetrics): number {
  const distance = Math.abs(offset);
  const direction = Math.sign(offset);
  const { stepToAdjacent, stepToFar, centerSize } = metrics;
  if (distance <= 1) {
    return direction * distance * stepToAdjacent;
  }
  if (distance <= 2) {
    return direction * (stepToAdjacent + (distance - 1) * stepToFar);
  }
  const farSize = centerSize * FAR_RATIO;
  return direction * (stepToAdjacent + stepToFar + (distance - 2) * farSize);
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
