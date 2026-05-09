import { Application }       from 'pixi.js'
import type { Chart }         from './chart'
import type { RuntimeNote, GameState, JudgmentEvent } from './types'
import { makeInitialState }   from './types'
import { Scanner }            from './Scanner'
import { NoteRenderer }       from './NoteRenderer'
import { InputHandler }       from './InputHandler'
import { JudgmentSystem }     from './Judgment'

const LANES = 8

export class GameEngine {
  // ── PixiJS ─────────────────────────────────────────────────────────────────
  private app     : Application
  private W       : number = 0
  private H       : number = 0

  // ── Subsystems ─────────────────────────────────────────────────────────────
  private scanner : Scanner   | null = null
  private renderer: NoteRenderer | null = null
  private input   : InputHandler | null = null
  private judgment: JudgmentSystem | null = null

  // ── State ──────────────────────────────────────────────────────────────────
  readonly state : GameState = makeInitialState()
  private chart  : Chart | null = null
  private notes  : RuntimeNote[] = []
  private hitFlash: Map<number, number> = new Map()
  private _lastSweep = -1

  // ── Callbacks ──────────────────────────────────────────────────────────────
  onStateChange : (() => void) | null = null
  onJudgment    : ((e: JudgmentEvent) => void) | null = null
  onFinish      : (() => void) | null = null

  private constructor(app: Application) {
    this.app = app
  }

  // ── Async factory (v8 requires await app.init) ─────────────────────────────

  static async create(canvas: HTMLCanvasElement): Promise<GameEngine> {
    const app = new Application()
    await app.init({
      canvas,
      width          : canvas.offsetWidth  || 1920,
      height         : canvas.offsetHeight || 1200,
      backgroundAlpha: 0,
      antialias      : true,
      resolution     : window.devicePixelRatio || 1,
      autoDensity    : true,
    })

    const engine   = new GameEngine(app)
    engine.W       = app.screen.width
    engine.H       = app.screen.height
    return engine
  }

  // ── Chart loading ──────────────────────────────────────────────────────────

  loadChart(chart: Chart) {
    this.chart = chart

    // Tear down old subsystems
    this.scanner?.destroy()
    this.renderer?.destroy()
    this.input?.detach()

    this.scanner  = new Scanner(this.app, chart.sweepDuration)
    this.renderer = new NoteRenderer(this.app, this.app.stage, this.W, this.H, LANES)

    this.judgment = new JudgmentSystem(
      this.state,
      (e) => {
        this.renderer!.triggerHitFlash(e.noteId, e.result, e.x, e.y)
        this.hitFlash.set(e.noteId, 0)
        this.onJudgment?.(e)
        this.onStateChange?.()
      },
      chart.notes.length,
    )

    // Pre-compute note pixel positions
    this.notes = chart.notes.map(n => ({
      ...n,
      pixelX      : ((n.lane + 0.5) / LANES) * this.W,
      pixelY      : this.scanner!.notePixelY(n.time, this.H),
      sweepIndex  : this.scanner!.noteSweepIndex(n.time),
      hit         : false,
      missed      : false,
      holdActive  : false,
      holdProgress: 0,
    }))

    this.input = new InputHandler(
      this.app.canvas as HTMLCanvasElement,
      this.W, this.H,
      // onTap
      (id) => {
        const note = this.notes.find(n => n.id === id)
        if (note) this.judgment!.judgeNote(note, this.state.elapsed)
      },
      // onSwipe
      (id, dir) => {
        const note = this.notes.find(n => n.id === id)
        if (!note || note.hit) return
        if (note.swipeDir === dir) {
          this.judgment!.judgeNote(note, this.state.elapsed)
        } else {
          note.hit = true
          this.onStateChange?.()
        }
      },
      // onHold
      (id, held) => {
        const note = this.notes.find(n => n.id === id)
        if (!note) return
        if (held) this.judgment!.judgeHoldStart(note, this.state.elapsed)
        else      this.judgment!.judgeHoldEnd(note, this.state.elapsed)
      },
      LANES,
    )

    Object.assign(this.state, makeInitialState())
    this._lastSweep = -1
    this.judgment.reset(chart.notes.length)
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  start() {
    this.state.running = true
    this.state.paused  = false
    this.app.ticker.add(this.tick)
  }

  pause() {
    this.state.paused = true
    this.app.ticker.remove(this.tick)
  }

  resume() {
    this.state.paused = false
    this.app.ticker.add(this.tick)
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  private tick = (ticker: { deltaMS: number }) => {
    if (!this.state.running || this.state.paused || this.state.finished) return
    if (!this.scanner || !this.renderer || !this.judgment || !this.chart) return

    // v8 ticker provides deltaMS directly
    const deltaMs = ticker.deltaMS
    this.state.elapsed += deltaMs

    if (this.state.elapsed >= this.chart.totalDuration + 1500) {
      this.state.finished = true
      this.onFinish?.()
      return
    }

    // ── Scanner update ──────────────────────────────────────────────────────
    const currentSweep = Math.floor(this.state.elapsed / this.chart.sweepDuration)
    const scanPixelY   = this.scanner.scanY * this.H
    const visibleNotes = this.notes.filter(n => n.sweepIndex === currentSweep && !n.missed)

    const nearNote = visibleNotes.some(n => Math.abs(n.pixelY - scanPixelY) < this.H * 0.08)
    this.scanner.update(this.state.elapsed, nearNote ? 1 : 0)
    this.state.scanY = this.scanner.scanY

    // ── Reload meshes on sweep change ───────────────────────────────────────
    if (currentSweep !== this._lastSweep) {
      this.renderer.loadNotes(visibleNotes)
      this._lastSweep = currentSweep
    }

    // ── Note rendering ──────────────────────────────────────────────────────
    this.renderer.update(visibleNotes, scanPixelY, this.state.elapsed, deltaMs)

    // ── Hold ticks ──────────────────────────────────────────────────────────
    for (const note of visibleNotes) {
      if (note.type === 'hold' && note.holdActive) {
        this.judgment.updateHold(note, this.state.elapsed)
      }
    }

    // ── Miss detection ──────────────────────────────────────────────────────
    this.judgment.checkMisses(visibleNotes, this.state.elapsed)

    // ── Hit flash animation ─────────────────────────────────────────────────
    for (const [id, t] of this.hitFlash) {
      const next = t + deltaMs / 300
      if (next >= 1) { this.hitFlash.delete(id) }
      else { this.hitFlash.set(id, next); this.renderer.animateHitFlash(id, next) }
    }

    // ── Feed input handler ──────────────────────────────────────────────────
    this.input!.setActiveNotes(visibleNotes, scanPixelY);
  };

  // ── Cleanup ────────────────────────────────────────────────────────────────

  destroy() {
    this.app.ticker.remove(this.tick);
    this.input?.detach();
    this.renderer?.destroy();
    this.scanner?.destroy();
    this.app.destroy(false, { children: true });
  }
}
