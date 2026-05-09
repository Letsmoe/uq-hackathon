import type {
  RuntimeNote,
  GameState,
  JudgmentResult,
  JudgmentEvent,
} from "./types";
import { JUDGMENT_WINDOWS, SCORE_TABLE, TP_TABLE } from "./types";

export type JudgmentCallback = (event: JudgmentEvent) => void;

export class JudgmentSystem {
  private totalNotes: number;
  private tpSum: number = 0; // accumulated TP points

  constructor(
    private state: GameState,
    private onJudge: JudgmentCallback,
    totalNotes: number,
  ) {
    this.totalNotes = totalNotes;
  }

  // ── Called by InputHandler callbacks ─────────────────────────────────────

  /**
   * Judge a tap or swipe at the current scan time.
   * elapsed = ms from song start at moment of input
   */
  judgeNote(note: RuntimeNote, elapsed: number): JudgmentResult {
    if (note.hit || note.missed) return "miss";

    const offset = Math.abs(elapsed - note.time);
    const result = this.resultFromOffset(offset);

    note.hit = true;
    this.applyResult(result, note.pixelX, note.pixelY, note.id);
    return result;
  }

  /**
   * Begin a hold note. Full scoring happens on release (judgeHoldEnd).
   */
  judgeHoldStart(note: RuntimeNote, elapsed: number) {
    if (note.hit || note.missed) return;
    note.holdActive = true;
    note.holdProgress = 0;
  }

  /**
   * Update hold progress each frame. Returns true when hold completes.
   */
  updateHold(note: RuntimeNote, elapsed: number): boolean {
    if (!note.holdActive || !note.holdDuration) return false;

    const held = elapsed - note.time;
    note.holdProgress = Math.min(1, held / note.holdDuration);

    if (note.holdProgress >= 1) {
      note.holdActive = false;
      note.hit = true;
      this.applyResult("perfect", note.pixelX, note.pixelY, note.id);
      return true;
    }
    return false;
  }

  /**
   * Player released hold early.
   */
  judgeHoldEnd(note: RuntimeNote, elapsed: number) {
    if (!note.holdActive) return;
    note.holdActive = false;
    note.hit = true;

    // Score proportional to how long they held
    const result: JudgmentResult =
      note.holdProgress > 0.85
        ? "perfect"
        : note.holdProgress > 0.5
          ? "good"
          : "bad";

    this.applyResult(result, note.pixelX, note.pixelY, note.id);
  }

  // ── Miss detection (called each frame) ───────────────────────────────────

  checkMisses(notes: RuntimeNote[], elapsed: number) {
    for (const note of notes) {
      if (note.hit || note.missed) continue;

      const offset = elapsed - note.time;
      // Past the bad window and scan line has moved on
      if (offset > JUDGMENT_WINDOWS.bad + 50) {
        note.missed = true;
        this.applyResult("miss", note.pixelX, note.pixelY, note.id);
      }
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private resultFromOffset(ms: number): JudgmentResult {
    if (ms <= JUDGMENT_WINDOWS.perfect) return "perfect";
    if (ms <= JUDGMENT_WINDOWS.good) return "good";
    if (ms <= JUDGMENT_WINDOWS.bad) return "bad";
    return "miss";
  }

  private applyResult(
    result: JudgmentResult,
    x: number,
    y: number,
    noteId: number,
  ) {
    const s = this.state;

    if (result === "miss" || result === "bad") {
      s.combo = 0;
    } else {
      s.combo++;
      if (s.combo > s.maxCombo) s.maxCombo = s.combo;
    }

    // Combo multiplier caps at ×4
    const multi = Math.min(4, 1 + Math.floor(s.combo / 20) * 0.5);
    s.score += Math.round(SCORE_TABLE[result] * multi);

    // Tally
    if (result === "perfect") s.perfects++;
    else if (result === "good") s.goods++;
    else if (result === "bad") s.bads++;
    else s.misses++;

    // TP
    const judged = s.perfects + s.goods + s.bads + s.misses;
    this.tpSum += TP_TABLE[result];
    s.tp = parseFloat(((this.tpSum / judged) * 100).toFixed(2));

    this.onJudge({ noteId, result, x, y });
  }

  reset(totalNotes: number) {
    this.totalNotes = totalNotes;
    this.tpSum = 0;
  }
}
