// ============================================================
//  ShaderProgram.ts — GLSL shader compilation & uniform cache
//
//  Compiles vertex + fragment shaders, links them, and
//  provides a fluent, type-safe API for setting uniforms.
//  Uniform locations are lazily queried and cached.
// ============================================================

export class ShaderProgram {
  private readonly gl: WebGL2RenderingContext;
  public readonly program: WebGLProgram;
  public readonly id: string;
  private uniformCache: Map<string, WebGLUniformLocation | null> = new Map();

  constructor(
    gl: WebGL2RenderingContext,
    id: string,
    vertSrc: string,
    fragSrc: string,
  ) {
    this.gl = gl;
    this.id = id;

    const vert = this._compile(gl.VERTEX_SHADER, vertSrc);
    const frag = this._compile(gl.FRAGMENT_SHADER, fragSrc);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`[ShaderProgram "${id}"] Link error:\n${log}`);
    }

    this.program = prog;
  }

  // ── Private helpers ───────────────────────────────────────

  private _compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(
        `[ShaderProgram "${this.id}"] ${kind} compile error:\n${log}`,
      );
    }
    return s;
  }

  private _loc(name: string): WebGLUniformLocation | null {
    if (!this.uniformCache.has(name)) {
      this.uniformCache.set(
        name,
        this.gl.getUniformLocation(this.program, name),
      );
    }
    return this.uniformCache.get(name)!;
  }

  // ── Binding ───────────────────────────────────────────────

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  // ── Uniform setters (fluent) ──────────────────────────────

  setBool(name: string, v: boolean): this {
    this.gl.uniform1i(this._loc(name), v ? 1 : 0);
    return this;
  }

  setInt(name: string, v: number): this {
    this.gl.uniform1i(this._loc(name), v);
    return this;
  }

  setFloat(name: string, v: number): this {
    this.gl.uniform1f(this._loc(name), v);
    return this;
  }

  setVec2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this._loc(name), x, y);
    return this;
  }

  setVec3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this._loc(name), x, y, z);
    return this;
  }

  setVec4(name: string, x: number, y: number, z: number, w: number): this {
    this.gl.uniform4f(this._loc(name), x, y, z, w);
    return this;
  }

  /**
   * Bind a 2-D texture to a texture unit and set the sampler uniform.
   * @param name    Uniform sampler name in the shader
   * @param unit    Texture unit index (0–15)
   * @param texture WebGL texture object
   */
  setTexture(name: string, unit: number, texture: WebGLTexture): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this._loc(name), unit);
    return this;
  }

  /**
   * Upload a column-major 4×4 matrix.
   * Pass a pre-allocated Float32Array (16 elements) for zero GC.
   */
  setMat4(name: string, mat: Float32Array): this {
    this.gl.uniformMatrix4fv(this._loc(name), false, mat);
    return this;
  }

  // ── Attribute location ────────────────────────────────────
  // Only needed when NOT using explicit layout(location=N) in GLSL.

  attrib(name: string): number {
    return this.gl.getAttribLocation(this.program, name);
  }

  // ── Lifecycle ─────────────────────────────────────────────

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}
