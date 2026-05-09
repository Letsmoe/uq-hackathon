import { Application } from "pixi.js";
import type { Chart, ChartNote } from "./chart";
import { tickToSeconds, getScanLineY } from "./chart";
import type {
  RuntimeNote,
  RuntimeChainNode,
  GameState,
  JudgmentEvent,
} from "./types";
import { makeInitialState, JUDGMENT_WINDOWS } from "./types";
import { Scanner } from "./Scanner";
import { NoteRenderer } from "./NoteRenderer";
import { InputHandler } from "./InputHandler";
import { JudgmentSystem } from "./Judgment";

// Must be >= NoteRenderer's APPROACH_S (1.8) so notes enter the visible list
// early enough for their full approach animation to play.
const APPROACH_S = 2.0;
const HUD_H = 0; // HUD is a CSS overlay — PixiJS uses the full canvas height

export class GameEngine {
  private app: Application;
  private W = 0;
  private H = 0;
  private PLAY_TOP = HUD_H;
  private PLAY_H = 0;

  private scanner: Scanner | null = null;
  private renderer: NoteRenderer | null = null;
  private input: InputHandler | null = null;
  private judgment: JudgmentSystem | null = null;
  private audioEl: HTMLAudioElement | null = null;

  readonly state: GameState = makeInitialState();
  private chart: Chart | null = null;
  private notes: RuntimeNote[] = [];

  onStateChange: (() => void) | null = null;
  onJudgment: ((e: JudgmentEvent) => void) | null = null;
  onFinish: (() => void) | null = null;

  private constructor(app: Application) {
    this.app = app;
  }

