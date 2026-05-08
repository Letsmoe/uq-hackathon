// ============================================================
//  types.ts — Shared types for the rendering pipeline
// ============================================================

export type Vec2 = [number, number];
export type Vec4 = [number, number, number, number];
export type RGBA = [number, number, number, number];

/** Axis-aligned rectangle in logical pixels */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalised UV rectangle [0,1] */
export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Shorthand for a full-texture UV rect */
export const UV_FULL: UVRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

// ── Layers ────────────────────────────────────────────────────
// Rendered in this order; lower = earlier (drawn below later layers)
export type LayerName = "bg" | "lanes" | "notes" | "fx" | "scanner";

export const LAYER_ORDER: LayerName[] = [
  "bg",
  "lanes",
  "notes",
  "fx",
  "scanner",
];

// ── Draw commands ─────────────────────────────────────────────
// Everything the game emits per frame is one of these commands.
// GameRenderer accumulates them, then flushes per-layer.

export type DrawCommandKind =
  | "rect" // solid or textured quad (sprite shader)
  | "note" // SDF circle with glow (note shader)
  | "hold" // hold-note body (hold shader)
  | "scanner" // scanning line (scanner shader)
  | "lane"; // scrolling lane backdrop (lane shader)

interface BaseCmd {
  kind: DrawCommandKind;
  layer: LayerName;
}

export interface RectCmd extends BaseCmd {
  kind: "rect";
  rect: Rect;
  uv?: UVRect;
  color: RGBA;
  textureId?: string;
}

export interface NoteCmd extends BaseCmd {
  kind: "note";
  /** Centre position in logical pixels */
  cx: number;
  cy: number;
  /** Radius in logical pixels */
  radius: number;
  color: RGBA;
  /** 0 = no glow, 1 = full scanner-proximity glow */
  glow: number;
  /** Radius of the approach ring (0 = hidden) */
  approachRadius: number;
}

export interface HoldCmd extends BaseCmd {
  kind: "hold";
  cx: number;
  topY: number;
  bottomY: number;
  width: number;
  color: RGBA;
  /** 0-1: how much has been filled by the scanner already */
  progress: number;
}

export interface ScannerCmd extends BaseCmd {
  kind: "scanner";
  /** Y centre in logical pixels */
  cy: number;
  leftX: number;
  rightX: number;
  /** Half-height of the scanner's draw rect */
  halfH: number;
  color: RGBA;
  /** 0-1: flash brightness after a hit */
  intensity: number;
}

export interface LaneCmd extends BaseCmd {
  kind: "lane";
  rect: Rect;
  color: RGBA;
  /** Normalised scroll offset driven by song time */
  scroll: number;
}

export type DrawCommand = RectCmd | NoteCmd | HoldCmd | ScannerCmd | LaneCmd;

// ── Post-processing options ───────────────────────────────────
export interface PostEffects {
  /** Bloom add-over-scene strength */
  bloomIntensity: number;
  /** Bloom brightness extraction threshold [0,1] */
  bloomThreshold: number;
  /** Chromatic aberration radius, 0 = off.  Lerps toward 0 over time. */
  chromaStrength: number;
  /** Vignette darkening at edges [0,1] */
  vignetteStrength: number;
}

export const DEFAULT_POST: PostEffects = {
  bloomIntensity: 0.85,
  bloomThreshold: 0.55,
  chromaStrength: 0,
  vignetteStrength: 0.45,
};

// ── Stats ─────────────────────────────────────────────────────
export interface RenderStats {
  drawCalls: number;
  spritesDrawn: number;
  /** Milliseconds for the GL work last frame (approx) */
  gpuTimeMs: number;
}
