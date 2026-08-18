import { Application, Graphics } from 'pixi.js';
import type { PageEntry } from './chart';
import { getScanLineY, getCurrentPageDir } from './chart';
import { PALETTE } from './noteTextures';

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
    const pulse  = 0.9 + 0.1 * Math.sin(elapsed * 2.8);
    const bright = pulse * (1 + activeBoost * 0.4);

    this.gfx.clear();

    // Soft bloom. Stacked bands rather than one wide fill so the falloff
    // reads as a glow against the pale playfield instead of a grey slab.
    for (let i = 4; i >= 1; i--) {
      const halfHeight = i * 9;
      this.gfx.rect(0, scanY - halfHeight, this.W, halfHeight * 2);
      this.gfx.fill({ color: PALETTE.scanline, alpha: 0.09 * bright });
    }

    // Accent fringe gives the beam an edge on a light background.
    this.gfx.rect(0, scanY - 7, this.W, 14);
    this.gfx.fill({ color: PALETTE.accent, alpha: 0.1 * bright });

    // Core
    this.gfx.rect(0, scanY - 1.5, this.W, 3);
    this.gfx.fill({ color: PALETTE.scanline, alpha: bright });

    // Static diamond markers along the beam.
    const spacing = this.W / 14;
    for (let i = 0; i <= 14; i++) {
      const tx = i * spacing;
      const size = 5;
      this.gfx.poly([tx, scanY - size, tx + size, scanY, tx, scanY + size, tx - size, scanY]);
      this.gfx.fill({ color: PALETTE.scanline, alpha: 0.95 * bright });
      this.gfx.poly([tx, scanY - size, tx + size, scanY, tx, scanY + size, tx - size, scanY]);
      this.gfx.stroke({ width: 1, color: PALETTE.accent, alpha: 0.35 * bright });
    }

    // Travel direction, marked at both ends.
    const arrow = 9;
    const tip = this._dir === -1 ? scanY + arrow : scanY - arrow;
    for (const edgeX of [26, this.W - 26]) {
      this.gfx.poly([edgeX, tip, edgeX - arrow, scanY, edgeX + arrow, scanY]);
      this.gfx.fill({ color: PALETTE.accent, alpha: 0.55 * bright });
    }
  }

  get scanY()      { return this._scanY; }
  get scanDir()    { return this._dir; }
  get scanPixelY() { return this.PLAY_TOP + this._scanY * this.PLAY_H; }

  resize(w: number, h: number) { this.W = w; this.H = h; }
  destroy() { this.gfx.destroy(); }
}