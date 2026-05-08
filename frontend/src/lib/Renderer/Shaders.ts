// ============================================================
//  shaders.ts — All GLSL 3.00 ES shader sources
//
//  Two families:
//    GAME_*   – use the instanced SpriteBatch vertex layout
//    POST_*   – post-processing, use the full-screen triangle
//               vertex shader (no buffer needed — gl_VertexID)
// ============================================================

// ── Shared game-layer vertex shader ──────────────────────────
// All game shaders share this vertex stage.  Fragment shaders
// are swapped out per-layer.
//
// Fixed attribute locations (must match SpriteBatch setup):
//   0  a_quad      vec2  unit quad corner [0,1]
//   1  a_transform vec4  [x, y, w, h]  top-left + size
//   2  a_uv        vec4  [u0, v0, u1, v1]
//   3  a_color     vec4  [r, g, b, a]
//   4  a_extra     vec2  shader-specific floats
export const GAME_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_quad;
layout(location = 1) in vec4 a_transform;
layout(location = 2) in vec4 a_uv;
layout(location = 3) in vec4 a_color;
layout(location = 4) in vec2 a_extra;

out vec2 v_uv;
out vec4 v_color;
out vec2 v_extra;

uniform mat4 u_proj;

void main() {
  // Map unit quad corner into world space
  vec2 pos    = a_transform.xy + a_quad * a_transform.zw;
  gl_Position = u_proj * vec4(pos, 0.0, 1.0);

  // Interpolate UV across the quad
  v_uv    = a_uv.xy + a_quad * (a_uv.zw - a_uv.xy);
  v_color = a_color;
  v_extra = a_extra;
}`;

// ── Sprite (textured / solid rect) ───────────────────────────
export const SPRITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in vec2 v_extra;

uniform sampler2D u_texture;
uniform bool      u_useTexture;

out vec4 fragColor;

void main() {
  vec4 tex    = u_useTexture ? texture(u_texture, v_uv) : vec4(1.0);
  fragColor   = tex * v_color;
}`;

// ── Note (SDF circle with proximity glow) ────────────────────
// a_extra.x = glow   [0,1]  scanner proximity
// a_extra.y = approachT [1→0]  approach ring scale (0 = no ring)
export const NOTE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in vec2 v_extra;

out vec4 fragColor;

void main() {
  vec2  uv   = v_uv * 2.0 - 1.0;          // [-1,1]
  float d    = length(uv);
  float glow = v_extra.x;
  float apT  = v_extra.y;                  // approach ring thickness scale

  // ── Outer ring ───────────────────────────────────────────
  float ring = smoothstep(1.05, 0.90, d) * smoothstep(0.68, 0.82, d);

  // ── Inner glow fill ───────────────────────────────────────
  float inner = smoothstep(0.70, 0.0, d) * 0.30;

  // ── Specular highlight ────────────────────────────────────
  float spec = smoothstep(0.22, 0.0, length(uv - vec2(-0.30, -0.30)));

  // ── Proximity bloom (additive; leaks into surrounding px) ─
  float bloom = exp(-d * d * 2.5) * glow * 0.55;

  // ── Approach ring (shrinks from apT→0 as scanner nears) ───
  float approachD = abs(d - (0.95 + apT * 1.8)) / (0.06 + apT * 0.1);
  float approachR = smoothstep(1.0, 0.0, approachD) * step(0.001, apT) * 0.55;

  float alpha = (ring + inner + spec * 0.5 + approachR) * v_color.a;
  vec3  col   = v_color.rgb * (1.0 + bloom * 1.4);

  fragColor = vec4(col, alpha);
}`;

// ── Hold-note body (vertical pill) ───────────────────────────
// a_extra.x = progress [0,1] filled by scanner
export const HOLD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in vec2 v_extra;

out vec4 fragColor;

void main() {
  float prog = v_extra.x;

  // Soft left / right edges
  float ex   = smoothstep(0.0, 0.14, v_uv.x) * smoothstep(0.0, 0.14, 1.0 - v_uv.x);

  // Filled portion (from the start end toward the end)
  float filled = step(1.0 - v_uv.y, prog);

  float alpha = ex * (0.32 + filled * 0.32) * v_color.a;
  vec3  col   = v_color.rgb * (0.75 + filled * 0.5);

  // Bright leading edge at the fill frontier
  float edge  = exp(-abs(v_uv.y - (1.0 - prog)) * 60.0) * ex;
  col  += v_color.rgb * edge * 1.2;
  alpha = max(alpha, edge * ex * v_color.a * 0.9);

  fragColor = vec4(col, alpha);
}`;

