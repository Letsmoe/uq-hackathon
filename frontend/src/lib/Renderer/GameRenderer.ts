// ============================================================
//  GameRenderer.ts — Rhythm-game rendering pipeline
//
//  The single class the game code talks to.  Everything below
//  (FBOs, batches, shaders, bloom) is internal.
//
//  Coordinate system: origin top-left, Y down, logical pixels.
//  DPR scaling is handled internally — callers always use CSS px.
//
//  Frame lifecycle:
//    renderer.beginFrame(time)
//      renderer.drawLane(…)
//      renderer.drawNote(…)
//      renderer.drawHoldBody(…)
//      renderer.drawScanner(…)
//      renderer.drawRect(…)        ← arbitrary textured / solid quads
//    renderer.endFrame()           ← flush → bloom → composite → present
//
//  HTML elements handle the main menu; this renderer is for
//  the in-game canvas only.
// ============================================================

import { RenderTarget } from "./RenderTarget";
import { ShaderProgram } from "./ShaderProgram";
import { SpriteBatch } from "./SpriteBatch";
import { BloomPipeline } from "./BloomPipeline";
import {
  GAME_VERT,
  SPRITE_FRAG,
  NOTE_FRAG,
  HOLD_FRAG,
  SCANNER_FRAG,
  LANE_FRAG,
  POST_VERT,
  COMPOSITE_FRAG,
} from "./Shaders";
import {
  DEFAULT_POST,
  LAYER_ORDER,
  UV_FULL,
  type DrawCommand,
  type HoldCmd,
  type LaneCmd,
  type NoteCmd,
  type RGBA,
  type Rect,
  type RectCmd,
  type RenderStats,
  type PostEffects,
  type ScannerCmd,
  type UVRect,
} from "./types";

// ── Orthographic projection (column-major mat4) ───────────────
// Maps logical pixels (origin top-left, Y down) to NDC.
function orthoMat4(w: number, h: number, out: Float32Array): Float32Array {
  out.fill(0);
  out[0] = 2 / w; // col 0
  out[5] = -2 / h; // col 1  (negative → Y flip)
  out[10] = 1; // col 2
  out[12] = -1; // col 3 translation X
  out[13] = 1; // col 3 translation Y
  out[15] = 1;
  return out;
}

// ── Texture cache ─────────────────────────────────────────────
interface CachedTexture {
  glTex: WebGLTexture;
  width: number;
  height: number;
}

// ── Layer bucket ──────────────────────────────────────────────
// One command list per layer; filled during beginFrame→endFrame.
type LayerBucket = Map<string, DrawCommand[]>; // key unused, just an array wrapper

export class GameRenderer {
  // ── GL context ────────────────────────────────────────────
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;

  // ── Logical / physical sizes ──────────────────────────────
  private logW = 0;
  private logH = 0;
  private physW = 0;
  private physH = 0;
  private dpr = 1;
  private projMat = new Float32Array(16);

  // ── Pipeline resources ────────────────────────────────────
  private sceneRT: RenderTarget; // HDR scene buffer
  private bloom: BloomPipeline;
  private batch: SpriteBatch;

  // ── Shaders ───────────────────────────────────────────────
  private shSprite: ShaderProgram;
  private shNote: ShaderProgram;
  private shHold: ShaderProgram;
  private shScanner: ShaderProgram;
  private shLane: ShaderProgram;
  private shComposite: ShaderProgram;

  // ── Texture registry ──────────────────────────────────────
  private textures = new Map<string, CachedTexture>();

  // ── Draw queue (filled per frame) ─────────────────────────
  private queue: DrawCommand[] = [];

  // ── Post-processing state ─────────────────────────────────
  public post: PostEffects = { ...DEFAULT_POST };
  private _time = 0;

  // ── Stats ─────────────────────────────────────────────────
  public readonly stats: RenderStats = {
    drawCalls: 0,
    spritesDrawn: 0,
    gpuTimeMs: 0,
  };

  // ── Resize observer ───────────────────────────────────────
  private _ro: ResizeObserver;

