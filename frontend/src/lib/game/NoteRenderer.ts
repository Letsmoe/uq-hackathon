import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { RuntimeNote, JudgmentResult } from "./types";

const NOTE_R = 64;
const APPROACH_S = 0.6;

const COL = {
  tap: 0xe8e8ee,
  flick: 0xff3f80,
  hold: 0x3e9bff,
  chain: 0x00d4e8,
} as const;

const NOTE_COLOR: Record<0 | 1 | 2 | 3, number> = {
  0: COL.tap,
  1: COL.flick,
  2: COL.hold,
  3: COL.chain,
};

const HIT_COLOR: Record<JudgmentResult, number> = {
  perfect: 0xffffff,
  good: 0x3e9bff,
  bad: 0xff3f80,
  miss: 0xff3f5a,
};

const HIT_COLOR_STR: Record<JudgmentResult, string> = {
  perfect: "#ffffff",
  good: "#3e9bff",
  bad: "#ff3f80",
  miss: "#ff3f5a",
};

interface HitEffect {
  noteId: number;
  x: number;
  y: number;
  result: JudgmentResult;
  age: number;
}

interface Popup {
  text: Text;
  life: number;
}

const HIT_DURATION = 420;

export class NoteRenderer {
  private gfx: Graphics;
  private popupLayer: Container;
  private hitEffects: HitEffect[] = [];
  private popups: Popup[] = [];

  constructor(
    _app: Application,
    stage: Container,
    private W: number,
    private H: number,
  ) {
    this.gfx = new Graphics();
    this.popupLayer = new Container();
    stage.addChildAt(this.gfx, 0);
    stage.addChild(this.popupLayer);
  }

