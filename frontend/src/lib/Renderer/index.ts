// ============================================================
//  renderer/index.ts — Public surface of the rendering pipeline
// ============================================================

export { GameRenderer } from "./GameRenderer";
export { RenderTarget } from "./RenderTarget";
export { ShaderProgram } from "./ShaderProgram";
export { SpriteBatch } from "./SpriteBatch";
export { BloomPipeline } from "./BloomPipeline";

export * from "./Shaders"; // re-export GLSL sources for custom shaders

export type {
  Rect,
  UVRect,
  RGBA,
  Vec2,
  Vec4,
  LayerName,
  DrawCommand,
  PostEffects,
  RenderStats,
  RectCmd,
  NoteCmd,
  HoldCmd,
  ScannerCmd,
  LaneCmd,
} from "./types";

export { UV_FULL, LAYER_ORDER, DEFAULT_POST } from "./types";
