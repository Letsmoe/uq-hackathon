import { Application, Graphics } from 'pixi.js';
import type { PageEntry } from './chart';
import { getScanLineY, getCurrentPageDir } from './chart';
import { PALETTE } from './noteTextures';

/** Beam weight, matching the design system's thick rule. */
const BEAM_HEIGHT = 6;
const MARKER_COUNT = 14;
const MARKER_SIZE = 12;

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

    this.gfx.clear();
    this.drawBeam(scanY, activeBoost);
    this.drawMarkers(scanY);
    this.drawDirectionCaps(scanY);
  }

  /** The beam is a rule, not a glow: solid black, full bleed, no falloff. */
  private drawBeam(scanY: number, activeBoost: number) {
    const height = BEAM_HEIGHT + activeBoost * 2;

    this.gfx.rect(0, scanY - height / 2, this.W, height);
    this.gfx.fill({ color: PALETTE.ink, alpha: 1 });
  }

  /** Accent blocks punched along the beam, marking the lanes. */
  private drawMarkers(scanY: number) {
    const spacing = this.W / MARKER_COUNT;
    const half = MARKER_SIZE / 2;

    for (let i = 0; i <= MARKER_COUNT; i++) {
      const x = i * spacing;
      this.gfx.rect(x - half, scanY - half, MARKER_SIZE, MARKER_SIZE);
      this.gfx.fill({ color: PALETTE.accent, alpha: 1 });
    }
  }

  /** Travel direction, marked at both ends. */
  private drawDirectionCaps(scanY: number) {
    const size = 12;
    const tip = this._dir === -1 ? scanY + size : scanY - size;

    for (const edgeX of [26, this.W - 26]) {
      this.gfx.poly([edgeX, tip, edgeX - size, scanY, edgeX + size, scanY]);
      this.gfx.fill({ color: PALETTE.ink, alpha: 1 });
    }
  }

  get scanY()      { return this._scanY; }
  get scanDir()    { return this._dir; }
  get scanPixelY() { return this.PLAY_TOP + this._scanY * this.PLAY_H; }

  resize(w: number, h: number) { this.W = w; this.H = h; }
  destroy() { this.gfx.destroy(); }
}