import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  type Renderer,
} from "pixi.js";
import type { RuntimeNote, JudgmentResult } from "./types";
import { createNoteTextures, PALETTE, type NoteTextureSet } from "./noteTextures";

const NOTE_R = 105;
// Drag nodes stay a little smaller than taps so a chain still reads as one
// gesture rather than a row of separate notes.
const CHAIN_R = Math.round(NOTE_R * 0.7);
const APPROACH_S = 1;
const HIT_DURATION = 420;

/** Distance from the scanline, in px, over which a note lights up. */
const SCANLIT_FALLOFF = 190;

const HIT_COLOR: Record<JudgmentResult, number> = {
  perfect: 0xffffff,
  good: 0x9fd0ff,
  bad: 0xffa03f,
  miss: 0xff5a7a,
};

const HIT_COLOR_STR: Record<JudgmentResult, string> = {
  perfect: "#5b4bb8",
  good: "#4a7fc0",
  bad: "#b8763a",
  miss: "#c04a63",
};

const HIT_LABEL: Record<JudgmentResult, string> = {
  perfect: "PERFECT",
  good: "GOOD",
  bad: "BAD",
  miss: "MISS",
};

interface NoteVisual {
  root: Container;
  halo: Sprite;
  body: Sprite;
  core: Sprite;
  ring: Sprite;
}

interface HitEffect {
  noteId: number;
  x: number;
  y: number;
  result: JudgmentResult;
  age: number;
  isChain: boolean;
  flash: Sprite;
  ring: Graphics;
}

interface Popup {
  text: Text;
  life: number;
}

function lerpChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

function mixColor(from: number, to: number, t: number): number {
  const r = lerpChannel((from >> 16) & 0xff, (to >> 16) & 0xff, t);
  const g = lerpChannel((from >> 8) & 0xff, (to >> 8) & 0xff, t);
  const b = lerpChannel(from & 0xff, to & 0xff, t);
  return (r << 16) | (g << 8) | b;
}

export class NoteRenderer {
  private textures: NoteTextureSet;
  private connectorGfx: Graphics;
  private noteLayer: Container;
  private effectLayer: Container;
  private popupLayer: Container;

  private visuals = new Map<number, NoteVisual>();
  private visualPool: NoteVisual[] = [];
  private liveThisFrame = new Set<number>();

  private hitEffects: HitEffect[] = [];
  private popups: Popup[] = [];

  constructor(
    app: Application,
    stage: Container,
    private W: number,
    private H: number,
  ) {
    this.textures = createNoteTextures(
      app.renderer as Renderer,
      NOTE_R,
      CHAIN_R,
    );

    this.connectorGfx = new Graphics();
    this.noteLayer = new Container();
    this.effectLayer = new Container();
    this.popupLayer = new Container();

    stage.addChild(this.connectorGfx);
    stage.addChild(this.noteLayer);
    stage.addChild(this.effectLayer);
    stage.addChild(this.popupLayer);
  }

  update(
    notes: RuntimeNote[],
    scanPixelY: number,
    elapsed: number,
    deltaMs: number,
  ) {
    this.connectorGfx.clear();
    this.liveThisFrame.clear();

    for (const note of notes) {
      this.drawConnector(note, elapsed);
    }
    for (const note of notes) {
      this.updateNoteVisual(note, scanPixelY, elapsed);
    }

    this.retireUnusedVisuals();
    this.updateHitEffects(deltaMs);
    this.updatePopups(deltaMs);
  }

  // ── Note bodies ──────────────────────────────────────────────────────────

  private updateNoteVisual(
    note: RuntimeNote,
    scanPixelY: number,
    elapsed: number,
  ) {
    if (note.missed) return;
    if (note.hit && note.type !== 2) return;

    if (note.type === 3) {
      this.updateChainVisuals(note, scanPixelY, elapsed);
      return;
    }

    const alpha = this.approachAlpha(note.timeSeconds, elapsed);
    if (alpha <= 0) return;

    this.placeVisual({
      key: note.id,
      x: note.pixelX,
      y: note.pixelY,
      scanPixelY,
      alpha,
      radius: NOTE_R,
      texture: "body",
      approach: this.approachProgress(note.timeSeconds, elapsed),
      forceHot: note.holdActive,
    });
  }

  private updateChainVisuals(
    note: RuntimeNote,
    scanPixelY: number,
    elapsed: number,
  ) {
    if (!note.nodes) return;

    for (let i = 0; i < note.nodes.length; i++) {
      const node = note.nodes[i];
      if (node.judged) continue;

      const alpha = this.approachAlpha(node.timeSeconds, elapsed);
      if (alpha <= 0) continue;

      this.placeVisual({
        // Node keys must not collide with note ids, hence the offset.
        key: note.id * 10000 + i + 1_000_000,
        x: node.pixelX,
        y: node.pixelY,
        scanPixelY,
        alpha,
        radius: CHAIN_R,
        texture: "chainBody",
        approach: this.approachProgress(node.timeSeconds, elapsed),
        forceHot: false,
      });
    }
  }

