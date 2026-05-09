import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { RuntimeNote, JudgmentResult } from "./types";

const NOTE_R = 64;
const APPROACH_S = 1.8;

// App design tokens (from global.css)
const COL = {
  tap: 0xe8e8ee, // near-white — clean default
  flick: 0xff3f80, // accent-pink
  hold: 0x3e9bff, // accent-blue
  chain: 0x00d4e8, // accent-cyan
} as const;

const NOTE_COLOR: Record<0 | 1 | 2 | 3, number> = {
  0: COL.tap,
  1: COL.flick,
  2: COL.hold,
  3: COL.chain,
};

// Judgment result colors
const HIT_COLOR: Record<JudgmentResult, number> = {
  perfect: 0xe8e8ee,
  good: 0x3e9bff,
  bad: 0xff3f80,
  miss: 0xff3f5a,
};

const HIT_COLOR_STR: Record<JudgmentResult, string> = {
  perfect: "#e8e8ee",
  good: "#3e9bff",
  bad: "#ff3f80",
  miss: "#ff3f5a",
};

interface Popup {
  text: Text;
  life: number;
}
interface Ripple {
  x: number;
  y: number;
  t: number;
  color: number;
}

export class NoteRenderer {
  private gfx: Graphics;
  private popupLayer: Container;
  private popups: Popup[] = [];
  private ripples: Ripple[] = [];

  constructor(
    _app: Application,
    stage: Container,
    private W: number,
    private H: number,
  ) {
    this.gfx = new Graphics();
    this.popupLayer = new Container();
    // Insert at 0 so Scanner (added after) renders on top
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
    debugger;

    // Note heads
    for (const n of notes) this.drawHead(g, n, elapsed);

    // Ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += deltaMs / 800;
      const a = Math.max(0, 1 - r.t);
      if (a <= 0) {
        this.ripples.splice(i, 1);
        continue;
      }
      g.circle(r.x, r.y, r.t * 56);
      g.stroke({ width: 1.5, color: r.color, alpha: a * 0.7 });
    }

    // Popups
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= deltaMs;
      p.text.y -= 0.06 * deltaMs;
      p.text.alpha = Math.max(0, p.life / 550);
      if (p.life <= 0) {
        p.text.destroy();
        this.popups.splice(i, 1);
      }
    }
  }

  // ── Alpha helpers ──────────────────────────────────────────────────────────

  private alpha(timeSeconds: number, elapsed: number): number {
    const tl = timeSeconds - elapsed;
    if (tl > APPROACH_S) return Math.max(0, 1 - (tl - APPROACH_S) / 0.1);
    // Stay visible until past bad window (0.25s) so notes don't vanish before miss fires
    return Math.min(1, Math.max(0, 1 - -tl / 0.25));
  }

  // ── Tap / Flick head ───────────────────────────────────────────────────────

  private drawHead(g: Graphics, note: RuntimeNote, elapsed: number) {
    if (note.missed) {
      return;
    }
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

    // Approach ring — shrinks toward note circle
    const ringR = NOTE_R + (1 - approach) * 400;
    g.circle(px, py, ringR);
    g.stroke({ width: 2, color: col, alpha: alpha * 0.6 });

    // Subtle fill behind ring
    g.circle(px, py, NOTE_R);
    g.fill({ color: col, alpha: alpha * 0.08 });

    // Main ring
    g.circle(px, py, NOTE_R);
    g.stroke({ width: 2, color: col, alpha: alpha * 0.9 });

    // Centre dot
    g.circle(px, py, NOTE_R * 0.4);
    g.fill({ color: col, alpha: alpha });

    // Flick arrow (small, clean)
    if (note.type === 1) {
      const aw = 9,
        ah = 5;
      g.moveTo(px - aw, py);
      g.lineTo(px + aw, py);
      g.moveTo(px + aw - ah, py - ah);
      g.lineTo(px + aw, py);
      g.lineTo(px + aw - ah, py + ah);
      g.stroke({ width: 1.5, color: 0xffffff, alpha: alpha * 0.85 });
    }
  }

  // ── Hold body (bar between start and end Y) ────────────────────────────────

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

    // Track (thin background line)
    g.rect(px - bw / 2, minY, bw, bh);
    g.fill({ color: COL.hold, alpha: a * 0.18 });

    // Fill progress
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

    // Subtle outer glow
    g.circle(px, py, NOTE_R * 1.5);
    g.fill({ color: COL.hold, alpha: a * 0.07 });

    // Ring — thicker when held
    g.circle(px, py, NOTE_R);
    g.stroke({
      width: note.holdActive ? 2.5 : 1.8,
      color: COL.hold,
      alpha: a * 0.9,
    });

    // Centre
    g.circle(px, py, NOTE_R * 0.32);
    g.fill({ color: note.holdActive ? 0xffffff : COL.hold, alpha: a });
  }

  // ── Chain ──────────────────────────────────────────────────────────────────

  private drawChainPath(g: Graphics, note: RuntimeNote, elapsed: number) {
    if (!note.nodes) return;
    const visible = note.nodes.filter(
      (node) =>
        !node.judged &&
        node.timeSeconds > elapsed - 0.1 &&
        node.timeSeconds < elapsed + APPROACH_S + 0.4,
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

      // Small ring
      g.circle(node.pixelX, node.pixelY, NOTE_R * 0.6);
      g.stroke({ width: 1.5, color: COL.chain, alpha: alpha * 0.9 });

      // Centre dot
      g.circle(node.pixelX, node.pixelY, NOTE_R * 0.22);
      g.fill({ color: COL.chain, alpha });
    }
  }

  // ── Hit feedback ───────────────────────────────────────────────────────────

  triggerHit(noteId: number, result: JudgmentResult, x: number, y: number) {
    this.ripples.push({ x, y, t: 0, color: HIT_COLOR[result] });

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
        fontSize: result === "perfect" ? 44 : 34,
        letterSpacing: result === "perfect" ? 10 : 8,
        fill: HIT_COLOR_STR[result],
      }),
    });
    text.anchor.set(0.5);
    text.position.set(x, y - 16);
    this.popupLayer.addChild(text);
    this.popups.push({ text, life: 550 });
  }

  destroy() {
    this.gfx.destroy();
    this.popupLayer.destroy(true);
  }
}
