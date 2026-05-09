<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  let canvas: HTMLCanvasElement;

  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let animationFrame = 0;

  let startTime = performance.now();

  let mouseX = 0.5;
  let mouseY = 0.5;
  let targetMouseX = 0.5;
  let targetMouseY = 0.5;
  let mouseActive = 0;
  let targetMouseActive = 0;

  const vertexShaderSource = `
    attribute vec2 a_position;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_time;

float circle(vec2 p, float r) {
  return 1.0 - smoothstep(r, r + 0.0025, length(p));
}

float lineSegment(vec2 p, vec2 a, vec2 b, float thickness) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  float d = length(pa - ba * h);
  return 1.0 - smoothstep(thickness, thickness + 0.002, d);
}

// Perpendicular cross: +
float plusMark(vec2 p, float size, float thickness) {
  float vertical   = lineSegment(p, vec2(0.0, -size), vec2(0.0, size), thickness);
  float horizontal = lineSegment(p, vec2(-size, 0.0), vec2(size, 0.0), thickness);
  return max(vertical, horizontal);
}

// Repeating mask for dotted lines
float dotRepeat(float t, float spacing, float size) {
  float f = abs(fract(t / spacing) - 0.5);
  return 1.0 - smoothstep(size, size + 0.04, f);
}

// Major grid rendered as dotted lines
float dottedGrid(vec2 gridUv, float thickness, float dotSpacing, float dotSize) {
  vec2 cell = fract(gridUv) - 0.5;

  // Vertical line, dotted along Y
  float vertical = 1.0 - smoothstep(thickness, thickness + 0.01, abs(cell.x));
  vertical *= dotRepeat(gridUv.y, dotSpacing, dotSize);

  // Horizontal line, dotted along X
  float horizontal = 1.0 - smoothstep(thickness, thickness + 0.01, abs(cell.y));
  horizontal *= dotRepeat(gridUv.x, dotSpacing, dotSize);

  return max(vertical, horizontal);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_resolution.xy;

  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspect;

  vec2 mouse = u_mouse;
  vec2 mp = (mouse - 0.5) * aspect;

  float distToMouse = length(p - mp);
  float influence = exp(-distToMouse * 6.5) * u_mouseActive;

  vec2 dir = normalize(p - mp + 0.0001);
  p += dir * influence * 0.025;
  p += sin(vec2(p.y, p.x) * 28.0 + u_time * 0.8) * influence * 0.002;

  // Colors
  vec3 bg         = vec3(236, 234, 228) / 255.0;
  vec3 dotColor   = vec3(0.38, 0.37, 0.35);
  vec3 lineColor  = vec3(0.50, 0.49, 0.47);
  vec3 crossColor = vec3(0.13, 0.13, 0.20);
  vec3 accent     = vec3(0.24, 0.46, 1.0);

  // -----------------------------
  // Minor dot grid (small dots inside)
  // -----------------------------
  float minorScale = 64.0;
  vec2 minorGrid = p * minorScale;
  vec2 minorCell = fract(minorGrid) - 0.5;

  float dotRadius = 0.030 + influence * 0.020;
  float dots = circle(minorCell, dotRadius);

  // -----------------------------
  // Major grid (dotted lines + plus intersections)
  // -----------------------------
  float majorScale = 8.0;
  vec2 majorGrid = p * majorScale;
  vec2 majorCell = fract(majorGrid) - 0.5;

  float gridLines = dottedGrid(majorGrid, 0.003, 0.05, 0.08);

  // Clear the dotted lines near each intersection
  // so the plus mark stands out clearly
  float centerGap = smoothstep(0.05, 0.11, max(abs(majorCell.x), abs(majorCell.y)));
  gridLines *= centerGap;

  float crosses = plusMark(majorCell, 0.035, 0.003);

  // Cursor effects
  float cursorRing = 1.0 - smoothstep(0.003, 0.008, abs(distToMouse - 0.115));
  cursorRing *= u_mouseActive;

  float cursorGlow = exp(-distToMouse * 10.0) * u_mouseActive;

  // Final compositing
  vec3 color = bg;

  // Draw order: background -> minor dots -> dotted lines -> crosses
  color = mix(color, dotColor,   dots * 0.35);
  color = mix(color, lineColor,  gridLines * 0.42);
  color = mix(color, crossColor, crosses * 0.25);

  color += accent * cursorGlow * 0.12;
  color = mix(color, accent, cursorRing * 0.25);

  float vignette = smoothstep(1.0, 0.18, length((uv - 0.5) * vec2(1.25, 1.0)));
  color *= 0.94 + vignette * 0.08;

  float noise = fract(sin(dot(frag + u_time, vec2(12.9898, 78.233))) * 43758.5453);
  color += (noise - 0.5) * 0.018;

  gl_FragColor = vec4(color, 1.0);
}`;

  function createShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string,
  ): WebGLShader {
    const shader = gl.createShader(type);

    if (!shader) {
      throw new Error("Could not create shader.");
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) ?? "Unknown shader error.";
      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  function createProgram(gl: WebGLRenderingContext): WebGLProgram {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource,
    );

    const program = gl.createProgram();

    if (!program) {
      throw new Error("Could not create WebGL program.");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? "Unknown program error.";
      gl.deleteProgram(program);
      throw new Error(message);
    }

    return program;
  }

  function resizeCanvas() {
    if (!canvas || !gl) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(canvas.clientWidth * dpr);
    const height = Math.floor(canvas.clientHeight * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function handlePointerMove(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();

    targetMouseX = (event.clientX - rect.left) / rect.width;
    targetMouseY = 1.0 - (event.clientY - rect.top) / rect.height;
    targetMouseActive = 1;
  }

  function handlePointerLeave() {
    targetMouseActive = 0;
  }

  function render() {
    if (!gl || !program) return;

    resizeCanvas();

    mouseX += (targetMouseX - mouseX) * 0.12;
    mouseY += (targetMouseY - mouseY) * 0.12;
    mouseActive += (targetMouseActive - mouseActive) * 0.08;

    const time = (performance.now() - startTime) / 1000;

    gl.useProgram(program);

    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const mouseLocation = gl.getUniformLocation(program, "u_mouse");
    const mouseActiveLocation = gl.getUniformLocation(program, "u_mouseActive");
    const timeLocation = gl.getUniformLocation(program, "u_time");

    gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    gl.uniform2f(mouseLocation, mouseX, mouseY);
    gl.uniform1f(mouseActiveLocation, mouseActive);
    gl.uniform1f(timeLocation, time);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    animationFrame = requestAnimationFrame(render);
  }

  onMount(() => {
    gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      console.error("WebGL is not supported.");
      return;
    }

    program = createProgram(gl);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    const positions = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);

    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("resize", resizeCanvas);

    render();
  });

  onDestroy(() => {
    cancelAnimationFrame(animationFrame);

    canvas?.removeEventListener("pointermove", handlePointerMove);
    canvas?.removeEventListener("pointerleave", handlePointerLeave);
    window.removeEventListener("resize", resizeCanvas);
  });
</script>

<canvas bind:this={canvas} class="shader-grid" />

<style>
  .shader-grid {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: block;
    background: #ebe8df;
    cursor: crosshair;
  }
</style>