  // ─────────────────────────────────────────────────────────
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
      desynchronized: true, // low-latency hint on mobile
    });
    if (!gl) throw new Error("GameRenderer: WebGL2 not available");
    this.gl = gl;

    // Enable required extensions
    gl.getExtension("EXT_color_buffer_float"); // HDR FBOs
    gl.getExtension("OES_texture_float_linear"); // linear filtering on float textures

    // ── GL state ─────────────────────────────────────────
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Pre-multiplied alpha compositing
    gl.blendFuncSeparate(
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );

    // ── Compile shaders ───────────────────────────────────
    this.shSprite = new ShaderProgram(gl, "sprite", GAME_VERT, SPRITE_FRAG);
    this.shNote = new ShaderProgram(gl, "note", GAME_VERT, NOTE_FRAG);
    this.shHold = new ShaderProgram(gl, "hold", GAME_VERT, HOLD_FRAG);
    this.shScanner = new ShaderProgram(gl, "scanner", GAME_VERT, SCANNER_FRAG);
    this.shLane = new ShaderProgram(gl, "lane", GAME_VERT, LANE_FRAG);
    this.shComposite = new ShaderProgram(
      gl,
      "composite",
      POST_VERT,
      COMPOSITE_FRAG,
    );

    // ── Shared batch & pipeline ───────────────────────────
    this.batch = new SpriteBatch(gl);
    this.sceneRT = new RenderTarget(gl, 1, 1, { hdr: true });
    this.bloom = new BloomPipeline(gl, 1, 1);

    // ── Observe canvas resize ─────────────────────────────
    this._ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        this._setLogicalSize(width, height);
      }
    });
    this._ro.observe(canvas);
    this._setLogicalSize(canvas.clientWidth, canvas.clientHeight);
  }

  // ── Resize ────────────────────────────────────────────────

  private _setLogicalSize(logW: number, logH: number): void {
    this.dpr = Math.min(window.devicePixelRatio ?? 1, 2.5);
    this.logW = logW;
    this.logH = logH;
    this.physW = Math.round(logW * this.dpr);
    this.physH = Math.round(logH * this.dpr);

    this.canvas.width = this.physW;
    this.canvas.height = this.physH;
    this.canvas.style.width = `${logW}px`;
    this.canvas.style.height = `${logH}px`;

    orthoMat4(logW, logH, this.projMat);

    this.sceneRT.resize(this.physW, this.physH);
    this.bloom.resize(this.physW, this.physH);
  }

  /**
   * Force a resize to specific logical pixel dimensions.
   * Usually not needed — the ResizeObserver handles this automatically.
   */
  resize(logW: number, logH: number): void {
    this._setLogicalSize(logW, logH);
  }

  // ── Texture management ────────────────────────────────────

  /**
   * Load a PNG/JPEG from a URL, upload as a WebGL texture, and cache it.
   * @returns Promise that resolves once the texture is GPU-ready.
   */
  async loadTexture(id: string, src: string): Promise<void> {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
    this._uploadTexture(id, img);
  }

  /** Upload an ImageBitmap (e.g. from a canvas or createImageBitmap). */
  uploadBitmap(
    id: string,
    bitmap: ImageBitmap | ImageData | HTMLCanvasElement,
  ): void {
    this._uploadTexture(id, bitmap as TexImageSource);
  }

  private _uploadTexture(id: string, src: TexImageSource): void {
    const gl = this.gl;
    const glTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const w =
      (src as HTMLImageElement).naturalWidth ?? (src as ImageData).width ?? 0;
    const h =
      (src as HTMLImageElement).naturalHeight ?? (src as ImageData).height ?? 0;
    this.textures.set(id, { glTex, width: w, height: h });
  }

  deleteTexture(id: string): void {
    const t = this.textures.get(id);
    if (t) {
      this.gl.deleteTexture(t.glTex);
      this.textures.delete(id);
    }
  }

  // ── Custom shaders ────────────────────────────────────────

  /**
   * Compile and register a custom game-layer shader.
   * It must use the same vertex attribute layout as the built-in shaders
   * (see GAME_VERT in shaders.ts — locations 0-4).
   * The vertex stage is already provided; only supply the fragment source.
   *
   * @param id       Identifier used in drawRect() calls
   * @param fragSrc  GLSL 3.00 ES fragment shader source
   */
  registerShader(id: string, fragSrc: string): ShaderProgram {
    const sh = new ShaderProgram(this.gl, id, GAME_VERT, fragSrc);
    (this as any)[`_custom_${id}`] = sh;
    return sh;
  }

  // ── Post-processing helpers ───────────────────────────────

  /**
   * Trigger a momentary chromatic-aberration flash (e.g. on a Perfect hit).
   * The strength decays automatically at the given rate each second.
   *
   * @param strength  0-1; 1 = full aberration
   */
  triggerChromaFlash(strength = 1): void {
    this.post.chromaStrength = Math.min(1, this.post.chromaStrength + strength);
  }

  // ── Frame API ─────────────────────────────────────────────

  /**
   * Call once at the start of each frame.
   * @param time Monotonic seconds (e.g. performance.now() / 1000).
   */
  beginFrame(time: number): void {
    this._time = time;
    this.queue = [];
    this.batch.totalFlushed = 0;
    this.batch.totalDrawCalls = 0;
  }

  // ── Draw commands ─────────────────────────────────────────

  /**
   * Draw a solid or textured rectangle.
   *
   * @param layer     Which layer to put this in
   * @param rect      Position + size in logical pixels
   * @param color     RGBA tint [0,1]
   * @param textureId Optional pre-loaded texture ID
   * @param uv        UV rect (defaults to full texture)
   */
  drawRect(
    layer: "bg" | "lanes" | "notes" | "fx" | "scanner",
    rect: Rect,
    color: RGBA,
    textureId?: string,
    uv?: UVRect,
  ): void {
    const cmd: RectCmd = { kind: "rect", layer, rect, color, uv, textureId };
    this.queue.push(cmd);
  }

  /**
   * Draw a note as an SDF circle.
   *
   * @param layer        Usually 'notes'
   * @param cx           Centre X (logical px)
   * @param cy           Centre Y (logical px)
   * @param radius       Radius in logical pixels
   * @param color        RGBA
   * @param glow         0-1: scanner proximity (drives bloom aura)
   * @param approachT    1→0 as scanner approaches; 0 = no approach ring
   */
  drawNote(
    layer: "notes" | "fx",
    cx: number,
    cy: number,
    radius: number,
    color: RGBA,
    glow = 0,
    approachT = 0,
  ): void {
    const cmd: NoteCmd = {
      kind: "note",
      layer,
      cx,
      cy,
      radius,
      color,
      glow,
      approachRadius: approachT,
    };
    this.queue.push(cmd);
  }

  /**
   * Draw a hold-note body between two Y positions.
   *
   * @param layer     Usually 'notes'
   * @param cx        Centre X (logical px)
   * @param topY      Top of the body (logical px)
   * @param bottomY   Bottom of the body (logical px)
   * @param width     Body width (logical px)
   * @param color     RGBA
   * @param progress  0-1 fill fraction (advances as scanner scrolls past)
   */
  drawHoldBody(
    layer: "notes" | "fx",
    cx: number,
    topY: number,
    bottomY: number,
    width: number,
    color: RGBA,
    progress = 0,
  ): void {
    const cmd: HoldCmd = {
      kind: "hold",
      layer,
      cx,
      topY,
      bottomY,
      width,
      color,
      progress,
    };
    this.queue.push(cmd);
  }

  /**
   * Draw the scanner line.
   *
   * @param cy        Centre Y in logical pixels
   * @param leftX     Left edge X
   * @param rightX    Right edge X
   * @param halfH     Half-height of the scanner rect (controls glow spread)
   * @param color     RGBA (usually cyan)
   * @param intensity 0-1 flash intensity (peaks on hit, decays)
   */
  drawScanner(
    cy: number,
    leftX: number,
    rightX: number,
    halfH = 28,
    color: RGBA = [0, 1, 1, 1],
    intensity = 0,
  ): void {
    const cmd: ScannerCmd = {
      kind: "scanner",
      layer: "scanner",
      cy,
      leftX,
      rightX,
      halfH,
      color,
      intensity,
    };
    this.queue.push(cmd);
  }

  /**
   * Draw a scrolling lane backdrop.
   *
   * @param rect   Bounding rect of the lane (logical px)
   * @param color  Tint colour
   * @param scroll Normalised scroll offset driven by song time
   */
  drawLane(rect: Rect, color: RGBA, scroll: number): void {
    const cmd: LaneCmd = { kind: "lane", layer: "lanes", rect, color, scroll };
    this.queue.push(cmd);
  }

  // ── End-of-frame flush ────────────────────────────────────

  /**
   * Flush all draw calls to the GPU, run post-processing, and
   * present the final image to the canvas.
   */
  endFrame(): void {
    const gl = this.gl;
    const t0 = performance.now();
    const { physW, physH } = this;

    // ── Decay post effects ────────────────────────────────
    this.post.chromaStrength = Math.max(0, this.post.chromaStrength - 0.04);

    // ── 1. Render scene to sceneRT ────────────────────────
    this.sceneRT.bind();
    gl.clearColor(0.024, 0.024, 0.047, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );

    // Sort queue: LAYER_ORDER defines draw order
    const layerIdx = Object.fromEntries(LAYER_ORDER.map((n, i) => [n, i]));
    this.queue.sort((a, b) => layerIdx[a.layer] - layerIdx[b.layer]);

    // Flush by shader group to minimise state changes
    this._flushQueue();

    // ── 2. Bloom ──────────────────────────────────────────
    // Disable blending for post-process passes (full-screen quads)
    gl.disable(gl.BLEND);
    const bloomTex = this.bloom.process(this.sceneRT.texture);

    // ── 3. Composite to screen ────────────────────────────
    RenderTarget.bindDefault(gl, physW, physH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.shComposite
      .use()
      .setTexture("u_scene", 0, this.sceneRT.texture)
      .setTexture("u_bloom", 1, bloomTex)
      .setFloat("u_bloomIntensity", this.post.bloomIntensity)
      .setFloat("u_chromaStrength", this.post.chromaStrength)
      .setFloat("u_vignetteStrength", this.post.vignetteStrength)
      .setFloat("u_time", this._time);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── Stats ─────────────────────────────────────────────
    this.stats.drawCalls = this.batch.totalDrawCalls;
    this.stats.spritesDrawn = this.batch.totalFlushed;
    this.stats.gpuTimeMs = performance.now() - t0;
  }

  // ── Internal flush logic ──────────────────────────────────

  private _flushQueue(): void {
    const gl = this.gl;
    let currentShader: ShaderProgram | null = null;
    let currentTex: WebGLTexture | null = null;

    const setShader = (sh: ShaderProgram) => {
      if (sh === currentShader) return;
      if (this.batch.pending > 0) this.batch.flush();
      currentShader = sh;
      sh.use().setMat4("u_proj", this.projMat).setFloat("u_time", this._time);
    };

    const setTexture = (id: string | undefined) => {
      const t = id ? (this.textures.get(id)?.glTex ?? null) : null;
      if (t === currentTex) return;
      if (this.batch.pending > 0) this.batch.flush();
      currentTex = t;
      if (currentShader) {
        const useTex = t !== null;
        currentShader.setBool("u_useTexture", useTex);
        if (useTex) currentShader.setTexture("u_texture", 0, t!);
      }
    };

    for (const cmd of this.queue) {
      switch (cmd.kind) {
        case "rect": {
          setShader(this.shSprite);
          setTexture(cmd.textureId);
          this.batch.push(cmd.rect, cmd.uv ?? UV_FULL, cmd.color);
          break;
        }

        case "note": {
          setShader(this.shNote);
          // Note is a square centred on (cx, cy)
          const r = cmd.radius;
          this.batch.push(
            { x: cmd.cx - r, y: cmd.cy - r, w: r * 2, h: r * 2 },
            UV_FULL,
            cmd.color,
            [cmd.glow, cmd.approachRadius],
          );
          break;
        }

        case "hold": {
          setShader(this.shHold);
          const top = Math.min(cmd.topY, cmd.bottomY);
          const bot = Math.max(cmd.topY, cmd.bottomY);
          this.batch.push(
            {
              x: cmd.cx - cmd.width * 0.5,
              y: top,
              w: cmd.width,
              h: Math.max(2, bot - top),
            },
            UV_FULL,
            cmd.color,
            [cmd.progress, 0],
          );
          break;
        }

        case "scanner": {
          setShader(this.shScanner);
          this.batch.push(
            {
              x: cmd.leftX,
              y: cmd.cy - cmd.halfH,
              w: cmd.rightX - cmd.leftX,
              h: cmd.halfH * 2,
            },
            UV_FULL,
            cmd.color,
            [cmd.intensity, 0],
          );
          break;
        }

        case "lane": {
          setShader(this.shLane);
          this.batch.push(cmd.rect, UV_FULL, cmd.color, [cmd.scroll, 0]);
          break;
        }
      }
    }

    // Flush any remaining sprites
    if (this.batch.pending > 0) this.batch.flush();
  }

  // ── Accessors ─────────────────────────────────────────────

  get logicalWidth(): number {
    return this.logW;
  }
  get logicalHeight(): number {
    return this.logH;
  }
  get physicalWidth(): number {
    return this.physW;
  }
  get physicalHeight(): number {
    return this.physH;
  }
  get pixelRatio(): number {
    return this.dpr;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  dispose(): void {
    this._ro.disconnect();
    this.batch.dispose();
    this.sceneRT.dispose();
    this.bloom.dispose();
    this.shSprite.dispose();
    this.shNote.dispose();
    this.shHold.dispose();
    this.shScanner.dispose();
    this.shLane.dispose();
    this.shComposite.dispose();
    for (const { glTex } of this.textures.values()) {
      this.gl.deleteTexture(glTex);
    }
  }
}
