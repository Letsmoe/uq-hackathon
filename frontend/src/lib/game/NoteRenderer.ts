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
import {
  createNoteTextures,
  noteHalfFor,
  ruleWidth,
  shadowOffset,
  traceBevelSquare,
  CHAIN_HALF_RATIO,
  PALETTE,
  SKIN_COLOR,
  type NoteSkin,
  type NoteTextureSet,
} from "./noteTextures";

const HIT_DURATION = 380;

/** Seconds a note is on screen ahead of its hit time. */
const APPROACH_S = 1.15;
/** Eased ramp at the head of the approach window. */
const FADE_IN_S = 0.45;
/** Fade for a note that is past its hit time but not yet judged. */
const FADE_OUT_S = 0.15;

/** Size of a note at the far end of its approach, as a fraction of full size. */
const MIN_BODY_SCALE = 0.55;
/** >1 holds the note small early, so nearly all the growth happens late. */
const GROWTH_EXPONENT = 1.8;
/** How far outside the note the approach frame starts, in body-scale units. */
const FRAME_SPREAD = 2.6;

/**
 * Seconds before its hit time over which a note arms. Driven by time rather
 * than by distance to the scanline: the beam crosses a note's row on the pass
 * before its own, so a distance-based highlight lights the note up on the wrong
 * sweep.
 */
const CHARGE_S = 0.4;

/** Width of the hold conduit, in px. Wide enough to read as a slab. */
const HOLD_TRACK_WIDTH = 40;
/** Lifetime of the stump left by a hold that was released early. */
const HOLD_BREAK_MS = 280;

const HIT_COLOR: Record<JudgmentResult, number> = {
  perfect: PALETTE.accent,
  good: PALETTE.signal,
  bad: PALETTE.warning,
  miss: PALETTE.danger,
};

const HIT_LABEL: Record<JudgmentResult, string> = {
  perfect: "PERFECT",
  good: "GOOD",
  bad: "BAD",
  miss: "MISS",
};

const SKIN_BY_TYPE: Record<RuntimeNote["type"], NoteSkin> = {
  0: "tap",
  1: "flick",
  2: "hold",
  3: "chain",
};

interface NoteVisual {
  root: Container;
  shadow: Sprite;
  body: Sprite;
  frame: Sprite;
}

interface HitEffect {
  noteId: number;
  x: number;
  y: number;
  result: JudgmentResult;
  age: number;
  isChain: boolean;
  gfx: Graphics;
}

interface Popup {
  root: Container;
  life: number;
}