  static async create(canvas: HTMLCanvasElement): Promise<GameEngine> {
    const app = new Application();
    await app.init({
      canvas,
      width: canvas.offsetWidth || 1920,
      height: canvas.offsetHeight || 1080,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    const e = new GameEngine(app);
    e.W = app.screen.width;
    e.H = app.screen.height;
    e.PLAY_H = e.H - HUD_H;
    return e;
  }

  loadChart(chart: Chart) {
    this.chart = chart;

    this.scanner?.destroy();
    this.renderer?.destroy();
    this.input?.detach();

    // Scanner added to stage first; NoteRenderer inserts below it via addChildAt(0)
    this.scanner = new Scanner(this.app);
    this.renderer = new NoteRenderer(this.app, this.app.stage, this.W, this.H);

    this.judgment = new JudgmentSystem(this.state, (e) => {
      this.renderer!.triggerHit(e.noteId, e.result, e.x, e.y);
      this.onJudgment?.(e);
      this.onStateChange?.();
    });

    let autoId = 0;
    this.notes = chart.note_list.map((n) => this.buildNote(n, chart, autoId++));

    this.input = new InputHandler(
      this.app.canvas as HTMLCanvasElement,
      (x, y) => this.handleInput(x, y),
      (id, held) => {
        const note = this.notes.find((n) => n.id === id);
        if (!note) return;
        if (held) {
          this.judgment!.judgeHoldStart(note, this.state.elapsed);
        } else {
          this.judgment!.judgeHoldEnd(note);
        }
        this.onStateChange?.();
      },
    );

    Object.assign(this.state, makeInitialState());
    this.judgment.reset();
  }

  private buildNote(n: ChartNote, chart: Chart, autoId: number): RuntimeNote {
    const id = n.id ?? autoId;
    const tick = n.tick ?? 0;
    const x = n.x ?? 0.5;
    const duration = n.duration ?? 0;
    const bpm = chart.bpm;
    const tb = chart.time_base;

    const timeSeconds = tickToSeconds(tick, bpm, tb);
    const endTimeSeconds =
      n.type === 2 ? tickToSeconds(tick + duration, bpm, tb) : timeSeconds;

    const scanY = getScanLineY(timeSeconds, chart.page_list, bpm, tb);
    const endScanY =
      n.type === 2
        ? getScanLineY(endTimeSeconds, chart.page_list, bpm, tb)
        : scanY;

    const pixelX = x * this.W;
    const pixelY = this.PLAY_TOP + scanY * this.PLAY_H;
    const endPixelY = this.PLAY_TOP + endScanY * this.PLAY_H;

    let nodes: RuntimeChainNode[] | undefined;
    if (n.type === 3 && n.nodes) {
      nodes = n.nodes.map((nd) => {
        const ndTime = tickToSeconds(nd.tick, bpm, tb);
        const ndScanY = getScanLineY(ndTime, chart.page_list, bpm, tb);
        return {
          tick: nd.tick,
          x: nd.x,
          pixelX: nd.x * this.W,
          pixelY: this.PLAY_TOP + ndScanY * this.PLAY_H,
          timeSeconds: ndTime,
          judged: false,
        };
      });
    }

    return {
      id,
      type: n.type,
      tick,
      x,
      duration,
      nodes,
      pixelX,
      pixelY,
      endPixelY,
      timeSeconds,
      endTimeSeconds,
      hit: false,
      missed: false,
      holdActive: false,
      holdProgress: 0,
      chainNodeIdx: 0,
    };
  }

  private handleInput(touchX: number, _touchY: number) {
    if (!this.judgment) return;
    const elapsed = this.state.elapsed;
    let bestScore = -Infinity;
    let bestNote: RuntimeNote | null = null;

    for (const note of this.notes) {
      if (note.hit || note.missed) continue;

      let noteTime: number;
      let notePxX: number;

      if (note.type === 3) {
        if (!note.nodes || note.chainNodeIdx >= note.nodes.length) continue;
        const nd = note.nodes[note.chainNodeIdx];
        noteTime = nd.timeSeconds;
        notePxX = nd.pixelX;
      } else if (note.type === 2) {
        if (note.holdActive) continue;
        noteTime = note.timeSeconds;
        notePxX = note.pixelX;
      } else {
        noteTime = note.timeSeconds;
        notePxX = note.pixelX;
      }

      const timeDiff = Math.abs(elapsed - noteTime);
      if (timeDiff > JUDGMENT_WINDOWS.bad) continue;

      // Score combines time proximity and x-coordinate proximity
      const xDiff = Math.abs(touchX - notePxX);
      const coordScore = Math.max(0, 1 - xDiff / (this.W * 0.25));
      const timeScore = 1 - timeDiff / JUDGMENT_WINDOWS.bad;
      const score = timeScore * 0.55 + coordScore * 0.45;

      if (score > bestScore) {
        bestScore = score;
        bestNote = note;
      }
    }

    if (!bestNote || bestScore <= 0) return;

    if (bestNote.type === 3) {
      this.judgment.judgeChainNode(bestNote, elapsed);
    } else if (bestNote.type === 2) {
      this.judgment.judgeHoldStart(bestNote, elapsed);
    } else {
      this.judgment.judgeNote(bestNote, elapsed);
    }
    this.onStateChange?.();
  }

  start(audio?: HTMLAudioElement) {
    this.audioEl = audio ?? null;
    this.state.running = true;
    this.state.paused = false;
    this.app.ticker.add(this.tick);
  }

  pause() {
    this.state.paused = true;
    this.app.ticker.remove(this.tick);
  }

  resume() {
    this.state.paused = false;
    this.app.ticker.add(this.tick);
  }

  private tick = (ticker: { deltaMS: number }) => {
    if (!this.state.running || this.state.paused || this.state.finished) return;
    if (!this.scanner || !this.renderer || !this.judgment || !this.chart)
      return;

    // Use audio.currentTime as authoritative clock when available — prevents
    // drift and eliminates the startup offset between audio and engine.
    if (this.audioEl) {
      this.state.elapsed = this.audioEl.currentTime;
    } else {
      this.state.elapsed += ticker.deltaMS / 1000;
    }

    if (this.state.elapsed >= this.chart.length + 0.5) {
      this.state.finished = true;
      this.app.ticker.remove(this.tick);
      this.onFinish?.();
      return;
    }

    this.scanner.update(
      this.state.elapsed,
      this.chart.page_list,
      this.chart.bpm,
      this.chart.time_base,
    );
    this.state.scanY = this.scanner.scanY;

    // Note types
    // 0 = tap, 1 = flick, 2 = hold, 3 = chain
    // Visible notes: within approach window (and not fully done)
    const visible = this.notes.filter((note) => {
      // Exclude fully judged notes
      if (note.missed) return false;
      // For taps and holds, hide immediately on hit; for chains, wait until all nodes hit so they don't vanish mid-chain
      if (note.hit && note.type !== 2) return false;
      if (note.hit && note.type === 2 && !note.holdActive) return false;
      const earliest =
        note.type === 3 && note.nodes
          ? (note.nodes[note.chainNodeIdx]?.timeSeconds ?? Infinity)
          : note.timeSeconds;
      const latest =
        note.type === 2
          ? note.endTimeSeconds
          : note.nodes?.[note.nodes.length - 1].timeSeconds || note.timeSeconds;

      return (
        earliest < this.state.elapsed + APPROACH_S + 0.4 &&
        latest > this.state.elapsed - 0.15
      );
    });

    this.renderer.update(
      visible,
      this.scanner.scanPixelY,
      this.state.elapsed,
      ticker.deltaMS,
    );

    // Hold updates
    for (const note of this.notes) {
      if (note.type === 2 && note.holdActive) {
        if (this.judgment.updateHold(note, this.state.elapsed)) {
          this.onStateChange?.();
        }
      }
    }

    this.judgment.checkMisses(this.notes, this.state.elapsed);
    this.input?.setActiveNotes(visible, this.scanner.scanPixelY);
  };

  destroy() {
    this.app.ticker.remove(this.tick);
    this.input?.detach();
    this.renderer?.destroy();
    this.scanner?.destroy();
    this.app.destroy(false, { children: true });
  }
}