  private placeVisual(options: {
    key: number;
    x: number;
    y: number;
    scanPixelY: number;
    alpha: number;
    radius: number;
    texture: "body" | "chainBody";
    approach: number;
    forceHot: boolean;
  }) {
    const visual = this.acquireVisual(options.key);
    this.liveThisFrame.add(options.key);

    const scanDistance = Math.abs(options.y - options.scanPixelY);
    let scanlit = Math.max(0, 1 - scanDistance / SCANLIT_FALLOFF);
    if (options.forceHot) {
      scanlit = 1;
    }

    visual.root.position.set(options.x, options.y);
    visual.root.alpha = options.alpha;

    // Body: settles to full size as it approaches, so notes "arrive".
    const bodyScale = 0.86 + options.approach * 0.14 + scanlit * 0.05;
    visual.body.texture = this.textures[options.texture];
    visual.body.scale.set(bodyScale);

    // Core brightens and shifts from cyan to purple at the scanline.
    const coreColor = mixColor(
      PALETTE.coreApproach,
      PALETTE.coreActive,
      scanlit,
    );
    visual.core.tint = mixColor(coreColor, PALETTE.coreHot, scanlit * 0.75);
    visual.core.alpha = 0.55 + scanlit * 0.45;
    const coreScale = ((options.radius * (0.9 + scanlit * 1.5)) / 128) * 1.0;
    visual.core.scale.set(coreScale);

    // Outer halo only really blooms near the line.
    visual.halo.tint = coreColor;
    visual.halo.alpha = 0.1 + scanlit * 0.5;
    visual.halo.scale.set((options.radius * (2.4 + scanlit * 1.6)) / 128);

    // Approach ring collapses onto the note.
    const showRing = options.texture === "body" && options.approach < 1;
    visual.ring.visible = showRing;
    if (showRing) {
      visual.ring.alpha = (1 - options.approach) * 0.5;
      visual.ring.scale.set(1 + (1 - options.approach) * 2.2);
    }
  }

  private acquireVisual(key: number): NoteVisual {
    const existing = this.visuals.get(key);
    if (existing) {
      return existing;
    }

    const pooled = this.visualPool.pop();
    if (pooled) {
      pooled.root.visible = true;
      this.visuals.set(key, pooled);
      return pooled;
    }

    const created = this.createVisual();
    this.visuals.set(key, created);
    return created;
  }

  private createVisual(): NoteVisual {
    const root = new Container();

    const halo = new Sprite(this.textures.glow);
    halo.anchor.set(0.5);
    halo.blendMode = "add";

    const body = new Sprite(this.textures.body);
    body.anchor.set(0.5);

    const core = new Sprite(this.textures.glow);
    core.anchor.set(0.5);
    core.blendMode = "add";

    const ring = new Sprite(this.textures.approachRing);
    ring.anchor.set(0.5);

    root.addChild(halo, body, core, ring);
    this.noteLayer.addChild(root);
    return { root, halo, body, core, ring };
  }

  private retireUnusedVisuals() {
    for (const [key, visual] of this.visuals) {
      if (this.liveThisFrame.has(key)) {
        continue;
      }
      visual.root.visible = false;
      this.visuals.delete(key);
      this.visualPool.push(visual);
    }
  }

  // ── Connectors ───────────────────────────────────────────────────────────

  private drawConnector(note: RuntimeNote, elapsed: number) {
    if (note.missed) return;
    if (note.type === 2) {
      this.drawHoldTail(note, elapsed);
      return;
    }
    if (note.type === 3) {
      this.drawChainTrail(note, elapsed);
    }
  }

  private drawHoldTail(note: RuntimeNote, elapsed: number) {
    if (note.hit && !note.holdActive) return;

    const alpha = this.approachAlpha(note.timeSeconds, elapsed);
    if (alpha <= 0) return;

    const top = Math.min(note.pixelY, note.endPixelY);
    const bottom = Math.max(note.pixelY, note.endPixelY);
    if (bottom - top <= 0) return;

    this.drawDashedLine(note.pixelX, top, bottom, alpha * 0.75);

    if (note.holdActive) {
      const filled = top + (bottom - top) * note.holdProgress;
      this.connectorGfx.moveTo(note.pixelX, top);
      this.connectorGfx.lineTo(note.pixelX, filled);
      this.connectorGfx.stroke({
        width: 5,
        color: PALETTE.accent,
        alpha: alpha * 0.9,
      });
    }
  }

  private drawChainTrail(note: RuntimeNote, elapsed: number) {
    if (!note.nodes) return;

    const pending = note.nodes.filter((node) => {
      if (node.judged) return false;
      if (node.timeSeconds < elapsed - 0.1) return false;
      return node.timeSeconds < elapsed + APPROACH_S + 0.4;
    });

    for (let i = 0; i < pending.length - 1; i++) {
      this.drawDashedSegment(pending[i], pending[i + 1]);
    }
  }

  private drawDashedSegment(
    from: { pixelX: number; pixelY: number },
    to: { pixelX: number; pixelY: number },
  ) {
    const dx = to.pixelX - from.pixelX;
    const dy = to.pixelY - from.pixelY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1) return;