  update(
    notes: RuntimeNote[],
    _scanPixelY: number,
    elapsed: number,
    deltaMs: number,
  ) {
    const g = this.gfx;
    g.clear();

    // Holds first (below heads)
    for (const n of notes) if (n.type === 2) this.drawHoldBody(g, n, elapsed);

    // Chain connectors
    for (const n of notes) if (n.type === 3) this.drawChainPath(g, n, elapsed);

    // Note heads
    for (const n of notes) this.drawHead(g, n, elapsed);

    // Hit effects (event-driven, coordinate-pinned)
    for (let i = this.hitEffects.length - 1; i >= 0; i--) {
      const fx = this.hitEffects[i];
      fx.age += deltaMs;
      if (fx.age >= HIT_DURATION) {
        this.hitEffects.splice(i, 1);
        continue;
      }
      this.drawHitEffect(g, fx);
    }

    // Popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= deltaMs;
      p.text.y -= 0.05 * deltaMs;
      p.text.alpha = Math.max(0, p.life / 500);
      if (p.life <= 0) {
        p.text.destroy();
        this.popups.splice(i, 1);
      }
    }
  }

  private drawHitEffect(g: Graphics, fx: HitEffect) {
    const t = fx.age / HIT_DURATION;
    const col = HIT_COLOR[fx.result];

    // Bright fill flash — first 20% of duration
    if (t < 0.2) {
      const ft = t / 0.2;
      g.circle(fx.x, fx.y, NOTE_R * (1 + ft * 0.3));
      g.fill({ color: col, alpha: (1 - ft) * 0.65 });
    }

    // Ghost ring shrinks away — first 35%
    if (t < 0.35) {
      const rt = t / 0.35;
      g.circle(fx.x, fx.y, NOTE_R * (1 + rt * 0.2));
      g.stroke({ width: 3.5, color: col, alpha: (1 - rt) * 0.95 });
    }

    // Two expanding burst rings with staggered start
    for (let j = 0; j < 2; j++) {
      const delay = j * 0.14;
      if (t < delay) continue;
      const rt = (t - delay) / (1 - delay);
      if (rt >= 1) continue;
      const radius = NOTE_R * (1 + rt * 3.5);
      g.circle(fx.x, fx.y, radius);
      g.stroke({
        width: Math.max(0.5, 2.5 * (1 - rt)),
        color: col,
        alpha: (1 - rt) * 0.55,
      });
    }
  }

  // ── Alpha helpers ──────────────────────────────────────────────────────────

  private alpha(timeSeconds: number, elapsed: number): number {
    const tl = timeSeconds - elapsed;
    if (tl > APPROACH_S) return Math.max(0, 1 - (tl - APPROACH_S) / 0.1);
    return Math.min(1, Math.max(0, 1 + tl / 0.25));
  }

  // ── Tap / Flick head ───────────────────────────────────────────────────────

  private drawHead(g: Graphics, note: RuntimeNote, elapsed: number) {
    if (note.missed) return;
    if (note.hit && note.type !== 2) return;
    if (note.type === 3) {
      this.drawChainNodes(g, note, elapsed);
      return;
    }
    if (note.type === 2) {
      this.drawHoldHead(g, note, elapsed);
      return;
    }

    const alpha = this.alpha(note.timeSeconds, elapsed);
    if (alpha <= 0) return;

    const { pixelX: px, pixelY: py } = note;
    const tl = note.timeSeconds - elapsed;
    const approach = Math.max(0, Math.min(1, 1 - tl / APPROACH_S));
    const col = NOTE_COLOR[note.type];

    // Approach ring shrinks toward note
    const ringR = NOTE_R + (1 - approach) * 380;
    g.circle(px, py, ringR);
    g.stroke({ width: 2, color: col, alpha: alpha * 0.55 });

    // Subtle fill
    g.circle(px, py, NOTE_R);
    g.fill({ color: col, alpha: alpha * 0.1 });

    // Main ring
    g.circle(px, py, NOTE_R);
    g.stroke({ width: 2.5, color: col, alpha: alpha * 0.95 });

    // Centre dot
    g.circle(px, py, NOTE_R * 0.38);
    g.fill({ color: col, alpha: alpha });

    // Flick arrow
    if (note.type === 1) {
      const aw = 10,
        ah = 6;
      g.moveTo(px - aw, py);
      g.lineTo(px + aw, py);
      g.moveTo(px + aw - ah, py - ah);
      g.lineTo(px + aw, py);
      g.lineTo(px + aw - ah, py + ah);
      g.stroke({ width: 1.8, color: 0xffffff, alpha: alpha * 0.9 });
    }
  }

  // ── Hold body ─────────────────────────────────────────────────────────────

  private drawHoldBody(g: Graphics, note: RuntimeNote, elapsed: number) {
    if (note.missed) return;
    if (note.hit && !note.holdActive) return;
    const a = this.alpha(note.timeSeconds, elapsed);
    if (a <= 0) return;

    const px = note.pixelX;
    const minY = Math.min(note.pixelY, note.endPixelY);
    const maxY = Math.max(note.pixelY, note.endPixelY);
    const bh = maxY - minY;
    if (bh <= 0) return;
    const bw = 18;

    g.rect(px - bw / 2, minY, bw, bh);
    g.fill({ color: COL.hold, alpha: a * 0.18 });

    if (note.holdActive) {
      g.rect(px - bw / 2, minY, bw, bh * note.holdProgress);
      g.fill({ color: COL.hold, alpha: a * 0.6 });
    }
  }

  private drawHoldHead(g: Graphics, note: RuntimeNote, elapsed: number) {
    if (note.hit && !note.holdActive) return;
    const a = this.alpha(note.timeSeconds, elapsed);
    if (a <= 0) return;

    const { pixelX: px, pixelY: py } = note;

    g.circle(px, py, NOTE_R * 1.5);
    g.fill({ color: COL.hold, alpha: a * 0.07 });

    g.circle(px, py, NOTE_R);
    g.stroke({
      width: note.holdActive ? 3 : 2,
      color: COL.hold,
      alpha: a * 0.9,
    });

    g.circle(px, py, NOTE_R * 0.32);
    g.fill({ color: note.holdActive ? 0xffffff : COL.hold, alpha: a });
  }

  // ── Chain ──────────────────────────────────────────────────────────────────

  private drawChainPath(g: Graphics, note: RuntimeNote, elapsed: number) {
    if (!note.nodes) return;
    const visible = note.nodes.filter(
      (nd) =>
        !nd.judged &&
        nd.timeSeconds > elapsed - 0.1 &&
        nd.timeSeconds < elapsed + APPROACH_S + 0.4,
    );
    for (let i = 0; i < visible.length - 1; i++) {
      g.moveTo(visible[i].pixelX, visible[i].pixelY);
      g.lineTo(visible[i + 1].pixelX, visible[i + 1].pixelY);
      g.stroke({ width: 10, color: COL.chain, alpha: 0.3 });
    }
  }

  private drawChainNodes(g: Graphics, note: RuntimeNote, elapsed: number) {
    if (!note.nodes) return;
    for (const node of note.nodes) {
      if (node.judged) continue;
      if (
        node.timeSeconds < elapsed - 0.1 ||
        node.timeSeconds > elapsed + APPROACH_S + 0.4
      )
        continue;
      const alpha = this.alpha(node.timeSeconds, elapsed);
      if (alpha <= 0) continue;

      g.circle(node.pixelX, node.pixelY, NOTE_R * 0.6);
      g.stroke({ width: 1.5, color: COL.chain, alpha: alpha * 0.9 });

      g.circle(node.pixelX, node.pixelY, NOTE_R * 0.22);
      g.fill({ color: COL.chain, alpha });
    }
  }

  // ── Hit feedback (event-driven) ────────────────────────────────────────────

  triggerHit(noteId: number, result: JudgmentResult, x: number, y: number) {
    // Replace existing effect for same note if present
    const existing = this.hitEffects.findIndex((fx) => fx.noteId === noteId);
    if (existing !== -1) this.hitEffects.splice(existing, 1);

    this.hitEffects.push({ noteId, x, y, result, age: 0 });

    const label =
      result === "perfect"
        ? "PERFECT"
        : result === "good"
          ? "GOOD"
          : result === "bad"
            ? "BAD"
            : "MISS";

    const text = new Text({
      text: label,
      style: new TextStyle({
        fontFamily: '"Rajdhani", "Inter", system-ui, sans-serif',
        fontWeight: "300",
        fontSize: result === "perfect" ? 46 : 36,
        letterSpacing: result === "perfect" ? 10 : 8,
        fill: HIT_COLOR_STR[result],
      }),
    });
    text.anchor.set(0.5);
    text.position.set(x, y - 20);
    this.popupLayer.addChild(text);
    this.popups.push({ text, life: 500 });
  }

  destroy() {
    this.gfx.destroy();
    this.popupLayer.destroy(true);
  }
}
