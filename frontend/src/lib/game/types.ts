// ─── Note types ───────────────────────────────────────────────────────────────

export type NoteType = "tap" | "hold" | "swipe";
export type SwipeDir = "left" | "right";
export type JudgmentResult = "perfect" | "good" | "bad" | "miss";

export interface ChartNote {
  id: number;
  type: NoteType;
  time: number; // ms: moment scan line crosses this note
  lane: number; // 0–7 horizontal lane
  swipeDir?: SwipeDir;
  holdDuration?: number; // ms, hold notes only
}

export interface RuntimeNote extends ChartNote {
  pixelX: number; // pre-computed pixel X
  pixelY: number; // pre-computed pixel Y
  sweepIndex: number; // which pass of the scan line
  hit: boolean;
  missed: boolean;
  holdActive: boolean; // finger currently held
  holdProgress: number; // 0–1 fill progress
}

// ─── Judgment ─────────────────────────────────────────────────────────────────

export interface JudgmentEvent {
  noteId: number;
  result: JudgmentResult;
  x: number;
  y: number;
}

export const JUDGMENT_WINDOWS: Record<
  Exclude<JudgmentResult, "miss">,
  number
> = {
  perfect: 40, // ±ms
  good: 90,
  bad: 160,
};

export const SCORE_TABLE: Record<JudgmentResult, number> = {
  perfect: 1000,
  good: 500,
  bad: 100,
  miss: 0,
};

export const TP_TABLE: Record<JudgmentResult, number> = {
  perfect: 1.0,
  good: 0.5,
  bad: 0.2,
  miss: 0.0,
};

// ─── Game state ───────────────────────────────────────────────────────────────

export interface GameState {
  score: number;
  combo: number;
  maxCombo: number;
  tp: number; // 0–100
  perfects: number;
  goods: number;
  bads: number;
  misses: number;
  elapsed: number; // ms since start
  scanY: number; // 0–1 normalised
  running: boolean;
  paused: boolean;
  finished: boolean;
}

export function makeInitialState(): GameState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    tp: 100,
    perfects: 0,
    goods: 0,
    bads: 0,
    misses: 0,
    elapsed: 0,
    scanY: 0,
    running: false,
    paused: false,
    finished: false,
  };
}
