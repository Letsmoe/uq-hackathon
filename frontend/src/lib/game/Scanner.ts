import { Application, Graphics } from 'pixi.js'

// Uses Graphics instead of a Filter+Sprite so there's no worldAlpha issue.
// Graphics.clear() + draw each frame is still GPU-accelerated via PixiJS's
// WebGL batch renderer.

export class Scanner {
  private gfx    : Graphics
  private _scanY : number  = 0
  private _dir   : 1 | -1 = 1
  private _sweep : number  = 0
  private W      : number
  private H      : number

  constructor(
    private app          : Application,
    private sweepDuration: number,
  ) {
    this.W   = app.screen.width
    this.H   = app.screen.height
    this.gfx = new Graphics()
    app.stage.addChild(this.gfx)
  }

  update(elapsed: number, activeBoost = 0) {
    const progress = (elapsed % this.sweepDuration) / this.sweepDuration
    this._sweep    = Math.floor(elapsed / this.sweepDuration)
    const even     = this._sweep % 2 === 0
    this._scanY    = even ? progress : 1 - progress
    this._dir      = even ? 1 : -1

    const scanY  = this._scanY * this.H
    const pulse  = 0.85 + 0.15 * Math.sin(elapsed / 1000 * 2.8)
    const bright = pulse * (1 + activeBoost * 0.4)

    this.gfx.clear()

    // Wide outer halo
    this.gfx.rect(0, scanY - 24, this.W, 48)
    this.gfx.fill({ color: 0x6633cc, alpha: 0.06 * bright })

    // Mid glow
    this.gfx.rect(0, scanY - 10, this.W, 20)
    this.gfx.fill({ color: 0x8855ee, alpha: 0.18 * bright })

    // Inner glow
    this.gfx.rect(0, scanY - 4, this.W, 8)
    this.gfx.fill({ color: 0xaa77ff, alpha: 0.45 * bright })

    // Core line
    this.gfx.rect(0, scanY - 1, this.W, 2)
    this.gfx.fill({ color: 0xddbbff, alpha: 0.90 * bright })

    // Scrolling diamond tick marks along the core line
    const tickSpacing = this.W / 12
    const tickOffset  = ((elapsed / 1000) * 20) % tickSpacing
    for (let i = -1; i <= 12; i++) {
      const tx = i * tickSpacing + tickOffset
      const ts = 5
      // diamond: two triangles
      this.gfx.poly([tx, scanY - ts, tx + ts, scanY, tx, scanY + ts, tx - ts, scanY])
      this.gfx.fill({ color: 0xffffff, alpha: 0.35 * bright })
    }
  }

  get scanY()   { return this._scanY }
  get scanDir() { return this._dir   }
  get sweep()   { return this._sweep }

  notePixelY(noteTime: number, H: number): number {
    const sweep    = Math.floor(noteTime / this.sweepDuration)
    const progress = (noteTime % this.sweepDuration) / this.sweepDuration
    return (sweep % 2 === 0 ? progress : 1 - progress) * H
  }

  noteSweepIndex(noteTime: number): number {
    return Math.floor(noteTime / this.sweepDuration)
  }

  resize(w: number, h: number) {
    this.W = w
    this.H = h
  }

  destroy() {
    this.gfx.destroy();
  }
}
