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

/** Note radius as a share of playfield height, and the bounds it may not
 *  leave. A fixed pixel radius was authored against one design resolution and
 *  grew or shrank against the screen as soon as the playfield stopped being a
 *  scaled copy of it. */
const NOTE_R_SHARE = 0.075;
const MIN_NOTE_R = 42;
const MAX_NOTE_R = 96;
// Drag nodes stay a little smaller than taps so a chain still reads as one
// gesture rather than a row of separate notes.
const CHAIN_R_RATIO = 0.7;
const HIT_DURATION = 420;

/** Seconds a note is on screen ahead of its hit time. */
const APPROACH_S = 1.15;
/** Eased ramp at the head of the approach window. */
const FADE_IN_S = 0.45;
/** Fade for a note that is past its hit time but not yet judged. */
const FADE_OUT_S = 0.15;

/** Size of a note at the far end of its approach, as a fraction of full size. */
const MIN_BODY_SCALE = 0.3;
/** >1 holds the note small early, so nearly all the growth happens late. */
const GROWTH_EXPONENT = 2.2;
/** Extra swell over the last moments before the hit time. */
const HIT_OVERSHOOT = 0.22;
/** How far outside the note the approach ring starts, in body-scale units. */
const RING_SPREAD = 2.4;

/**
 * Seconds before its hit time over which a note charges up. Driven by time
 * rather than by distance to the scanline: the beam crosses a note's row on
 * the pass before its own, so a distance-based highlight lights the note up
 * on the wrong sweep.
 */
const CHARGE_S = 0.4;

/** Width of the hold channel, in px. Wide enough to read as a conduit. */
const HOLD_TRACK_WIDTH = 46;
/** Seconds the arcs take to spool up once a hold is grabbed. */
const HOLD_SPOOL_S = 0.18;
/** Lifetime of the fizzle left by a hold that was released early. */
const HOLD_BREAK_MS = 320;

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

/** The dead length of conduit left behind when a hold is dropped early. */
interface HoldBreak {
  x: number;
  headY: number;
  endY: number;
  age: number;
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

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Jagged -1..1 noise for the hold arcs. Two incommensurate sines, so the bolt
 * crackles instead of settling into a visible travelling wave.
 */
function boltNoise(index: number, phase: number): number {
  const a = Math.sin(index * 12.9898 + phase * 3.1);
  const b = Math.cos(index * 4.1421 - phase * 1.7);
  return (a + b) * 0.5;
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
  private holdBreaks: HoldBreak[] = [];

  private readonly noteR: number;
  private readonly chainR: number;

  constructor(
    app: Application,
    stage: Container,
    private W: number,
    private H: number,
  ) {
    this.noteR = Math.round(
      Math.min(Math.max(H * NOTE_R_SHARE, MIN_NOTE_R), MAX_NOTE_R),
    );
    this.chainR = Math.round(this.noteR * CHAIN_R_RATIO);

    this.textures = createNoteTextures(
      app.renderer as Renderer,
      this.noteR,
      this.chainR,
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

  update(notes: RuntimeNote[], elapsed: number, deltaMs: number) {
    this.connectorGfx.clear();
    this.liveThisFrame.clear();

    for (const note of notes) {
      this.drawConnector(note, elapsed);
    }
    this.updateHoldBreaks(deltaMs);
    for (const note of notes) {
      this.updateNoteVisual(note, elapsed);
    }

    this.retireUnusedVisuals();
    this.updateHitEffects(deltaMs);
    this.updatePopups(deltaMs);
  }

  // ── Note bodies ──────────────────────────────────────────────────────────

  private updateNoteVisual(note: RuntimeNote, elapsed: number) {
    if (note.missed) return;
    if (note.hit && note.type !== 2) return;

    if (note.type === 3) {
      this.updateChainVisuals(note, elapsed);
      return;
    }

    const alpha = this.noteAlpha(note, elapsed);
    if (alpha <= 0) return;

    this.placeVisual({
      key: note.id,
      x: note.pixelX,
      y: note.pixelY,
      alpha,
      radius: this.noteR,
      texture: "body",
      approach: this.approachProgress(note.timeSeconds, elapsed),
      charge: this.chargeLevel(note.timeSeconds, elapsed),
    });
  }

  private noteAlpha(note: RuntimeNote, elapsed: number): number {
    if (note.type === 2) return this.holdAlpha(note, elapsed);
    return this.approachAlpha(note.timeSeconds, elapsed);
  }

  private updateChainVisuals(note: RuntimeNote, elapsed: number) {
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
        alpha,
        radius: this.chainR,
        texture: "chainBody",
        approach: this.approachProgress(node.timeSeconds, elapsed),
        charge: this.chargeLevel(node.timeSeconds, elapsed),
      });
    }
  }