// ── Scanner line ──────────────────────────────────────────────
// a_extra.x = intensity [0,1] flash after a hit
export const SCANNER_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in vec2 v_extra;

out vec4 fragColor;

void main() {
  float cy      = v_uv.y - 0.5;           // 0 = centre, ±0.5 = edges
  float norm    = abs(cy) * 2.0;           // 0→1

  // Core line (very tight gaussian)
  float line  = exp(-norm * norm * 140.0);

  // Inner glow band
  float glow  = exp(-norm * norm * 20.0) * 0.45;

  // Hit flash bloom
  float flash = exp(-norm * norm * 5.0) * v_extra.x * 0.5;

  // X-axis fade near lane borders
  float xFade = smoothstep(0.0, 0.015, v_uv.x)
              * smoothstep(0.0, 0.015, 1.0 - v_uv.x);

  float alpha = (line + glow + flash) * v_color.a * xFade;
  vec3  col   = v_color.rgb * (1.0 + flash * 1.8);

  fragColor = vec4(col, alpha);
}`;

// ── Lane backdrop ─────────────────────────────────────────────
// a_extra.x = scroll (0-1 normalised)
export const LANE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
in vec2 v_extra;

uniform float u_time;

out vec4 fragColor;

void main() {
  float scroll = v_extra.x;

  // Scrolling grid lines
  float sy     = fract(v_uv.y + scroll);
  float gridY  = abs(fract(sy * 14.0 + 0.5) - 0.5) * 2.0;
  float lineY  = smoothstep(0.90, 0.98, gridY);

  // Subtle diagonal shimmer
  float shimmer = 0.03 * sin((v_uv.x - v_uv.y * 0.4 + u_time * 0.08) * 18.0);

  // Edge fades
  float ex = smoothstep(0.0, 0.04, v_uv.x) * smoothstep(0.0, 0.04, 1.0 - v_uv.x);
  float ey = smoothstep(0.0, 0.02, v_uv.y) * smoothstep(0.0, 0.02, 1.0 - v_uv.y);

  vec3  col   = v_color.rgb * (0.45 + lineY * 0.55 + shimmer);
  float alpha = v_color.a * ex * ey * 0.60;

  fragColor = vec4(col, alpha);
}`;

// ============================================================
//  POST-PROCESSING SHADERS
//  These use a full-screen triangle (no vertex buffer).
//  gl_VertexID → NDC position; UV derived from NDC.
// ============================================================

export const POST_VERT = /* glsl */ `#version 300 es

out vec2 v_uv;

void main() {
  // Full-screen triangle using gl_VertexID
  //   ID 0 → (-1,-1)    ID 1 → (3,-1)    ID 2 → (-1,3)
  float x = float((gl_VertexID & 1) << 2) - 1.0;
  float y = float((gl_VertexID & 2) << 1) - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);

  // UV [0,1] in the visible quad [-1,1]
  v_uv = vec2(x * 0.5 + 0.5, y * 0.5 + 0.5);
}`;

// ── Bloom threshold extraction ────────────────────────────────
export const BLOOM_THRESH_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;

uniform sampler2D u_scene;
uniform float     u_threshold;

out vec4 fragColor;

void main() {
  vec3  col        = texture(u_scene, v_uv).rgb;
  float brightness = dot(col, vec3(0.2126, 0.7152, 0.0722));

  // Soft knee: smooth roll-off around the threshold
  float knee = u_threshold * 0.12;
  float rq   = clamp(brightness - u_threshold + knee, 0.0, 2.0 * knee);
  rq         = (rq * rq) / (4.0 * knee + 1e-5);
  float w    = max(rq, brightness - u_threshold) / max(brightness, 1e-5);

  fragColor  = vec4(col * w, 1.0);
}`;

// ── Kawase downsample ─────────────────────────────────────────
// One iteration of the dual-kawase blur (4 taps).
// u_offset increases each iteration for wider blur.
export const KAWASE_DOWN_FRAG = /* glsl */ `#version 300 es
precision mediump float;
in vec2 v_uv;