/** The dead length of conduit left behind when a hold is dropped early. */
interface HoldBreak {
  x: number;
  headY: number;
  endY: number;
  age: number;
}

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
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

  private readonly noteHalf: number;
  private readonly chainHalf: number;

  constructor(
    app: Application,
    stage: Container,
    private W: number,
    private H: number,
  ) {
    this.noteHalf = noteHalfFor(W, H);
    this.chainHalf = Math.round(this.noteHalf * CHAIN_HALF_RATIO);

    this.textures = createNoteTextures(
      app.renderer as Renderer,
      this.noteHalf,
      this.chainHalf,
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
      half: this.noteHalf,
      skin: SKIN_BY_TYPE[note.type],
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
        half: this.chainHalf,
        skin: "chain",
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
    half: number;
    skin: NoteSkin;
    approach: number;
    charge: number;
  }) {
    const visual = this.acquireVisual(options.key);
    this.liveThisFrame.add(options.key);

    visual.root.position.set(options.x, options.y);
    // Notes that are not due yet sit back, so the one to play next is the
    // solid, fully opaque shape on screen.
    visual.root.alpha = options.alpha * (0.55 + options.charge * 0.45);

    const bodyScale = this.bodyScale(options.approach);
    const texture = this.textures[options.skin];
    const throwDistance = shadowOffset(options.half) * bodyScale;

    visual.body.texture = texture;
    visual.body.scale.set(bodyScale);

    visual.shadow.texture = texture;
    visual.shadow.scale.set(bodyScale);
    visual.shadow.position.set(throwDistance, throwDistance);

    this.placeApproachFrame(visual, options.skin, options.approach, bodyScale);
  }

  /**
   * Size is a secondary read on when a note is due — the frame carries the
   * timing — so the growth here is gentle enough to keep every note legible
   * from the moment it appears.
   */
  private bodyScale(approach: number): number {
    const swell = Math.pow(approach, GROWTH_EXPONENT);
    return MIN_BODY_SCALE + (1 - MIN_BODY_SCALE) * swell;
  }

  /** Frame collapses onto the note and lands flush with its edge on the beat. */
  private placeApproachFrame(
    visual: NoteVisual,
    skin: NoteSkin,
    approach: number,
    bodyScale: number,
  ) {
    const showFrame = skin !== "chain" && approach < 1;
    visual.frame.visible = showFrame;
    if (!showFrame) return;

    visual.frame.alpha = smoothstep(approach * 2.5);
    visual.frame.scale.set(bodyScale + (1 - approach) * FRAME_SPREAD);
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

    // The shadow is the body again, flattened to black and thrown down-right,
    // exactly as a menu control casts one.
    const shadow = new Sprite(this.textures.tap);
    shadow.anchor.set(0.5);
    shadow.tint = PALETTE.ink;

    const body = new Sprite(this.textures.tap);
    body.anchor.set(0.5);

    const frame = new Sprite(this.textures.approachFrame);
    frame.anchor.set(0.5);

    root.addChild(shadow, body, frame);
    this.noteLayer.addChild(root);
    return { root, shadow, body, frame };
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

    this.drawHoldChannel(note.pixelX, top, bottom, alpha);
    this.drawHoldFill(note, alpha);
  }

  /**
   * A hold that is being held stays fully lit for its whole tail. The normal
   * post-hit fade would black the channel out a fraction of a second after the
   * head, taking the fill with it.
   */
  private holdAlpha(note: RuntimeNote, elapsed: number): number {
    if (note.holdActive) return 1;
    return this.approachAlpha(note.timeSeconds, elapsed);
  }

  /** The conduit: a white slab with the same black rule as everything else. */
  private drawHoldChannel(
    x: number,
    top: number,
    bottom: number,
    alpha: number,
  ) {
    const half = HOLD_TRACK_WIDTH / 2;
    const height = bottom - top;
    const rule = ruleWidth(this.noteHalf) * 0.7;
    const throwDistance = shadowOffset(this.noteHalf) * 0.6;

    this.connectorGfx.rect(
      x - half + throwDistance,
      top + throwDistance,
      HOLD_TRACK_WIDTH,
      height,
    );
    this.connectorGfx.fill({ color: PALETTE.ink, alpha: alpha * 0.9 });

    this.connectorGfx.rect(x - half, top, HOLD_TRACK_WIDTH, height);
    this.connectorGfx.fill({ color: PALETTE.raised, alpha });
    this.connectorGfx.stroke({ width: rule, color: PALETTE.ink, alpha });
  }

  /** Charge front sweeping from the note head toward the tail end. */
  private drawHoldFill(note: RuntimeNote, alpha: number) {
    if (note.holdProgress <= 0) return;

    const span = note.endPixelY - note.pixelY;
    const head = note.pixelY + span * note.holdProgress;
    const top = Math.min(note.pixelY, head);
    const height = Math.abs(head - note.pixelY);
    if (height < 1) return;

    const half = HOLD_TRACK_WIDTH / 2 - ruleWidth(this.noteHalf) * 0.7;
    this.connectorGfx.rect(note.pixelX - half, top, half * 2, height);
    this.connectorGfx.fill({ color: SKIN_COLOR.hold, alpha });
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

  /** The severed length flashes red and drops away. */
  private drawHoldBreak(holdBreak: HoldBreak) {
    const t = holdBreak.age / HOLD_BREAK_MS;
    const half = HOLD_TRACK_WIDTH / 2;
    const top = Math.min(holdBreak.headY, holdBreak.endY);
    const height = Math.abs(holdBreak.endY - holdBreak.headY);

    this.connectorGfx.rect(holdBreak.x - half, top, half * 2, height);
    this.connectorGfx.fill({ color: PALETTE.danger, alpha: (1 - t) * 0.85 });
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
    const dash = 9;
    const period = 18;

    for (let pos = 0; pos < length; pos += period) {
      const end = Math.min(pos + dash, length);
      this.connectorGfx.moveTo(from.pixelX + ux * pos, from.pixelY + uy * pos);
      this.connectorGfx.lineTo(from.pixelX + ux * end, from.pixelY + uy * end);
    }
    this.connectorGfx.stroke({
      width: ruleWidth(this.chainHalf),
      color: PALETTE.ink,
      alpha: 0.9,
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

    const gfx = new Graphics();
    gfx.position.set(x, y);

    this.effectLayer.addChild(gfx);
    this.hitEffects.push({ noteId, x, y, result, age: 0, isChain, gfx });

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

  /**
   * Two beats: the note's own shape punches outward as a solid block, and a
   * ring of the judgment colour is thrown clear of it. Both are hard-edged, so
   * a PERFECT and a MISS differ by colour and travel rather than by bloom.
   */
  private drawHitEffect(effect: HitEffect) {
    const t = effect.age / HIT_DURATION;
    const fade = 1 - t;
    const half = effect.isChain ? this.chainHalf : this.noteHalf;
    const color = HIT_COLOR[effect.result];

    effect.gfx.clear();

    const punch = half * (1 + t * 0.6);
    traceBevelSquare(effect.gfx, 0, 0, punch);
    effect.gfx.fill({ color, alpha: fade * fade * 0.9 });

    const burst = half * (1 + t * 2.2);
    traceBevelSquare(effect.gfx, 0, 0, burst);
    effect.gfx.stroke({
      width: ruleWidth(half) * fade,
      color: PALETTE.ink,
      alpha: fade,
    });

    traceBevelSquare(effect.gfx, 0, 0, burst * 0.86);
    effect.gfx.stroke({
      width: ruleWidth(half) * 0.8 * fade,
      color,
      alpha: fade,
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
    effect.gfx.destroy();
    this.hitEffects.splice(index, 1);
  }

  private spawnPopup(result: JudgmentResult, x: number, y: number) {
    const root = new Container();
    const size = this.popupSize(result);

    // Coloured word over a black copy of itself: the same hard shadow the
    // menu's type sits on.
    root.addChild(this.buildPopupText(result, size, PALETTE.ink, size * 0.11));
    root.addChild(this.buildPopupText(result, size, HIT_COLOR[result], 0));

    root.position.set(x, y - this.noteHalf - 26);
    this.popupLayer.addChild(root);
    this.popups.push({ root, life: 460 });
  }

  private popupSize(result: JudgmentResult): number {
    if (result === "perfect") {
      return Math.round(this.noteHalf * 0.62);
    }
    return Math.round(this.noteHalf * 0.5);
  }

  private buildPopupText(
    result: JudgmentResult,
    size: number,
    color: number,
    offset: number,
  ): Text {
    const text = new Text({
      text: HIT_LABEL[result],
      style: new TextStyle({
        fontFamily: '"Rajdhani", "Inter", system-ui, sans-serif',
        fontWeight: "700",
        fontSize: size,
        letterSpacing: size * 0.1,
        fill: color,
      }),
    });
    text.anchor.set(0.5);
    text.position.set(offset, offset);
    return text;
  }

  private updatePopups(deltaMs: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const popup = this.popups[i];
      popup.life -= deltaMs;
      popup.root.y -= 0.05 * deltaMs;
      popup.root.alpha = Math.max(0, popup.life / 460);

      if (popup.life <= 0) {
        popup.root.destroy({ children: true });
        this.popups.splice(i, 1);
      }
    }
  }

  destroy() {
    this.connectorGfx.destroy();
    this.noteLayer.destroy({ children: true });
    this.effectLayer.destroy({ children: true });
    this.popupLayer.destroy({ children: true });

    this.textures.tap.destroy(true);
    this.textures.hold.destroy(true);
    this.textures.flick.destroy(true);
    this.textures.chain.destroy(true);
    this.textures.approachFrame.destroy(true);
  }
}
