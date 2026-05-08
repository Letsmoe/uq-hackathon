// ============================================================
//  BloomPipeline.ts — Dual-kawase multi-pass bloom
//
//  Algorithm (6 passes total per frame):
//    1. Threshold   — extract bright pixels (soft knee)
//    2. Downsample  — kawase down ×STEPS  (halving each time)
//    3. Upsample    — kawase up   ×STEPS  (doubling each time)
//
//  The final upsampled texture is returned as a WebGLTexture
//  to be composited over the scene in the main composite pass.
//
//  Each step uses a dedicated RenderTarget so passes can be
//  chained without aliasing.
// ============================================================

import { RenderTarget } from "./RenderTarget";
import { ShaderProgram } from "./ShaderProgram";
import {
  POST_VERT,
  BLOOM_THRESH_FRAG,
  KAWASE_DOWN_FRAG,
  KAWASE_UP_FRAG,
} from "./Shaders";

const STEPS = 5; // down + up passes each; gives a smooth wide bloom

export interface BloomConfig {
  /** Luminance threshold for extraction [0,1]. Default 0.55. */
  threshold: number;
  /** Blur spread multiplier. Default 1. */
  scatter: number;
}

export class BloomPipeline {
  private readonly gl: WebGL2RenderingContext;

  private readonly shThreshold: ShaderProgram;
  private readonly shDown: ShaderProgram;
  private readonly shUp: ShaderProgram;

  /** Single full-res target for threshold extraction */
  private threshRT: RenderTarget;
  /** Progressively half-res targets for the down chain */
  private downChain: RenderTarget[];
  /** Progressively double-res targets for the up chain */
  private upChain: RenderTarget[];

  public config: BloomConfig;

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config: Partial<BloomConfig> = {},
  ) {
    this.gl = gl;
    this.config = { threshold: 0.55, scatter: 1, ...config };

    // ── Compile shaders ────────────────────────────────────
    this.shThreshold = new ShaderProgram(
      gl,
      "bloom_thresh",
      POST_VERT,
      BLOOM_THRESH_FRAG,
    );
    this.shDown = new ShaderProgram(
      gl,
      "kawase_down",
      POST_VERT,
      KAWASE_DOWN_FRAG,
    );
    this.shUp = new ShaderProgram(gl, "kawase_up", POST_VERT, KAWASE_UP_FRAG);

    // ── Allocate render targets ────────────────────────────
    this.threshRT = null!;
    this.downChain = [];
    this.upChain = [];
    this._buildTargets(width, height);
  }

  // ── Private helpers ───────────────────────────────────────

  private _buildTargets(w: number, h: number): void {
    const gl = this.gl;
    const opts = { filter: "linear" as const };

    // Dispose old targets if resizing
    this.threshRT?.dispose();
    this.downChain.forEach((rt) => rt.dispose());
    this.upChain.forEach((rt) => rt.dispose());

    this.threshRT = new RenderTarget(gl, w, h, opts);
    this.downChain = [];
    this.upChain = [];

    for (let i = 0; i < STEPS; i++) {
      const scale = 1 << (i + 1); // 2, 4, 8, 16, 32
      const sw = Math.max(1, w >> scale);
      const sh = Math.max(1, h >> scale);
      this.downChain.push(new RenderTarget(gl, sw, sh, opts));
      this.upChain.push(new RenderTarget(gl, sw, sh, opts));
    }
  }

  /**
   * Run the full bloom pipeline.
   *
   * @param sceneTexture  Colour texture from the main scene render target
   * @returns             Bloom texture to be composited over the scene
   */
  process(sceneTexture: WebGLTexture): WebGLTexture {
    const gl = this.gl;

    // ── 1. Threshold pass ─────────────────────────────────
    this.threshRT.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.shThreshold
      .use()
      .setTexture("u_scene", 0, sceneTexture)
      .setFloat("u_threshold", this.config.threshold);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── 2. Kawase downsample chain ─────────────────────────
    // threshRT → down[0] → down[1] → … → down[STEPS-1]
    let srcTex = this.threshRT.texture;
    let srcW = this.threshRT.width;
    let srcH = this.threshRT.height;

    for (let i = 0; i < STEPS; i++) {
      const target = this.downChain[i];
      target.bind();
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.shDown
        .use()
        .setTexture("u_src", 0, srcTex)
        .setVec2("u_texelSize", 1 / srcW, 1 / srcH)
        .setFloat("u_offset", i * this.config.scatter);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      srcTex = target.texture;
      srcW = target.width;
      srcH = target.height;
    }

    // ── 3. Kawase upsample chain ──────────────────────────
    // down[STEPS-1] → up[STEPS-1] → … → up[0]
    // up[0] is the final bloom texture at (near) full resolution.
    srcTex = this.downChain[STEPS - 1].texture;
    srcW = this.downChain[STEPS - 1].width;
    srcH = this.downChain[STEPS - 1].height;

    for (let i = STEPS - 1; i >= 0; i--) {
      const target = this.upChain[i];
      target.bind();
      gl.clear(gl.COLOR_BUFFER_BIT);

      // Blend upsampled result with the corresponding downsample level
      // to preserve detail at each scale.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // additive blend for accumulation

      this.shUp
        .use()
        .setTexture("u_src", 0, srcTex)
        .setVec2("u_texelSize", 1 / srcW, 1 / srcH)
        .setFloat("u_offset", (STEPS - 1 - i) * this.config.scatter);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.disable(gl.BLEND);

      srcTex = target.texture;
      srcW = target.width;
      srcH = target.height;
    }

    // Return the final upsampled bloom texture (up[0])
    return this.upChain[0].texture;
  }

  resize(w: number, h: number): void {
    this._buildTargets(w, h);
  }

  dispose(): void {
    this.shThreshold.dispose();
    this.shDown.dispose();
    this.shUp.dispose();
    this.threshRT.dispose();
    this.downChain.forEach((rt) => rt.dispose());
    this.upChain.forEach((rt) => rt.dispose());
  }
}
