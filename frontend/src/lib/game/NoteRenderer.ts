import {
  Application, Container, Geometry, GlProgram, Shader, Mesh, Text, TextStyle,
} from 'pixi.js'
import type { RuntimeNote, JudgmentResult } from './types'

// ─── Shaders ──────────────────────────────────────────────────────────────────

const VERT = /* glsl */`#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aUvs;

uniform float uX;
uniform float uY;
uniform float uSize;
uniform vec2  uResolution;

out vec2 vUvs;

void main(void) {
  vUvs        = aUvs;
  vec2 world  = aPosition * uSize + vec2(uX, uY);
  vec2 ndc    = (world / uResolution) * 2.0 - 1.0;
  ndc.y       = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`

const NOTE_FRAG = /* glsl */`#version 300 es
precision highp float;

in  vec2 vUvs;
out vec4 fragColor;

uniform float uTime;
uniform float uActive;
uniform vec3  uColor;
uniform float uNoteType;
uniform float uSwipeDir;
uniform float uHitFlash;

void main(void) {
  vec2  uv   = vUvs * 2.0 - 1.0;
  float dist = length(uv);
  if (dist > 1.0) discard;

  float angle     = atan(uv.y, uv.x);

  // ── Zones ──────────────────────────────────────────────────────────────────
  float ringInner = 0.64;
  float ringOuter = 0.88;

  // Smooth 0→1 weight for being inside the ring interior
  float wInner = 1.0 - smoothstep(ringInner, ringInner + 0.03, dist);
  // Smooth 0→1 weight for being on the ring band itself
  float wRing  = smoothstep(ringInner - 0.01, ringInner + 0.02, dist)
               * (1.0 - smoothstep(ringOuter - 0.01, ringOuter + 0.03, dist));
  // Weight for being outside the ring (disc fringe between ringOuter and 1.0)
  float wOuter = smoothstep(ringOuter - 0.01, ringOuter + 0.02, dist);

  // ── Tick notches (16 evenly spaced) ────────────────────────────────────────
  float tick = step(0.91, abs(cos(angle * 8.0))) * wRing;

  // ── Inner fill colour ───────────────────────────────────────────────────────
  // Very dark navy at rest, blooms to hue colour when active
  float falloff  = 1.0 - smoothstep(0.0, ringInner, dist);
  vec3  innerCol = mix(
    vec3(0.05, 0.05, 0.11),            // rest:   almost black
    uColor * (0.6 + 0.4 * falloff),    // active: hue glow
    uActive
  );
  // Add a sharp bright core
  float coreFall = 1.0 - smoothstep(0.0, 0.20, dist);
  innerCol       = mix(innerCol, vec3(1.0, 0.95, 1.0), coreFall * uActive * 0.90);

  // ── Ring colour ─────────────────────────────────────────────────────────────
  // Dark by default so it reads clearly on a light background
  vec3 ringBase  = vec3(0.15, 0.14, 0.22);   // dark navy-purple ring
  vec3 ringTick  = vec3(0.30, 0.28, 0.42);   // slightly lighter for ticks
  vec3 ringCol   = mix(ringBase, ringTick, tick);
  // Ring glows faintly with hue when active
  ringCol        = mix(ringCol, uColor * 0.85, uActive * 0.30);

  // ── Outer disc fringe (very dark, fades to transparent) ────────────────────
  vec3 outerCol  = vec3(0.08, 0.08, 0.14);

  // ── Compose with mix() – no additive overflow ───────────────────────────────
  vec3 color = outerCol;
  color      = mix(color, ringCol,  wRing);
  color      = mix(color, innerCol, wInner);

  // ── Swipe arrow ─────────────────────────────────────────────────────────────
  if (uNoteType > 1.5) {
    vec2  au    = uv * vec2(uSwipeDir, 1.0);
    float arrow = step(0.10, au.x)
                * (1.0 - smoothstep(0.0, 0.22, abs(au.y) - (au.x - 0.10)));
    color       = mix(color, uColor * 1.3, arrow * wInner * 0.75);
  }

  // ── Hit burst ───────────────────────────────────────────────────────────────
  if (uHitFlash > 0.01) {
    float ring = smoothstep(uHitFlash - 0.10, uHitFlash,        dist)
               * (1.0 - smoothstep(uHitFlash, uHitFlash + 0.05, dist));
    color = mix(color, uColor + 0.25, ring * (1.0 - uHitFlash));
  }

  // ── Alpha: solid disc with soft outer edge ───────────────────────────────────
  float alpha = 0.93 * (1.0 - smoothstep(0.90, 1.0, dist));

  fragColor = vec4(color, alpha);
}
`

