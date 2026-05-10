import { Application, Graphics } from 'pixi.js';
import type { PageEntry } from './chart';
import { getScanLineY, getCurrentPageDir } from './chart';

export class Scanner {
  private gfx: Graphics;
  private _scanY = 0;
  private _dir = -1;
  W: number;
  H: number;
  private PLAY_TOP = 0;
  private PLAY_H: number;

  constructor(app: Application) {
    this.W = app.screen.width;
    this.H = app.screen.height;
    this.PLAY_H = this.H;
    this.gfx = new Graphics();
    app.stage.addChild(this.gfx);
  }

  setPlayArea(top: number, playH: number) {
    this.PLAY_TOP = top;
    this.PLAY_H = playH;
  }

  update(
    elapsed: number,
    pageList: PageEntry[],
    bpm: number,
    timeBase: number,
    activeBoost = 0,
  ) {
    this._scanY = getScanLineY(elapsed, pageList, bpm, timeBase);
    this._dir   = getCurrentPageDir(elapsed, pageList, bpm, timeBase);

    const scanY = this.PLAY_TOP + this._scanY * this.PLAY_H;
    const pulse  = 0.85 + 0.15 * Math.sin(elapsed * 2.8);
    const bright = pulse * (1 + activeBoost * 0.4);

    // accent-blue: 0x3e9bff  accent-cyan: 0x00d4e8
    this.gfx.clear();

    // Wide halo
    this.gfx.rect(0, scanY - 20, this.W, 40);
    this.gfx.fill({ color: 0x3e9bff, alpha: 0.04 * bright });

    // Mid band
    this.gfx.rect(0, scanY - 6, this.W, 12);
    this.gfx.fill({ color: 0x3e9bff, alpha: 0.14 * bright });

    // Core line
    this.gfx.rect(0, scanY - 1, this.W, 2);
    this.gfx.fill({ color: 0x00d4e8, alpha: 0.85 * bright });

    // Direction arrows (small, clean)
    const a = 8;
    if (this._dir === -1) {
      this.gfx.poly([16, scanY, 10, scanY - a, 22, scanY - a]);
      this.gfx.fill({ color: 0x00d4e8, alpha: 0.6 * bright });
      this.gfx.poly([this.W - 16, scanY, this.W - 10, scanY - a, this.W - 22, scanY - a]);
      this.gfx.fill({ color: 0x00d4e8, alpha: 0.6 * bright });
    } else {
      this.gfx.poly([16, scanY, 10, scanY + a, 22, scanY + a]);
      this.gfx.fill({ color: 0x00d4e8, alpha: 0.6 * bright });
      this.gfx.poly([this.W - 16, scanY, this.W - 10, scanY + a, this.W - 22, scanY + a]);
      this.gfx.fill({ color: 0x00d4e8, alpha: 0.6 * bright });
    }

    // Tick marks — small diamonds
    const spacing = this.W / 16;
    const offset  = (elapsed * 18) % spacing;
    for (let i = -1; i <= 17; i++) {
      const tx = i * spacing + offset;
      const ts = 3;
      this.gfx.poly([tx, scanY - ts, tx + ts, scanY, tx, scanY + ts, tx - ts, scanY]);
      this.gfx.fill({ color: 0xe8e8ee, alpha: 0.22 * bright });
    }
  }

  get scanY()      { return this._scanY; }
  get scanDir()    { return this._dir; }
  get scanPixelY() { return this.PLAY_TOP + this._scanY * this.PLAY_H; }

  resize(w: number, h: number) { this.W = w; this.H = h; }
  destroy() { this.gfx.destroy(); }
}