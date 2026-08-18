import { describe, expect, test } from "bun:test";
import {
  CENTER_SIZE,
  ADJACENT_SIZE,
  FAR_SIZE,
  STEP_TO_ADJACENT,
  STEP_TO_FAR,
  SCALE_STOPS,
  interpolateStops,
  cardShift,
  withEdgeResistance,
  clamp,
} from "../frontend/src/lib/components/carouselGeometry";

// Every card is drawn in a CENTER_SIZE box and scaled, so a scale of 1 has to
// come out at the centre and the apparent sizes have to match the design.
describe("interpolateStops", () => {
  test("returns the stop itself at whole distances", () => {
    expect(interpolateStops(0, SCALE_STOPS) * CENTER_SIZE).toBeCloseTo(
      CENTER_SIZE,
    );
    expect(interpolateStops(1, SCALE_STOPS) * CENTER_SIZE).toBeCloseTo(
      ADJACENT_SIZE,
    );
    expect(interpolateStops(2, SCALE_STOPS) * CENTER_SIZE).toBeCloseTo(
      FAR_SIZE,
    );
  });

  test("interpolates between neighbouring stops", () => {
    const half = interpolateStops(0.5, SCALE_STOPS) * CENTER_SIZE;
    expect(half).toBeCloseTo((CENTER_SIZE + ADJACENT_SIZE) / 2);
  });

  test("holds the last stop beyond the final one", () => {
    expect(interpolateStops(7, SCALE_STOPS)).toBe(FAR_SIZE / CENTER_SIZE);
  });

  test("never leaves the range spanned by the stops", () => {
    const stops = [1, 0.85, 0.45];
    for (let distance = 0; distance <= 5; distance += 0.05) {
      const value = interpolateStops(distance, stops);
      expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeGreaterThanOrEqual(0.45);
    }
  });
});

describe("cardShift", () => {
  test("leaves the centre card where it is", () => {
    expect(cardShift(0)).toBe(0);
  });

  test("places whole offsets at the designed steps", () => {
    expect(cardShift(1)).toBeCloseTo(STEP_TO_ADJACENT);
    expect(cardShift(2)).toBeCloseTo(STEP_TO_ADJACENT + STEP_TO_FAR);
    expect(cardShift(3)).toBeCloseTo(
      STEP_TO_ADJACENT + STEP_TO_FAR + FAR_SIZE,
    );
  });

  test("is odd, so both sides mirror", () => {
    for (const offset of [0.4, 1, 1.7, 3, 6.2]) {
      expect(cardShift(-offset)).toBeCloseTo(-cardShift(offset));
    }
  });

  // A jump here would show up as cards teleporting mid-drag.
  test("is continuous across the piece boundaries", () => {
    for (const boundary of [1, 2]) {
      const before = cardShift(boundary - 1e-6);
      const after = cardShift(boundary + 1e-6);
      expect(Math.abs(after - before)).toBeLessThan(1e-3);
    }
  });

  test("moves monotonically away from the centre", () => {
    let previous = 0;
    for (let offset = 0.05; offset <= 8; offset += 0.05) {
      const shift = cardShift(offset);
      expect(shift).toBeGreaterThan(previous);
      previous = shift;
    }
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