const HOLD_FRAG = /* glsl */`#version 300 es
precision highp float;

in  vec2 vUvs;
out vec4 fragColor;

uniform float uProgress;
uniform float uTime;
uniform vec3  uColor;

void main(void) {
  float fill  = step(1.0 - uProgress, vUvs.y);
  float edge  = smoothstep(0.0, 0.15, vUvs.x) * (1.0 - smoothstep(0.85, 1.0, vUvs.x));
  float pulse = 0.5 + 0.5 * sin(uTime * 5.0 + vUvs.y * 10.0);
  vec3  col   = mix(uColor * 0.4, uColor, vUvs.y * uProgress);
  fragColor   = vec4(col, fill * edge * 0.55 * pulse);
}
`

// ─── Geometry — explicit format so PixiJS v8 doesn't misread the buffers ──────

function makeQuad(): Geometry {
  return new Geometry({
    attributes: {
      aPosition: {
        buffer: new Float32Array([-0.5, -0.5,  0.5, -0.5,  0.5, 0.5, -0.5, 0.5]),
        format: 'float32x2',
        stride: 8,
        offset: 0,
      },
      aUvs: {
        buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        format: 'float32x2',
        stride: 8,
        offset: 0,
      },
    },
    indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
  })
}

function makeTrail(): Geometry {
  return new Geometry({
    attributes: {
      aPosition: {
        buffer: new Float32Array([-0.1, -0.5,  0.1, -0.5,  0.1, 0.5, -0.1, 0.5]),
        format: 'float32x2',
        stride: 8,
        offset: 0,
      },
      aUvs: {
        buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        format: 'float32x2',
        stride: 8,
        offset: 0,
      },
    },
    indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
  })
}

// ─── Shader factories ─────────────────────────────────────────────────────────

const TYPE_COLOR: Record<RuntimeNote['type'], [number, number, number]> = {
  tap  : [0.40, 0.50, 1.00],
  hold : [0.55, 0.32, 1.00],
  swipe: [0.20, 0.75, 1.00],
}

function makeNoteShader(note: RuntimeNote, size: number, res: [number, number]): Shader {
  const col = TYPE_COLOR[note.type]
  return new Shader({
    glProgram: new GlProgram({ vertex: VERT, fragment: NOTE_FRAG }),
    resources: {
      uniforms: {
        uX        : { value: note.pixelX, type: 'f32'       },
        uY        : { value: note.pixelY, type: 'f32'       },
        uSize     : { value: size,        type: 'f32'       },
        uResolution:{ value: res,         type: 'vec2<f32>' },
        uTime     : { value: 0,           type: 'f32'       },
        uActive   : { value: 0,           type: 'f32'       },
        uColor    : { value: col,         type: 'vec3<f32>' },
        uNoteType : { value: note.type === 'tap' ? 0 : note.type === 'hold' ? 1 : 2, type: 'f32' },
        uSwipeDir : { value: note.swipeDir === 'left' ? -1 : 1, type: 'f32' },
        uHitFlash : { value: 0,           type: 'f32'       },
      },
    },
  })
}

function makeHoldShader(note: RuntimeNote, h: number, res: [number, number]): Shader {
  const col = TYPE_COLOR[note.type]
  return new Shader({
    glProgram: new GlProgram({ vertex: VERT, fragment: HOLD_FRAG }),
    resources: {
      uniforms: {
        uX        : { value: note.pixelX,       type: 'f32'       },
        uY        : { value: note.pixelY - h/2,  type: 'f32'       },
        uSize     : { value: h,                  type: 'f32'       },
        uResolution:{ value: res,                type: 'vec2<f32>' },
        uProgress : { value: 0,                  type: 'f32'       },
        uTime     : { value: 0,                  type: 'f32'       },
        uColor    : { value: col,                type: 'vec3<f32>' },
      },
    },
  })
}

// ─── Popups ───────────────────────────────────────────────────────────────────

interface Popup { text: Text; life: number; vy: number }

const POPUP_FILL: Record<JudgmentResult, string> = {
  perfect: '#a87cff',
  good   : '#5cb8ff',
  bad    : '#ff8c4a',
  miss   : '#ff4466',
}

// ─── NoteRenderer ─────────────────────────────────────────────────────────────

