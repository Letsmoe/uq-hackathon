import { describe, expect, test } from "bun:test";
import {
  OPACITY_STOPS,
  metricsForStage,
  interpolateStops,
  cardShift,
  withEdgeResistance,
  clamp,
} from "../frontend/src/lib/components/carouselGeometry";

// A landscape stage on a laptop, and a short one where the cards have to give.
const WIDE = metricsForStage(1200, 500);
const SHORT = metricsForStage(1200, 200);

describe("metricsForStage", () => {
  test("sizes the centre card to the stage it was given", () => {
    expect(WIDE.centerSize).toBeGreaterThan(SHORT.centerSize);
  });

  test("never lets a card exceed the stage in either axis", () => {
    for (const width of [320, 800, 2400]) {
      for (const height of [180, 400, 1200]) {
        const metrics = metricsForStage(width, height);
        expect(metrics.centerSize).toBeLessThanOrEqual(height);
        expect(metrics.centerSize).toBeLessThanOrEqual(width);
      }
    }
  });

  test("stays usable when the stage has not been measured yet", () => {
    const metrics = metricsForStage(0, 0);
    expect(metrics.centerSize).toBeGreaterThan(0);
    expect(Number.isFinite(metrics.stepToAdjacent)).toBe(true);
  });

  test("caps the card so a huge stage does not produce a huge card", () => {
    const huge = metricsForStage(6000, 6000);
    expect(huge.centerSize).toBe(metricsForStage(9000, 9000).centerSize);
  });

  test("keeps neighbours clear of the centre card", () => {
    // A step shorter than half of each card would overlap them.
    const halves = WIDE.centerSize / 2 + (WIDE.centerSize * WIDE.scaleStops[1]) / 2;
    expect(WIDE.stepToAdjacent).toBeGreaterThan(halves);
  });

  test("scales every stop with the centre card", () => {
    expect(WIDE.scaleStops[0]).toBe(1);
    expect(WIDE.scaleStops[1]).toBeLessThan(1);
    expect(WIDE.scaleStops[2]).toBeLessThan(WIDE.scaleStops[1]);
    expect(WIDE.scaleStops).toEqual(SHORT.scaleStops);
  });
});

describe("interpolateStops", () => {
  test("returns the stop itself at whole distances", () => {
    expect(interpolateStops(0, OPACITY_STOPS)).toBe(1);
    expect(interpolateStops(1, OPACITY_STOPS)).toBeCloseTo(0.85);
    expect(interpolateStops(2, OPACITY_STOPS)).toBeCloseTo(0.45);
  });

  test("interpolates between neighbouring stops", () => {
    expect(interpolateStops(0.5, OPACITY_STOPS)).toBeCloseTo(0.925);
  });

  test("holds the last stop beyond the final one", () => {
    expect(interpolateStops(7, OPACITY_STOPS)).toBe(0.45);
  });

  test("never leaves the range spanned by the stops", () => {
    for (let distance = 0; distance <= 5; distance += 0.05) {
      const value = interpolateStops(distance, OPACITY_STOPS);
      expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeGreaterThanOrEqual(0.45);
    }
  });
});

describe("cardShift", () => {
  test("leaves the centre card where it is", () => {
    expect(cardShift(0, WIDE)).toBe(0);
  });

  test("places whole offsets at the designed steps", () => {
    expect(cardShift(1, WIDE)).toBeCloseTo(WIDE.stepToAdjacent);
    expect(cardShift(2, WIDE)).toBeCloseTo(WIDE.stepToAdjacent + WIDE.stepToFar);
  });

  test("is odd, so both sides mirror", () => {
    for (const offset of [0.4, 1, 1.7, 3, 6.2]) {
      expect(cardShift(-offset, WIDE)).toBeCloseTo(-cardShift(offset, WIDE));
    }
  });

  // A jump here would show up as cards teleporting mid-drag.
  test("is continuous across the piece boundaries", () => {
    for (const boundary of [1, 2]) {
      const before = cardShift(boundary - 1e-6, WIDE);
      const after = cardShift(boundary + 1e-6, WIDE);
      expect(Math.abs(after - before)).toBeLessThan(1e-3);
    }
  });

  test("moves monotonically away from the centre", () => {
    let previous = 0;
    for (let offset = 0.05; offset <= 8; offset += 0.05) {
      const shift = cardShift(offset, WIDE);
      expect(shift).toBeGreaterThan(previous);
      previous = shift;
    }
  });

  test("shifts further on a stage that fits bigger cards", () => {
    expect(cardShift(1, WIDE)).toBeGreaterThan(cardShift(1, SHORT));
  });
});

describe("withEdgeResistance", () => {
  const LAST = 4;
  const RESISTANCE = 0.35;

  test("passes positions inside the list through untouched", () => {
    expect(withEdgeResistance(0, LAST, RESISTANCE)).toBe(0);
    expect(withEdgeResistance(2.3, LAST, RESISTANCE)).toBe(2.3);
    expect(withEdgeResistance(LAST, LAST, RESISTANCE)).toBe(LAST);
  });

  test("damps travel past either end", () => {
    expect(withEdgeResistance(-2, LAST, RESISTANCE)).toBeCloseTo(-0.7);
    expect(withEdgeResistance(LAST + 2, LAST, RESISTANCE)).toBeCloseTo(
      LAST + 0.7,
    );
  });

  test("stays continuous at the ends", () => {
    expect(withEdgeResistance(-1e-9, LAST, RESISTANCE)).toBeCloseTo(0);
    expect(withEdgeResistance(LAST + 1e-9, LAST, RESISTANCE)).toBeCloseTo(LAST);
  });

  test("keeps a single-song list pinned at zero", () => {
    expect(withEdgeResistance(3, 0, RESISTANCE)).toBeCloseTo(1.05);
    expect(withEdgeResistance(0, 0, RESISTANCE)).toBe(0);
  });
});

describe("clamp", () => {
  test("bounds on both sides and passes the middle through", () => {
    expect(clamp(-3, 0, 5)).toBe(0);
    expect(clamp(9, 0, 5)).toBe(5);
    expect(clamp(2, 0, 5)).toBe(2);
  });
});
