import { Graphics, Texture, type Renderer } from "pixi.js";

/**
 * Palette for the in-game surface. The playfield is a pale field with dark
 * note wells and bright cores, matching the menu's shader grid rather than
 * inverting it.
 */
export const PALETTE = {
  bezelLight: 0xffffff,
  bezelMid: 0xdcdae2,
  bezelEdge: 0x8f8b9c,
  wellDeep: 0x120e22,
  wellRim: 0x2c2448,
  coreApproach: 0x4db8ff,
  coreActive: 0xb07cff,
  coreHot: 0xffffff,
  connector: 0xffffff,
  accent: 0x7d67d2,
  scanline: 0xffffff,
} as const;

export interface NoteTextureSet {
  body: Texture;
  chainBody: Texture;
  glow: Texture;
  approachRing: Texture;
}

/**
 * Soft radial falloff used for every glow in the scene. Drawn on a 2D canvas
 * because a gradient bakes into one texture that can then be tinted and drawn
 * with additive blending, which is far cheaper than a bloom pass.
 */
function createGlowTexture(size: number): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get a 2D context for the glow texture");
  }

  const half = size / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0.0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.12, "rgba(255, 255, 255, 0.85)");
  gradient.addColorStop(0.35, "rgba(255, 255, 255, 0.32)");
  gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.07)");
  gradient.addColorStop(1.0, "rgba(255, 255, 255, 0)");

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  return Texture.from(canvas);
}

/** Short radial ticks around the bezel, with gaps for the segmented look. */
function drawBezelTicks(graphics: Graphics, radius: number, tickCount: number) {
  const inner = radius * 0.845;
  const outer = radius * 0.945;

  for (let i = 0; i < tickCount; i++) {
    // Leaves four arcs bare so the ring reads as segmented hardware.
    if (i % 8 === 3 || i % 8 === 4) {
      continue;
    }
    const angle = (i / tickCount) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    graphics.moveTo(cos * inner, sin * inner);
    graphics.lineTo(cos * outer, sin * outer);
  }
  graphics.stroke({ width: radius * 0.025, color: PALETTE.bezelEdge, alpha: 0.55 });
}

/** Heavier arc segments that break up the outer edge. */
function drawBezelSegments(graphics: Graphics, radius: number) {
  const segments: Array<[number, number]> = [
    [-0.55, 0.35],
    [2.0, 2.7],
    [3.6, 3.95],
  ];

  for (const [start, end] of segments) {
    graphics.arc(0, 0, radius * 0.895, start, end);
    graphics.stroke({ width: radius * 0.1, color: PALETTE.bezelEdge, alpha: 0.32 });
  }
}

function createBodyTexture(renderer: Renderer, radius: number): Texture {
  const graphics = new Graphics();

  // Outer hairline
  graphics.circle(0, 0, radius);
  graphics.stroke({ width: radius * 0.018, color: PALETTE.bezelEdge, alpha: 0.45 });

  // Bright metallic band
  graphics.circle(0, 0, radius * 0.895);
  graphics.stroke({ width: radius * 0.15, color: PALETTE.bezelLight, alpha: 1 });

  drawBezelSegments(graphics, radius);
  drawBezelTicks(graphics, radius, 40);

  // Shaded inner lip of the band
  graphics.circle(0, 0, radius * 0.815);
  graphics.stroke({ width: radius * 0.03, color: PALETTE.bezelMid, alpha: 0.9 });

  // Dark well
  graphics.circle(0, 0, radius * 0.8);
  graphics.fill({ color: PALETTE.wellDeep, alpha: 1 });

  // Rim light inside the well
  graphics.circle(0, 0, radius * 0.72);
  graphics.stroke({ width: radius * 0.055, color: PALETTE.wellRim, alpha: 0.75 });

  const texture = renderer.generateTexture({ target: graphics, resolution: 2 });
  graphics.destroy();
  return texture;
}

function createApproachRingTexture(renderer: Renderer, radius: number): Texture {
  const graphics = new Graphics();
  graphics.circle(0, 0, radius * 0.94);
  graphics.stroke({ width: radius * 0.02, color: PALETTE.accent, alpha: 0.9 });

  const texture = renderer.generateTexture({ target: graphics, resolution: 2 });
  graphics.destroy();
  return texture;
}

export function createNoteTextures(
  renderer: Renderer,
  noteRadius: number,
  chainRadius: number,
): NoteTextureSet {
  return {
    body: createBodyTexture(renderer, noteRadius),
    chainBody: createBodyTexture(renderer, chainRadius),
    glow: createGlowTexture(256),
    approachRing: createApproachRingTexture(renderer, noteRadius),
  };
}