  private placeVisual(options: {
    key: number;
    x: number;
    y: number;
    alpha: number;
    radius: number;
    texture: "body" | "chainBody";
    approach: number;
    charge: number;
  }) {
    const visual = this.acquireVisual(options.key);
    this.liveThisFrame.add(options.key);
    const charge = options.charge;

    visual.root.position.set(options.x, options.y);
    // Uncharged notes sit back so the one that is actually due stands out.
    visual.root.alpha = options.alpha * (0.6 + charge * 0.4);

    const bodyScale = this.bodyScale(options.approach, charge);
    visual.body.texture = this.textures[options.texture];
    visual.body.scale.set(bodyScale);

    // Core brightens and shifts from cyan to purple as its hit time nears.
    const coreColor = mixColor(PALETTE.coreApproach, PALETTE.coreActive, charge);
    visual.core.tint = mixColor(coreColor, PALETTE.coreHot, charge * charge);
    visual.core.alpha = 0.32 + charge * 0.68;
    visual.core.scale.set(
      (options.radius * bodyScale * (0.85 + charge * 1.7)) / 128,
    );

    // Outer halo only really blooms on the note that is due.
    visual.halo.tint = coreColor;
    visual.halo.alpha = 0.05 + charge * 0.6;
    visual.halo.scale.set(
      (options.radius * bodyScale * (2.2 + charge * 1.9)) / 128,
    );

    this.placeApproachRing(visual, options.texture, options.approach, bodyScale);
  }

  /**
   * Size is the primary read on when a note is due: it comes in as a small
   * seed and swells late, so the note that must be played next is the biggest
   * thing on screen by a wide margin.
   */
  private bodyScale(approach: number, charge: number): number {
    const swell = Math.pow(approach, GROWTH_EXPONENT);
    const growth = MIN_BODY_SCALE + (1 - MIN_BODY_SCALE) * swell;
    return growth + charge * HIT_OVERSHOOT;
  }

  /** Ring collapses onto the note over the approach window. */
  private placeApproachRing(
    visual: NoteVisual,
    texture: "body" | "chainBody",
    approach: number,
    bodyScale: number,
  ) {
    const showRing = texture === "body" && approach < 1;
    visual.ring.visible = showRing;
    if (!showRing) return;

    // Tracks the body so the closing gap between ring and note reads as the
    // countdown, rather than the ring sliding past a note of fixed size.
    visual.ring.alpha = 0.25 + (1 - approach) * 0.55;
    visual.ring.scale.set(bodyScale + (1 - approach) * RING_SPREAD);
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

    const alpha = this.holdAlpha(note, elapsed);
    if (alpha <= 0) return;

    const top = Math.min(note.pixelY, note.endPixelY);
    const bottom = Math.max(note.pixelY, note.endPixelY);
    if (bottom - top < 2) return;

    // The channel lights with the approach so the hold can be seen coming, but
    // it only carries current while a finger is actually on it.
    const charge = this.chargeLevel(note.timeSeconds, elapsed);
    this.drawHoldChannel(note.pixelX, top, bottom, alpha, charge);
    if (!note.holdActive) return;

    const current = this.holdCurrent(note, elapsed);
    this.drawHoldArcs(note.pixelX, top, bottom, alpha, current, elapsed);
    this.drawHoldFill(note, alpha, elapsed);
  }

  /**
   * A hold that is being held stays fully lit for its whole tail. The normal
   * post-hit fade would black the channel out a fraction of a second after the
   * head, taking the arcs with it.
   */
  private holdAlpha(note: RuntimeNote, elapsed: number): number {
    if (note.holdActive) return 1;
    return this.approachAlpha(note.timeSeconds, elapsed);
  }

  /** Spools up on grab, then builds the rest of the way as the hold fills. */
  private holdCurrent(note: RuntimeNote, elapsed: number): number {
    const spool = smoothstep((elapsed - note.timeSeconds) / HOLD_SPOOL_S);
    return spool * (0.5 + note.holdProgress * 0.5);
  }

  /** The conduit the energy runs through: a slab, not a hairline. */
  private drawHoldChannel(
    x: number,
    top: number,
    bottom: number,
    alpha: number,
    charge: number,
  ) {
    const half = HOLD_TRACK_WIDTH / 2;
    const height = bottom - top;

    this.connectorGfx.roundRect(x - half, top, HOLD_TRACK_WIDTH, height, half);
    this.connectorGfx.fill({
      color: PALETTE.holdTrack,
      alpha: alpha * (0.26 + charge * 0.24),
    });

    this.connectorGfx.roundRect(x - half, top, HOLD_TRACK_WIDTH, height, half);
    this.connectorGfx.stroke({
      width: 2.5,
      color: PALETTE.holdRim,
      alpha: alpha * (0.35 + charge * 0.55),
    });
  }

  /**
   * Stacked jittering bolts inside the channel. Only drawn for a hold that is
   * being held; they widen and whiten as the current builds.
   */
  private drawHoldArcs(
    x: number,
    top: number,
    bottom: number,
    alpha: number,
    current: number,
    elapsed: number,
  ) {
    const spread = (HOLD_TRACK_WIDTH / 2) * (0.35 + current * 0.5);
    const color = mixColor(PALETTE.holdCharge, PALETTE.holdHot, current);
    const bolts = [
      { phase: elapsed * 17, width: 5, strength: 0.9 },
      { phase: elapsed * 23 + 11, width: 2.6, strength: 0.6 },
      { phase: elapsed * 31 + 47, width: 1.4, strength: 0.4 },
    ];

    for (const bolt of bolts) {
      this.strokeBolt({
        x,
        top,
        bottom,
        phase: bolt.phase,
        amplitude: spread,
        width: bolt.width * (0.5 + current * 0.8),
        color,
        alpha: alpha * bolt.strength * current,
      });
    }
  }