uniform sampler2D u_src;
uniform vec2      u_texelSize;  // 1 / (src width, src height)
uniform float     u_offset;     // 0.5 on first iteration, increases

out vec4 fragColor;

void main() {
  vec2 off = (0.5 + u_offset) * u_texelSize;
  vec4 sum  = texture(u_src, v_uv + vec2(-off.x,  off.y));
       sum += texture(u_src, v_uv + vec2( off.x,  off.y));
       sum += texture(u_src, v_uv + vec2( off.x, -off.y));
       sum += texture(u_src, v_uv + vec2(-off.x, -off.y));
  fragColor = sum * 0.25;
}`;

// ── Kawase upsample ───────────────────────────────────────────
// One iteration of the dual-kawase blur (8 taps bilinear).
export const KAWASE_UP_FRAG = /* glsl */ `#version 300 es
precision mediump float;
in vec2 v_uv;

uniform sampler2D u_src;
uniform vec2      u_texelSize;
uniform float     u_offset;

out vec4 fragColor;

void main() {
  vec2 o  = (0.5 + u_offset) * u_texelSize;
  vec4 s  = vec4(0.0);
  s += texture(u_src, v_uv + vec2(-2.0 * o.x, 0.0));
  s += texture(u_src, v_uv + vec2(-o.x,  o.y)) * 2.0;
  s += texture(u_src, v_uv + vec2(0.0,   2.0 * o.y));
  s += texture(u_src, v_uv + vec2( o.x,  o.y)) * 2.0;
  s += texture(u_src, v_uv + vec2( 2.0 * o.x, 0.0));
  s += texture(u_src, v_uv + vec2( o.x, -o.y)) * 2.0;
  s += texture(u_src, v_uv + vec2(0.0,  -2.0 * o.y));
  s += texture(u_src, v_uv + vec2(-o.x, -o.y)) * 2.0;
  fragColor = s / 12.0;
}`;

// ── Final composite ───────────────────────────────────────────
// scene + bloom + Reinhard tonemap + vignette + chromatic abberation + grain
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;

uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float     u_bloomIntensity;
uniform float     u_chromaStrength;   // 0=off, 1=full
uniform float     u_vignetteStrength;
uniform float     u_time;

out vec4 fragColor;

// Reinhard extended (preserves hue better than simple Reinhard)
vec3 tonemap(vec3 hdr) {
  vec3 whiteScale = vec3(1.0) / (vec3(1.0) + 1.0);
  return (hdr * (1.0 + hdr / (1.2 * 1.2))) / (1.0 + hdr);
}

void main() {
  vec2  uv    = v_uv;
  vec2  dir   = uv - 0.5;
  float dist  = length(dir);

  // ── Chromatic aberration (radial RGB split) ───────────────
  float ca    = u_chromaStrength * 0.018;
  vec2  aberr = normalize(dir + 1e-5) * dist * ca;
  float scR   = texture(u_scene, uv + aberr).r;
  float scG   = texture(u_scene, uv       ).g;
  float scB   = texture(u_scene, uv - aberr).b;
  vec3  scene = vec3(scR, scG, scB);

  // ── Bloom composite ───────────────────────────────────────
  vec3  bloom = texture(u_bloom, uv).rgb;
  vec3  hdr   = scene + bloom * u_bloomIntensity;

  // ── Tonemap ───────────────────────────────────────────────
  vec3 mapped = tonemap(hdr);

  // ── Vignette ──────────────────────────────────────────────
  float vig   = 1.0 - smoothstep(0.45, 1.35, dist * 1.9) * u_vignetteStrength;

  // ── Film grain (hash-based, varies per frame) ──────────────
  float grain = fract(
    sin(dot(uv * 1500.0, vec2(12.9898, 78.233)) + u_time * 53.27)
    * 43758.55
  );
  mapped += (grain - 0.5) * 0.012;

  fragColor = vec4(clamp(mapped * vig, 0.0, 1.0), 1.0);
}`;
