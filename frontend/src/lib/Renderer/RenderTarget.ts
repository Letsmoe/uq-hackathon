// ============================================================
//  RenderTarget.ts — Framebuffer Object (FBO) abstraction
//
//  Wraps a WebGL2 FBO + colour attachment texture so render
//  passes can target off-screen buffers and read them back
//  as samplers in subsequent passes.
// ============================================================

export interface RenderTargetOptions {
  /**
   * Use RGBA16F (half-float) for HDR rendering.
   * Requires EXT_color_buffer_float. Falls back to RGBA8 if unavailable.
   */
  hdr?: boolean;
  /** Attach a DEPTH_COMPONENT24 renderbuffer (not needed for 2-D games). */
  depth?: boolean;
  /** Texture filtering. Default: 'linear'. */
  filter?: "linear" | "nearest";
  /** Texture wrapping. Default: 'clamp'. */
  wrap?: "clamp" | "repeat";
}

export class RenderTarget {
  private readonly gl: WebGL2RenderingContext;
  public readonly fbo: WebGLFramebuffer;
  public readonly texture: WebGLTexture;
  private depthRBO: WebGLRenderbuffer | null = null;

  public width: number;
  public height: number;

  private readonly opts: Required<RenderTargetOptions>;
  private readonly isHDR: boolean;

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    options: RenderTargetOptions = {},
  ) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.opts = {
      hdr: options.hdr ?? false,
      depth: options.depth ?? false,
      filter: options.filter ?? "linear",
      wrap: options.wrap ?? "clamp",
    };

    // Check float-texture support if HDR requested
    this.isHDR = this.opts.hdr && !!gl.getExtension("EXT_color_buffer_float");
    if (this.opts.hdr && !this.isHDR) {
      console.warn(
        "RenderTarget: EXT_color_buffer_float not available, using RGBA8",
      );
    }

    this.fbo = gl.createFramebuffer()!;
    this.texture = gl.createTexture()!;
    this._allocate();
  }

  // ── Internal allocation ───────────────────────────────────

  private _allocate(): void {
    const gl = this.gl;
    const { filter, wrap } = this.opts;
    const internalFmt = this.isHDR ? gl.RGBA16F : gl.RGBA8;
    const pixelType = this.isHDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const glFilter = filter === "linear" ? gl.LINEAR : gl.NEAREST;
    const glWrap = wrap === "clamp" ? gl.CLAMP_TO_EDGE : gl.REPEAT;

    // ── Colour texture ────────────────────────────────────
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFmt,
      this.width,
      this.height,
      0,
      gl.RGBA,
      pixelType,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, glWrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, glWrap);

    // ── FBO ───────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.texture,
      0,
    );

    // ── Optional depth renderbuffer ───────────────────────
    if (this.opts.depth) {
      if (!this.depthRBO) this.depthRBO = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRBO);
      gl.renderbufferStorage(
        gl.RENDERBUFFER,
        gl.DEPTH_COMPONENT24,
        this.width,
        this.height,
      );
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.RENDERBUFFER,
        this.depthRBO,
      );
    }

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("RenderTarget: framebuffer incomplete");
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ── Public API ────────────────────────────────────────────

  /** Bind this FBO as the current render target and set the viewport. */
  bind(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
  }

  /** Resize the colour attachment (and depth, if present). No-op if unchanged. */
  resize(w: number, h: number): void {
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;

    const gl = this.gl;
    const internalFmt = this.isHDR ? gl.RGBA16F : gl.RGBA8;
    const pixelType = this.isHDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFmt,
      w,
      h,
      0,
      gl.RGBA,
      pixelType,
      null,
    );

    if (this.depthRBO) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRBO);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Bind the default (canvas) framebuffer.
   * Pass physical pixel dimensions to set the viewport correctly.
   */
  static bindDefault(
    gl: WebGL2RenderingContext,
    physW: number,
    physH: number,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, physW, physH);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteFramebuffer(this.fbo);
    if (this.depthRBO) gl.deleteRenderbuffer(this.depthRBO);
  }
}