  private strokeBolt(options: {
    x: number;
    top: number;
    bottom: number;
    phase: number;
    amplitude: number;
    width: number;
    color: number;
    alpha: number;
  }) {
    const height = options.bottom - options.top;
    const steps = Math.max(4, Math.min(48, Math.round(height / 22)));

    this.connectorGfx.moveTo(options.x, options.top);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Pinned at both ends so the arc springs between the note and its tail.
      const taper = Math.sin(t * Math.PI);
      const offset = boltNoise(i, options.phase) * options.amplitude * taper;
      this.connectorGfx.lineTo(options.x + offset, options.top + height * t);
    }

    this.connectorGfx.stroke({
      width: options.width,
      color: options.color,
      alpha: options.alpha,
      cap: "round",
      join: "round",
    });
  }

  /** Charge front sweeping from the note head toward the tail end. */
  private drawHoldFill(note: RuntimeNote, alpha: number, elapsed: number) {
    const span = note.endPixelY - note.pixelY;
    const head = note.pixelY + span * note.holdProgress;
    const top = Math.min(note.pixelY, head);
    const height = Math.abs(head - note.pixelY);
    if (height < 1) return;

    const half = HOLD_TRACK_WIDTH / 2 - 3;
    this.connectorGfx.roundRect(note.pixelX - half, top, half * 2, height, half);
    this.connectorGfx.fill({ color: PALETTE.holdCharge, alpha: alpha * 0.45 });

    const flare = half + 5 + 3 * Math.sin(elapsed * 30);
    this.connectorGfx.circle(note.pixelX, head, flare);
    this.connectorGfx.fill({ color: PALETTE.holdHot, alpha: alpha * 0.8 });
  }

  /** Called when a hold is let go before its tail has filled. */
  triggerHoldBreak(note: RuntimeNote) {
    const span = note.endPixelY - note.pixelY;
    this.holdBreaks.push({
      x: note.pixelX,
      headY: note.pixelY + span * note.holdProgress,
      endY: note.endPixelY,
      age: 0,
    });
  }

  private updateHoldBreaks(deltaMs: number) {
    for (let i = this.holdBreaks.length - 1; i >= 0; i--) {
      const holdBreak = this.holdBreaks[i];
      holdBreak.age += deltaMs;

      if (holdBreak.age >= HOLD_BREAK_MS) {
        this.holdBreaks.splice(i, 1);
        continue;
      }
      this.drawHoldBreak(holdBreak);
    }
  }

  /** The severed arc whips wide and dies, with a snap ring at the cut. */
  private drawHoldBreak(holdBreak: HoldBreak) {
    const t = holdBreak.age / HOLD_BREAK_MS;
    const fade = 1 - t;

    this.strokeBolt({
      x: holdBreak.x,
      top: Math.min(holdBreak.headY, holdBreak.endY),
      bottom: Math.max(holdBreak.headY, holdBreak.endY),
      phase: holdBreak.age * 0.09,
      amplitude: (HOLD_TRACK_WIDTH / 2) * (0.4 + t * 1.7),
      width: 3.5 * fade,
      color: HIT_COLOR.miss,
      alpha: fade * fade * 0.85,
    });

    this.connectorGfx.circle(holdBreak.x, holdBreak.headY, 10 + t * 28);
    this.connectorGfx.stroke({
      width: 3.5 * fade,
      color: HIT_COLOR.miss,
      alpha: fade * 0.9,
    });
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

  // ── Timing helpers ───────────────────────────────────────────────────────

  private approachProgress(timeSeconds: number, elapsed: number): number {
    const remaining = timeSeconds - elapsed;
    return Math.max(0, Math.min(1, 1 - remaining / APPROACH_S));
  }

  private approachAlpha(timeSeconds: number, elapsed: number): number {
    const remaining = timeSeconds - elapsed;
    if (remaining > APPROACH_S) return 0;
    if (remaining < 0) {
      return Math.max(0, 1 + remaining / FADE_OUT_S);
    }
    return smoothstep((APPROACH_S - remaining) / FADE_IN_S);
  }

  /** 0 while a note is still far out, 1 from its hit time on. */
  private chargeLevel(timeSeconds: number, elapsed: number): number {
    const remaining = timeSeconds - elapsed;
    if (remaining <= 0) return 1;
    if (remaining >= CHARGE_S) return 0;
    return smoothstep(1 - remaining / CHARGE_S);
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
    const radius = effect.isChain ? this.chainR : this.noteR;

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
    text.position.set(x, y - this.noteR - 24);

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
