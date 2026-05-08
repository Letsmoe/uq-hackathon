// ============================================================
//  SpriteBatch.ts — Instanced quad renderer
//
//  Uses WebGL2 instanced drawing: a single unit quad mesh is
//  uploaded once; per-sprite transform / UV / colour data is
//  passed as instance attributes.  A full batch (MAX sprites)
//  is drawn in a single draw call.
//
//  Vertex attribute layout (fixed locations via GLSL layout):
//    location 0 – a_quad      vec2  per-vertex  quad corner [0,1]
//    location 1 – a_transform vec4  per-instance [x, y, w, h]
//    location 2 – a_uv        vec4  per-instance [u0,v0,u1,v1]
//    location 3 – a_color     vec4  per-instance [r,g,b,a]
//    location 4 – a_extra     vec2  per-instance [custom0, custom1]
//
//  All game-layer shaders share this exact layout so one VAO
//  works with any of them.
// ============================================================

import type { Rect, UVRect, RGBA, UV_FULL } from "./types";

// Per-instance stride: (4 + 4 + 4 + 2) = 14 floats × 4 bytes = 56 bytes
const FLOATS_PER_INSTANCE = 14;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

export class SpriteBatch {
  static readonly MAX = 8192;

  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadVBO: WebGLBuffer; // Static unit quad positions
  private readonly instanceVBO: WebGLBuffer; // Dynamic per-instance data
  private readonly ebo: WebGLBuffer; // Shared 6-index quad IBO
  private readonly data: Float32Array;

  private count = 0;

  /** Total sprites flushed this frame (for stats). Reset externally. */
  totalFlushed = 0;
  /** Total draw calls issued this frame. Reset externally. */
  totalDrawCalls = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.data = new Float32Array(SpriteBatch.MAX * FLOATS_PER_INSTANCE);

    this.vao = gl.createVertexArray()!;
    this.quadVBO = gl.createBuffer()!;
    this.instanceVBO = gl.createBuffer()!;
    this.ebo = gl.createBuffer()!;

    gl.bindVertexArray(this.vao);

    // ── Static unit quad: 4 corners in [0,1]×[0,1] ───────
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    // location 0 — a_quad (per-vertex, divisor=0 default)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // no gl.vertexAttribDivisor needed (divisor=0 is the default)

    // ── Instance buffer ───────────────────────────────────
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      SpriteBatch.MAX * BYTES_PER_INSTANCE,
      gl.DYNAMIC_DRAW,
    );

    const s = BYTES_PER_INSTANCE;
    const setupInstanced = (loc: number, size: number, offset: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, s, offset);
      gl.vertexAttribDivisor(loc, 1); // advance once per instance
    };

    setupInstanced(1, 4, 0); // a_transform [x,y,w,h]   offset 0
    setupInstanced(2, 4, 16); // a_uv        [u0,v0,u1,v1] offset 16
    setupInstanced(3, 4, 32); // a_color     [r,g,b,a]    offset 32
    setupInstanced(4, 2, 48); // a_extra     [c0,c1]      offset 48

    // ── Shared IBO: indices for one quad (0,1,2,2,3,0) ────
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint8Array([0, 1, 2, 2, 3, 0]),
      gl.STATIC_DRAW,
    );

    gl.bindVertexArray(null);
  }

  // ── Drawing API ───────────────────────────────────────────

  /**
   * Stage one sprite.  Returns `false` and auto-flushes if the batch is full.
   * Caller must have called `shader.use()` + set projection before the first
   * `push()` of each batch group (or just call `flush()` explicitly first).
   *
   * @param rect   Screen-space rect (logical pixels, top-left origin)
   * @param uv     Texture UV rect [0,1]
   * @param color  RGBA tint [0,1] each channel
   * @param extra  Two free float channels for shader-specific data
   *               (e.g. glow strength, hold progress, scanner intensity)
   */
  push(
    rect: Rect,
    uv: UVRect = { u0: 0, v0: 0, u1: 1, v1: 1 },
    color: RGBA = [1, 1, 1, 1],
    extra: [number, number] = [0, 0],
  ): void {
    if (this.count >= SpriteBatch.MAX) {
      // Batch is full — caller should flush before pushing more.
      console.warn("SpriteBatch: exceeded MAX, sprite dropped");
      return;
    }
    const b = this.count * FLOATS_PER_INSTANCE;
    const d = this.data;
    // a_transform
    d[b] = rect.x;
    d[b + 1] = rect.y;
    d[b + 2] = rect.w;
    d[b + 3] = rect.h;
    // a_uv
    d[b + 4] = uv.u0;
    d[b + 5] = uv.v0;
    d[b + 6] = uv.u1;
    d[b + 7] = uv.v1;
    // a_color
    d[b + 8] = color[0];
    d[b + 9] = color[1];
    d[b + 10] = color[2];
    d[b + 11] = color[3];
    // a_extra
    d[b + 12] = extra[0];
    d[b + 13] = extra[1];
    this.count++;
  }

  /**
   * Upload instance data to the GPU and issue one instanced draw call.
   * The caller is responsible for:
   *   - calling `shader.use()` before flush
   *   - setting all required uniforms (u_proj, u_time, etc.)
   *   - binding the correct texture (if any)
   */
  flush(): void {
    if (this.count === 0) return;
    const gl = this.gl;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    // Only upload the live portion of the buffer
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.data,
      0,
      this.count * FLOATS_PER_INSTANCE,
    );
    gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, this.count);
    gl.bindVertexArray(null);

    this.totalFlushed += this.count;
    this.totalDrawCalls += 1;
    this.count = 0;
  }

  /** Discard any un-flushed sprites without issuing a draw call. */
  discard(): void {
    this.count = 0;
  }

  get pending(): number {
    return this.count;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quadVBO);
    gl.deleteBuffer(this.instanceVBO);
    gl.deleteBuffer(this.ebo);
  }
}
