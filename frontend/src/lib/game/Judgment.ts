import type { RuntimeNote, RuntimeChainNode, GameState, JudgmentResult, JudgmentEvent } from './types';
import { JUDGMENT_WINDOWS, SCORE_TABLE, TP_TABLE } from './types';

export type JudgmentCallback = (event: JudgmentEvent) => void;

export class JudgmentSystem {
  private tpSum = 0;

  constructor(
    private state: GameState,
    private onJudge: JudgmentCallback,
  ) {}

  judgeNote(note: RuntimeNote, elapsed: number): JudgmentResult {
    if (note.hit || note.missed) return 'miss';
    const result = this.resultFromOffset(Math.abs(elapsed - note.timeSeconds));
    note.hit = true;
    this.applyResult(result, note.pixelX, note.pixelY, note.id);
    return result;
  }

  judgeChainNode(note: RuntimeNote, elapsed: number): boolean {
    if (!note.nodes || note.chainNodeIdx >= note.nodes.length) return false;
    const nd = note.nodes[note.chainNodeIdx];
    if (nd.judged) return false;
    const result = this.resultFromOffset(Math.abs(elapsed - nd.timeSeconds));
    if (result === 'miss') return false;
    nd.judged = true;
    note.chainNodeIdx++;
    this.applyResult(result, nd.pixelX, nd.pixelY, note.id);
    if (note.chainNodeIdx >= note.nodes.length) note.hit = true;
    return true;
  }

  judgeHoldStart(note: RuntimeNote, elapsed: number) {
    if (note.hit || note.missed || note.holdActive) return;
    const result = this.resultFromOffset(Math.abs(elapsed - note.timeSeconds));
    if (result === 'miss') return;
    note.holdActive = true;
    note.holdProgress = 0;
    this.applyResult(result, note.pixelX, note.pixelY, note.id);
  }

  updateHold(note: RuntimeNote, elapsed: number): boolean {
    if (!note.holdActive) return false;
    const dur = note.endTimeSeconds - note.timeSeconds;
    note.holdProgress = Math.min(1, (elapsed - note.timeSeconds) / dur);
    if (note.holdProgress >= 1) {
      note.holdActive = false;
      note.hit = true;
      return true;
    }
    return false;
  }

  judgeHoldEnd(note: RuntimeNote) {
    if (!note.holdActive) return;
    note.holdActive = false;
    note.hit = true;
  }

  checkMisses(notes: RuntimeNote[], elapsed: number) {
    for (const note of notes) {
      if (note.hit || note.missed) continue;

      if (note.type === 3) {
        if (!note.nodes) continue;
        const nd = note.nodes[note.chainNodeIdx];
        if (!nd || nd.judged) continue;
        if (elapsed > nd.timeSeconds + JUDGMENT_WINDOWS.bad) {
          nd.judged = true;
          note.chainNodeIdx++;
          this.applyResult('miss', nd.pixelX, nd.pixelY, note.id);
          if (note.chainNodeIdx >= note.nodes.length) note.hit = true;
        }
      } else if (note.type === 2) {
        if (!note.holdActive && elapsed > note.timeSeconds + JUDGMENT_WINDOWS.bad) {
          note.missed = true;
          this.applyResult('miss', note.pixelX, note.pixelY, note.id);
        }
      } else {
        if (elapsed > note.timeSeconds + JUDGMENT_WINDOWS.bad) {
          note.missed = true;
          this.applyResult('miss', note.pixelX, note.pixelY, note.id);
        }
      }
    }
  }

  private resultFromOffset(s: number): JudgmentResult {
    if (s <= JUDGMENT_WINDOWS.perfect) return 'perfect';
    if (s <= JUDGMENT_WINDOWS.good)    return 'good';
    if (s <= JUDGMENT_WINDOWS.bad)     return 'bad';
    return 'miss';
  }

  private applyResult(result: JudgmentResult, x: number, y: number, noteId: number) {
    const s = this.state;
    if (result === 'miss' || result === 'bad') {
      s.combo = 0;
    } else {
      s.combo++;
      if (s.combo > s.maxCombo) s.maxCombo = s.combo;
    }
    s.score += SCORE_TABLE[result];
    if      (result === 'perfect') s.perfects++;
    else if (result === 'good')    s.goods++;
    else if (result === 'bad')     s.bads++;
    else                           s.misses++;
    const judged = s.perfects + s.goods + s.bads + s.misses;
    this.tpSum += TP_TABLE[result];
    s.tp = parseFloat(((this.tpSum / judged) * 100).toFixed(2));
    this.onJudge({ noteId, result, x, y });
  }

  reset() { this.tpSum = 0; }
}