export class NoteRenderer {
  private container  : Container
  private popupLayer : Container
  private meshes     : Map<number, Mesh<Geometry, Shader>> = new Map()
  private holdMeshes : Map<number, Mesh<Geometry, Shader>> = new Map()
  private popups     : Popup[] = []
  private noteGeo    : Geometry
  private NOTE_SIZE  : number
  private RES        : [number, number]

  constructor(
    _app       : Application,
    stage      : Container,
    private W  : number,
    private H  : number,
    _lanes     = 8,
  ) {
    this.NOTE_SIZE = Math.min(W, H) * 0.10
    this.RES       = [W, H]
    this.container  = new Container()
    this.popupLayer = new Container()
    stage.addChild(this.container)
    stage.addChild(this.popupLayer)
    this.noteGeo    = makeQuad()
  }

  loadNotes(notes: RuntimeNote[]) {
    this.clearAll()
    notes.forEach(n => this.addNote(n))
  }

  private addNote(note: RuntimeNote) {
    if (note.type === 'hold' && note.holdDuration) {
      const h     = (note.holdDuration / 2000) * this.H * 0.45
      const trail = new Mesh({ geometry: makeTrail(), shader: makeHoldShader(note, h, this.RES) })
      this.container.addChildAt(trail, 0)
      this.holdMeshes.set(note.id, trail)
    }
    const mesh = new Mesh({ geometry: this.noteGeo, shader: makeNoteShader(note, this.NOTE_SIZE, this.RES) })
    this.container.addChild(mesh)
    this.meshes.set(note.id, mesh)
  }

  update(notes: RuntimeNote[], scanPixelY: number, elapsed: number, deltaMs: number) {
    for (const note of notes) {
      if (note.hit || note.missed) { this.removeMesh(note.id); continue }
      const mesh = this.meshes.get(note.id)
      if (!mesh) continue

      const u   = mesh.shader.resources.uniforms.uniforms
      const raw = Math.abs(scanPixelY - note.pixelY) / (this.H * 0.14)
      u.uActive = parseFloat(Math.max(0, 1.0 - Math.min(1.0, raw)).toFixed(4))
      u.uTime   = elapsed / 1000

      if (note.type === 'hold' && note.holdActive) {
        const hold = this.holdMeshes.get(note.id)
        if (hold) {
          hold.shader.resources.uniforms.uniforms.uProgress = note.holdProgress
          hold.shader.resources.uniforms.uniforms.uTime     = elapsed / 1000
        }
      }
    }
    this.updatePopups(deltaMs)
  }

  triggerHitFlash(noteId: number, result: JudgmentResult, x: number, y: number) {
    const mesh = this.meshes.get(noteId)
    if (mesh) mesh.shader.resources.uniforms.uniforms.uHitFlash = 0.01
    this.spawnPopup(result, x, y)
  }

  animateHitFlash(noteId: number, t: number) {
    const mesh = this.meshes.get(noteId)
    if (mesh) mesh.shader.resources.uniforms.uniforms.uHitFlash = t
  }

  private spawnPopup(result: JudgmentResult, x: number, y: number) {
    const text = new Text({
      text : result.toUpperCase(),
      style: new TextStyle({
        fontFamily   : 'sans-serif',
        fontWeight   : '300',
        fontSize     : result === 'perfect' ? 52 : 42,
        letterSpacing: 14,
        fill         : POPUP_FILL[result],
      }),
    })
    text.anchor.set(0.5)
    text.position.set(x, y)
    this.popupLayer.addChild(text)
    this.popups.push({ text, life: 700, vy: -0.10 })
  }

  private updatePopups(deltaMs: number) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p   = this.popups[i]
      p.life   -= deltaMs
      p.text.y += p.vy * deltaMs
      p.text.alpha = Math.max(0, p.life / 700)
      if (p.life <= 0) { p.text.destroy(); this.popups.splice(i, 1) }
    }
  }

  private removeMesh(id: number) {
    const m = this.meshes.get(id);     if (m) { m.destroy(true); this.meshes.delete(id)     }
    const h = this.holdMeshes.get(id); if (h) { h.destroy(true); this.holdMeshes.delete(id) }
  }

  clearAll() {
    this.container.removeChildren().forEach(c => c.destroy(true))
    this.meshes.clear()
    this.holdMeshes.clear()
  }

  destroy() {
    this.clearAll();
    this.container.destroy(true);
    this.popupLayer.destroy(true);
  }
}
