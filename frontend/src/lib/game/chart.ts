import type { ChartNote } from "./types";

export interface Chart {
  title: string;
  artist: string;
  bpm: number;
  sweepDuration: number; // ms for one full top→bottom (or bottom→top) pass
  totalDuration: number; // ms
  notes: ChartNote[];
}

// ─── Sample chart: Stardust ───────────────────────────────────────────────────
// sweepDuration = 2000ms  →  scan line travels full height in 2 s
// Notes are placed at times that correspond to scan line positions

export const STARDUST: Chart = {
  title: "Stardust",
  artist: "Nhato",
  bpm: 138,
  sweepDuration: 2000,
  totalDuration: 16000,
  notes: [
    // ── Sweep 0  (0 – 2000 ms, top → bottom) ─────────────────────────────
    { id: 0, type: "tap", time: 300, lane: 1 },
    { id: 1, type: "tap", time: 700, lane: 6 },
    { id: 2, type: "tap", time: 1000, lane: 3 },
    { id: 3, type: "tap", time: 1400, lane: 5 },
    { id: 4, type: "hold", time: 1700, lane: 2, holdDuration: 500 },

    // ── Sweep 1  (2000 – 4000 ms, bottom → top) ──────────────────────────
    { id: 5, type: "tap", time: 2200, lane: 4 },
    { id: 6, type: "swipe", time: 2500, lane: 1, swipeDir: "right" },
    { id: 7, type: "tap", time: 2900, lane: 6 },
    { id: 8, type: "tap", time: 3200, lane: 2 },
    { id: 9, type: "swipe", time: 3600, lane: 5, swipeDir: "left" },
    { id: 10, type: "tap", time: 3900, lane: 0 },

    // ── Sweep 2  (4000 – 6000 ms, top → bottom) ──────────────────────────
    { id: 11, type: "tap", time: 4200, lane: 7 },
    { id: 12, type: "tap", time: 4500, lane: 3 },
    { id: 13, type: "hold", time: 4900, lane: 1, holdDuration: 700 },
    { id: 14, type: "tap", time: 5300, lane: 5 },
    { id: 15, type: "swipe", time: 5700, lane: 4, swipeDir: "right" },

    // ── Sweep 3  (6000 – 8000 ms, bottom → top) ──────────────────────────
    { id: 16, type: "tap", time: 6100, lane: 2 },
    { id: 17, type: "tap", time: 6400, lane: 6 },
    { id: 18, type: "hold", time: 6800, lane: 3, holdDuration: 600 },
    { id: 19, type: "tap", time: 7200, lane: 0 },
    { id: 20, type: "swipe", time: 7600, lane: 5, swipeDir: "left" },

    // ── Sweep 4  (8000 – 10000 ms) ───────────────────────────────────────
    { id: 21, type: "tap", time: 8200, lane: 1 },
    { id: 22, type: "tap", time: 8400, lane: 4 },
    { id: 23, type: "tap", time: 8600, lane: 7 },
    { id: 24, type: "hold", time: 9000, lane: 2, holdDuration: 800 },
    { id: 25, type: "tap", time: 9500, lane: 6 },
    { id: 26, type: "tap", time: 9800, lane: 3 },

    // ── Sweep 5–7: denser patterns ───────────────────────────────────────
    { id: 27, type: "tap", time: 10100, lane: 0 },
    { id: 28, type: "tap", time: 10300, lane: 7 },
    { id: 29, type: "swipe", time: 10600, lane: 3, swipeDir: "right" },
    { id: 30, type: "tap", time: 10900, lane: 5 },
    { id: 31, type: "tap", time: 11200, lane: 2 },
    { id: 32, type: "hold", time: 11600, lane: 4, holdDuration: 900 },
    { id: 33, type: "tap", time: 12100, lane: 1 },
    { id: 34, type: "tap", time: 12400, lane: 6 },
    { id: 35, type: "swipe", time: 12700, lane: 0, swipeDir: "left" },
    { id: 36, type: "tap", time: 13000, lane: 3 },
    { id: 37, type: "tap", time: 13300, lane: 5 },
    { id: 38, type: "hold", time: 13700, lane: 2, holdDuration: 600 },
    { id: 39, type: "tap", time: 14200, lane: 7 },
    { id: 40, type: "tap", time: 14500, lane: 1 },
    { id: 41, type: "swipe", time: 14800, lane: 4, swipeDir: "right" },
    { id: 42, type: "tap", time: 15200, lane: 0 },
    { id: 43, type: "tap", time: 15500, lane: 6 },
    { id: 44, type: "tap", time: 15800, lane: 3 },
  ],
};
