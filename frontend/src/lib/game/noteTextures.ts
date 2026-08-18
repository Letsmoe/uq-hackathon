import { Graphics, Texture, type Renderer } from "pixi.js";

/**
 * The playfield speaks the menu's language: flat saturated fills, solid black
 * rules and hard offset shadows. Nothing glows and nothing gradients, so a note
 * is read by its shape, its colour and the gap left by its approach frame.
 */
export const PALETTE = {
  ink: 0x000000,
  canvas: 0xf2ede3,
  raised: 0xffffff,
  accent: 0x7c6bf5,
  signal: 0x35e0f0,
  warning: 0xffd34f,
  danger: 0xff5c6e,
} as const;

/** Note type carries a colour and a silhouette, not just a size. */
export type NoteSkin = "tap" | "hold" | "flick" | "chain";

export const SKIN_COLOR: Record<NoteSkin, number> = {
  tap: PALETTE.accent,
  hold: PALETTE.signal,
  flick: PALETTE.warning,
  chain: PALETTE.raised,
};

export interface NoteTextureSet {
  tap: Texture;
  hold: Texture;
  flick: Texture;
  chain: Texture;
  approachFrame: Texture;
}

/** Rule weight and shadow throw, as shares of the note's half-size. */
const RULE_SHARE = 0.11;
const SHADOW_SHARE = 0.16;
const BEVEL_SHARE = 0.28;

/** Note half-size against each screen axis, and the bounds it may not leave.
 *  Bounding it by width as well as height keeps two notes from overlapping on
 *  a narrow screen, where the chart's horizontal spacing is fixed but a
 *  height-derived note would grow past it. */
const NOTE_HEIGHT_SHARE = 0.065;
const NOTE_WIDTH_SHARE = 0.075;
const MIN_NOTE_HALF = 34;
const MAX_NOTE_HALF = 82;

/** Drag nodes stay smaller so a chain reads as one gesture. */
export const CHAIN_HALF_RATIO = 0.62;

export function noteHalfFor(width: number, height: number): number {
  const fromScreen = Math.min(height * NOTE_HEIGHT_SHARE, width * NOTE_WIDTH_SHARE);

  return Math.round(Math.min(Math.max(fromScreen, MIN_NOTE_HALF), MAX_NOTE_HALF));
}

/**
 * How much room a note needs beyond the edge of the play band. A note is drawn
 * centred on its scan position, so without this the first row of every page
 * would push up through the progress bar and the last row off the bottom.
 */
export function noteClearance(width: number, height: number): number {
  const half = noteHalfFor(width, height);

  return half + shadowOffset(half);
}

export function ruleWidth(half: number): number {
  return Math.max(2, half * RULE_SHARE);
}

export function shadowOffset(half: number): number {
  return Math.max(3, half * SHADOW_SHARE);
}

/**
 * The shape language: two opposite corners cut away, two left square. Same cut
 * the menu's `.cut` class makes, traced by hand because Pixi has no corner
 * shape of its own.
 */
export function traceBevelSquare(
  graphics: Graphics,
  centerX: number,
  centerY: number,
  half: number,
) {
  const bevel = half * BEVEL_SHARE * 2;
  const left = centerX - half;
  const right = centerX + half;
  const top = centerY - half;
  const bottom = centerY + half;

  graphics.moveTo(left + bevel, top);
  graphics.lineTo(right, top);
  graphics.lineTo(right, bottom - bevel);
  graphics.lineTo(right - bevel, bottom);
  graphics.lineTo(left, bottom);
  graphics.lineTo(left, top + bevel);
  graphics.closePath();
}

export function traceDiamond(
  graphics: Graphics,
  centerX: number,
  centerY: number,
  half: number,
) {
  graphics.moveTo(centerX, centerY - half);
  graphics.lineTo(centerX + half, centerY);
  graphics.lineTo(centerX, centerY + half);
  graphics.lineTo(centerX - half, centerY);
  graphics.closePath();
}

/** A pennant: square base, one edge drawn out to a point that reads as travel. */
function traceFlick(graphics: Graphics, half: number) {
  graphics.moveTo(-half, -half);
  graphics.lineTo(half * 0.35, -half);
  graphics.lineTo(half * 1.15, 0);
  graphics.lineTo(half * 0.35, half);
  graphics.lineTo(-half, half);
  graphics.closePath();
}

type Trace = (graphics: Graphics, half: number) => void;

const TRACES: Record<NoteSkin, Trace> = {
  tap: (graphics, half) => traceBevelSquare(graphics, 0, 0, half),
  hold: (graphics, half) => traceBevelSquare(graphics, 0, 0, half),
  flick: traceFlick,
  chain: (graphics, half) => traceDiamond(graphics, 0, 0, half),
};

/**
 * Bodies are baked with their fill and their rule already in them. The shadow
 * is the same texture tinted flat black, which is why nothing here may rely on
 * a tint of its own.
 */
function createBodyTexture(
  renderer: Renderer,
  skin: NoteSkin,
  half: number,
): Texture {
  const graphics = new Graphics();
  const rule = ruleWidth(half);

  TRACES[skin](graphics, half - rule / 2);
  graphics.fill({ color: SKIN_COLOR[skin], alpha: 1 });
  graphics.stroke({ width: rule, color: PALETTE.ink, alpha: 1, alignment: 0.5 });

  const texture = renderer.generateTexture({ target: graphics, resolution: 2 });
  graphics.destroy();
  return texture;
}

/**
 * The timing cue. A hard black outline that collapses onto the note and lands
 * flush with its edge at the hit time, so the gap between the two is the count
 * down rather than a brightness the player has to judge.
 */
function createApproachFrameTexture(renderer: Renderer, half: number): Texture {
  const graphics = new Graphics();
  const rule = ruleWidth(half) * 0.75;

  traceBevelSquare(graphics, 0, 0, half - rule / 2);
  graphics.stroke({ width: rule, color: PALETTE.ink, alpha: 1, alignment: 0.5 });

  const texture = renderer.generateTexture({ target: graphics, resolution: 2 });
  graphics.destroy();
  return texture;
}

export function createNoteTextures(
  renderer: Renderer,
  noteHalf: number,
  chainHalf: number,
): NoteTextureSet {
  return {
    tap: createBodyTexture(renderer, "tap", noteHalf),
    hold: createBodyTexture(renderer, "hold", noteHalf),
    flick: createBodyTexture(renderer, "flick", noteHalf),
    chain: createBodyTexture(renderer, "chain", chainHalf),
    approachFrame: createApproachFrameTexture(renderer, noteHalf),
  };
}