    const ux = dx / length;
    const uy = dy / length;
    const dash = 7;
    const period = 15;

    for (let pos = 0; pos < length; pos += period) {
      const end = Math.min(pos + dash, length);
      this.connectorGfx.moveTo(from.pixelX + ux * pos, from.pixelY + uy * pos);
      this.connectorGfx.lineTo(from.pixelX + ux * end, from.pixelY + uy * end);
    }
    this.connectorGfx.stroke({
      width: 3,
      color: PALETTE.connector,
      alpha: 0.85,
    });
  }

  /** Vertical dashed drop line, as under the notes in the reference art. */
  private drawDashedLine(x: number, top: number, bottom: number, alpha: number) {
    const dash = 8;
    const period = 18;

    for (let y = top; y < bottom; y += period) {
      const end = Math.min(y + dash, bottom);
      this.connectorGfx.moveTo(x, y);
      this.connectorGfx.lineTo(x, end);
    }
    this.connectorGfx.stroke({
      width: 3,
      color: PALETTE.connector,
      alpha,
    });
  }

  // ── Timing helpers ───────────────────────────────────────────────────────

  private approachProgress(timeSeconds: number, elapsed: number): number {
    const remaining = timeSeconds - elapsed;
    return Math.max(0, Math.min(1, 1 - remaining / APPROACH_S));
  }

  private approachAlpha(timeSeconds: number, elapsed: number): number {
    const remaining = timeSeconds - elapsed;
    if (remaining > APPROACH_S) {
      return Math.max(0, 1 - (remaining - APPROACH_S) / 0.1);
    }
    return Math.min(1, Math.max(0, 1 + remaining / 0.25));
  }

  // ── Hit feedback ─────────────────────────────────────────────────────────

  triggerHit(
    noteId: number,
    result: JudgmentResult,
    x: number,
    y: number,
    isChain = false,
  ) {
    this.removeHitEffect(noteId);

    const flash = new Sprite(this.textures.glow);
    flash.anchor.set(0.5);
    flash.blendMode = "add";
    flash.tint = HIT_COLOR[result];
    flash.position.set(x, y);

    const ring = new Graphics();
    ring.position.set(x, y);

    this.effectLayer.addChild(flash, ring);
    this.hitEffects.push({
      noteId,
      x,
      y,
      result,
      age: 0,
      isChain,
      flash,
      ring,
    });

    this.spawnPopup(result, x, y);
  }

  private updateHitEffects(deltaMs: number) {
    for (let i = this.hitEffects.length - 1; i >= 0; i--) {
      const effect = this.hitEffects[i];
      effect.age += deltaMs;

      if (effect.age >= HIT_DURATION) {
        this.destroyHitEffect(i);
        continue;
      }
      this.drawHitEffect(effect);
    }
  }

  private drawHitEffect(effect: HitEffect) {
    const t = effect.age / HIT_DURATION;
    const radius = effect.isChain ? CHAIN_R : NOTE_R;

    effect.flash.alpha = (1 - t) * 0.9;
    effect.flash.scale.set((radius * (1.6 + t * 2.6)) / 128);

    effect.ring.clear();
    effect.ring.circle(0, 0, radius * (1 + t * 2.4));
    effect.ring.stroke({
      width: Math.max(0.6, 4 * (1 - t)),
      color: HIT_COLOR[effect.result],
      alpha: (1 - t) * 0.7,
    });
  }

  private removeHitEffect(noteId: number) {
    const index = this.hitEffects.findIndex((fx) => fx.noteId === noteId);
    if (index !== -1) {
      this.destroyHitEffect(index);
    }
  }

  private destroyHitEffect(index: number) {
    const effect = this.hitEffects[index];
    effect.flash.destroy();
    effect.ring.destroy();
    this.hitEffects.splice(index, 1);
  }

  private spawnPopup(result: JudgmentResult, x: number, y: number) {
    const text = new Text({
      text: HIT_LABEL[result],
      style: new TextStyle({
        fontFamily: '"Rajdhani", "Inter", system-ui, sans-serif',
        fontWeight: "300",
        fontSize: result === "perfect" ? 40 : 32,
        letterSpacing: result === "perfect" ? 10 : 8,
        fill: HIT_COLOR_STR[result],
      }),
    });
    text.anchor.set(0.5);
    text.position.set(x, y - NOTE_R - 24);

    this.popupLayer.addChild(text);
    this.popups.push({ text, life: 500 });
  }

  private updatePopups(deltaMs: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const popup = this.popups[i];
      popup.life -= deltaMs;
      popup.text.y -= 0.045 * deltaMs;
      popup.text.alpha = Math.max(0, popup.life / 500);

      if (popup.life <= 0) {
        popup.text.destroy();
        this.popups.splice(i, 1);
      }
    }
  }

  destroy() {
    this.connectorGfx.destroy();
    this.noteLayer.destroy({ children: true });
    this.effectLayer.destroy({ children: true });
    this.popupLayer.destroy({ children: true });

    this.textures.body.destroy(true);
    this.textures.chainBody.destroy(true);
    this.textures.glow.destroy(true);
    this.textures.approachRing.destroy(true);
  }
}
