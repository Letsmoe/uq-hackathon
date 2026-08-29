export type JudgmentResult = 'perfect' | 'good' | 'bad' | 'miss';

/** Note kinds, numbered as the Cytus II chart format serialises them. */
export enum NoteType {
  Tap = 0,
  Flick = 1,
  Hold = 2,
  Chain = 3,
}

export interface RuntimeChainNode {
  tick: number;
  x: number;
  pixelX: number;
  pixelY: number;
  timeSeconds: number;
  judged: boolean;
}

export interface RuntimeNote {
  id: number;
  type: NoteType;
  tick: number;
  x: number;            // 0..1 normalized
  duration: number;     // ticks; 0 for taps/flicks
  nodes?: RuntimeChainNode[];
  pixelX: number;
  pixelY: number;
  endPixelY: number;    // for holds: where tail ends; equals pixelY otherwise
  timeSeconds: number;
  endTimeSeconds: number;
  hit: boolean;
  missed: boolean;
  holdActive: boolean;
  holdProgress: number;
  /** Timing grade of the hold's head press, banked until the tail completes. */
  holdHeadResult: JudgmentResult | null;
  chainNodeIdx: number; // next unjudged chain node index
}

// Judgment windows in seconds (matching Cytus II feel)
export const JUDGMENT_WINDOWS = {
  perfect: 0.08,
  good:    0.15,
  bad:     0.25,
} as const;

export const SCORE_TABLE: Record<JudgmentResult, number> = {
  perfect: 1000,
  good:    700,
  bad:     300,
  miss:    0,
};

export const TP_TABLE: Record<JudgmentResult, number> = {
  perfect: 1.0,
  good:    0.7,
  bad:     0.3,
  miss:    0.0,
};

export interface JudgmentEvent {
  noteId: number;
  noteType: NoteType;
  result: JudgmentResult;
  x: number;
  y: number;
}

export interface GameState {
  score: number;
  combo: number;
  maxCombo: number;
  tp: number;
  perfects: number;
  goods: number;
  bads: number;
  misses: number;
  elapsed: number;  // seconds since start
  scanY: number;    // 0..1
  running: boolean;
  paused: boolean;
  finished: boolean;
}

export function makeInitialState(): GameState {
  return {
    score: 0, combo: 0, maxCombo: 0, tp: 100,
    perfects: 0, goods: 0, bads: 0, misses: 0,
    elapsed: 0, scanY: 0,
    running: false, paused: false, finished: false,
  };
}
