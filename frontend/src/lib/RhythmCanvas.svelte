<script lang="ts">
  // ============================================================
  //  RhythmGame.svelte — Cytus-style rhythm game (MVP)
  //
  //  Props:
  //    song  — Song descriptor with chart notes and BPM
  //    exit  — callback to return to the menu
  //
  //  Architecture:
  //    • GameRenderer (WebGL2) owns the canvas draw pipeline
  //    • All game logic lives in plain TS (GameState class)
  //    • Svelte $state holds only the HUD values that must re-render
  //    • Audio is driven by Web Audio API; synthesised if no audioUrl
  // ============================================================

  import { onMount, onDestroy } from "svelte";
  import { GameRenderer } from "./Renderer";
  import type { RGBA } from "./Renderer";
  import type { Song, ChartNote } from "./types";

  const { song, exit }: { song: Song; exit: () => void } = $props();

  // ── Canvas ref ────────────────────────────────────────────────
  let canvas: HTMLCanvasElement;

  // ── HUD state (Svelte reactive) ───────────────────────────────
  let score = $state(0);
  let combo = $state(0);
  let phase = $state<"countdown" | "playing" | "paused" | "results">("playing");
  let countdown = $state(3);
  let lastJudge = $state<string | null>(null); // 'PERFECT' | 'GOOD' | 'BAD' | 'MISS'
  let lastJudgeTs = $state(0); // timestamp for fade animation
  let accuracy = $state(100);
  let resultsData = $state<ResultsSnapshot | null>(null);
  let showPause = $state(false);

  // ── Layout constants (logical pixels, DPR-independent) ────────
  const PAD_X = 0.07; // fraction of width
  // PLAY_TOP_PX is now dynamic — resolved each frame from --hud-height CSS var
  // set by UI.svelte's ResizeObserver. We keep a fallback default of 200px.
  const PLAY_TOP_FALLBACK = 200; // px — safe default until first measure
  // Bottom padding in px — enough to clear the logo row (bottom-6 = 24px + logo ~36px + gap)
  const PLAY_BOT_PAD = 80;      // px from canvas bottom edge
  const NOTE_R = 64; // logical pixels
  const HOLD_W = 18;

  // ── Dynamic play-area bounds ──────────────────────────────────
  // Read the HUD height CSS variable that UI.svelte writes each frame.
  function getPlayTop(): number {
    if (!canvas) return PLAY_TOP_FALLBACK;
    const wrapper = canvas.closest('[data-game-wrapper]') as HTMLElement | null;
    if (!wrapper) return PLAY_TOP_FALLBACK;
    const v = wrapper.style.getPropertyValue('--hud-height');
    const px = parseFloat(v);
    return isNaN(px) ? PLAY_TOP_FALLBACK : px + 8; // 8px breathing room
  }
  function getPlayBot(H: number): number {
    return H - PLAY_BOT_PAD;
  }

  // ── Timing constants ──────────────────────────────────────────
  const SCAN_BEATS = 8; // beats per half-sweep
  const HIT_WIN = { perfect: 0.045, good: 0.09, bad: 0.14 } as const;
  const SCORE_BASE = { perfect: 100, good: 70, bad: 30 } as const;
  const CHROMA_HIT = { perfect: 0.6, good: 0.2, bad: 0 } as const;

  // ── Colour palette ─────────────────────────────────────────────
  const COL = {
    bg: [0.024, 0.024, 0.047, 1] as RGBA,
    lane: [0.0, 0.55, 1.0, 0.14] as RGBA,
    tapNote: [1, 1, 1, 1] as RGBA,
    holdNote: [1, 0.31, 0.61, 1] as RGBA,
    scanner: [0.72, 0.55, 1.0, 1] as RGBA,
  };


  // AUDIOOOOOO
  // svelte-ignore state_referenced_locally
  const audio = new Audio(song.audioUrl);

  // ── Types local to this component ─────────────────────────────
  type Quality = "perfect" | "good" | "bad" | "miss";

  interface LiveNote {
    data: ChartNote;
    hitTime: number; // absolute seconds
    holdEnd: number; // hitTime + holdBeats*beatLen (tap = same as hitTime)
    /** Normalised scanner Y [0,1] at hitTime */
    scanY: number;
    /** Normalised scanner Y [0,1] at holdEnd */
    holdEndSY: number;
    state: "idle" | "holding" | "done" | "missed";
    holdProg: number; // 0-1 fill progress for hold body
  }

  interface FloatingText {
    text: string;
    color: string;
    x: number;
    y: number;
    born: number; // performance.now()
    life: number; // ms
  }

  interface ResultsSnapshot {
    score: number;
    maxCombo: number;
    counts: Record<Quality, number>;
    accuracy: number;
    grade: string;
  }

  // ── Audio ──────────────────────────────────────────────────────
  let ac: AudioContext | null = null;
  let audioSrc: AudioBufferSourceNode | null = null;
  let songStartAC = 0; // AC.currentTime when beat 0 starts


  // ── Scanner math ───────────────────────────────────────────────
  // Returns normalised Y in [0,1] (0=bottom, 1=top) at song time t.
  function getScannerYPosition(song: Song, time: number): number {
    // We need to search through all the pages and check which page we're on and then calculate the scanner position from there.
   const tick = time / (60 / song.bpm) * song.player.time_base;
    // We need to search through all the pages and check which page we're on and then calculate the scanner position from there.
    const segment = song.player.page_list.find(
      s => tick >= s.start_tick && tick < s.end_tick
    );

    if (!segment) {
      return 0;
    }

    const duration = segment.end_tick - segment.start_tick;
    const progress = (tick - segment.start_tick) / duration;


    if (segment.scan_line_direction === 1) {
      return progress;
    } else {
      return 1 - progress;
    }
  }

  // ── Game state class ───────────────────────────────────────────
  // Pure logic; no Svelte reactivity inside. Results are pushed out
  // via the callbacks passed at construction.

  class GameState {
    readonly notes: LiveNote[];
    readonly beatLen: number;
    readonly song: Song;

    private _score = 0;
    private _combo = 0;
    private _maxCombo = 0;
    private _counts: Record<Quality, number> = {
      perfect: 0,
      good: 0,
      bad: 0,
      miss: 0,
    };
    private _total = 0;
    private _holdSet = new Set<LiveNote>();

    /** Scan flash intensity [0,1]; decays per-frame */
    scanFlash = 0;

    // Callbacks → push HUD updates to Svelte state
    onJudge: (quality: Quality, px: number, py: number) => void = () => {};
    onFinish: (snap: ResultsSnapshot) => void = () => {};

    constructor(song: Song) {
      this.beatLen = 60 / song.bpm;
      const halfPeriod = SCAN_BEATS * this.beatLen;

      this.song = song;
      this.notes = song.notes
        .slice()
        .sort((a, b) => a.beat - b.beat)
        .map((n) => {
          const hitTime = n.beat * this.beatLen;
          const holdBeats = n.holdBeats ?? 0;
          const holdEnd = hitTime + holdBeats * this.beatLen;
          return {
            data: n,
            hitTime,
            holdEnd,
            scanY: getScannerYPosition(this.song, hitTime),
            holdEndSY: getScannerYPosition(this.song, holdEnd),
            state: "idle" as const,
            holdProg: 0,
          };
        });

      this._total = this.notes.length;
    }

    // ── Per-frame update ────────────────────────────────────────
    update(songTime: number, songLength: number): boolean {
      this.scanFlash *= 0.75;

      for (const note of this.notes) {
        if (note.state === "done" || note.state === "missed") continue;

        // Auto-miss: scanner passed the hit window without a tap
        if (note.state === "idle" && songTime > note.hitTime + HIT_WIN.bad) {
          note.state = "missed";
          this._counts.miss++;
          this._combo = 0;
          this.onJudge("miss", 0, 0);
        }

        // Hold progress update
        if (note.state === "holding") {
          if (note.holdEnd <= note.hitTime) {
            // Degenerate hold (0 duration) — finish immediately
            note.state = "done";
            note.holdProg = 1;
            this._holdSet.delete(note);
          } else {
            note.holdProg = Math.min(
              1,
              (songTime - note.hitTime) / (note.holdEnd - note.hitTime),
            );
            if (songTime >= note.holdEnd) {
              note.state = "done";
              this._holdSet.delete(note);
              this._score += Math.round(50 * Math.max(1, this._combo));
            }
          }
        }
      }

      const now = performance.now();

      for (const f of floats) {
        const elapsed = now - f.born;
        if (elapsed >= f.life) continue;

        const t     = elapsed / f.life;           // 0 → 1
        const alpha = 1 - t * t;                  // quadratic fade-out
        const drift = t * 40;                     // floats upward 40px over lifetime

        const label = f.text.toUpperCase();
        const { w, h } = FLOAT_TEX_SIZE[label];

        renderer?.drawRect(
          "fx",
          { x: f.x - w / 2, y: f.y - drift - h / 2, w, h },
          [1, 1, 1, alpha],                        // tint white; alpha drives fade
          `float_${label}`,
        );
      }

      // Prune dead floats
      floats = floats.filter(f => (now - f.born) < f.life);

      // Signal end-of-song
      return songTime >= songLength;
    }

    // ── Input ───────────────────────────────────────────────────
    /**
     * Called on tap at logical-pixel position (lx, ly).
     * Finds the best candidate note and registers a hit or miss.
     */
    tryHit(
      lx: number,
      ly: number,
      songTime: number,
      W: number,
      H: number,
    ): void {
      const laneLeft = PAD_X * W;
      const laneRight = W * (1 - PAD_X);
      const laneTop = getPlayTop();
      const laneBot = getPlayBot(H);
      const playH = laneBot - laneTop;
      const scanPxY = laneTop + getScannerYPosition(this.song, songTime) * playH;

      let best: LiveNote | null = null;
      let bestScore = -Infinity;

      for (const note of this.notes) {
        if (note.state !== "idle") continue;
        const delta = songTime - note.hitTime;
        if (Math.abs(delta) > HIT_WIN.bad * 2.5) continue;

        const notePxX = laneLeft + note.data.x * (laneRight - laneLeft);
        const notePxY = laneTop + note.scanY * playH;
        const dx = Math.abs(lx - notePxX);
        const dy = Math.abs(ly - scanPxY);

        // Weight: prefer close-x over exact-y (scanner does the y work)
        if (dx > W * 0.22) continue;
        if (dy > H * 0.18) continue;

        const s = -dx * 0.5 - Math.abs(delta) * 200;
        if (s > bestScore) {
          best = note;
          bestScore = s;
        }
      }

      if (!best) return;

      const delta = songTime - best.hitTime;
      const q = this._quality(Math.abs(delta));
      if (!q) return;

      this._registerHit(best, q, lx, ly);
    }

    /** Called on pointer-up — finalise any active hold notes. */
    releaseHolds(): void {
      for (const note of this._holdSet) {
        if (note.state !== "holding") {
          this._holdSet.delete(note);
          continue;
        }
        if (note.holdProg >= 0.75) {
          note.state = "done";
          this._score += Math.round(50 * Math.max(1, this._combo));
        } else {
          // Released too early — partial hold, no score bonus, break combo
          note.state = "done";
          this._combo = 0;
        }
        this._holdSet.delete(note);
      }
    }

    // ── Getters for HUD ─────────────────────────────────────────
    get scoreValue() {
      return this._score;
    }
    get comboValue() {
      return this._combo;
    }
    get accuracyPct() {
      const judged =
        this._counts.perfect +
        this._counts.good +
        this._counts.bad +
        this._counts.miss;
      if (judged === 0) return 100;
      const earned =
        this._counts.perfect * 100 +
        this._counts.good * 70 +
        this._counts.bad * 30;
      return (earned / (judged * 100)) * 100;
    }

    buildResults(): ResultsSnapshot {
      const acc = this.accuracyPct;
      const grade =
        acc >= 97
          ? "S+"
          : acc >= 90
            ? "S"
            : acc >= 80
              ? "A"
              : acc >= 65
                ? "B"
                : acc >= 50
                  ? "C"
                  : "D";
      return {
        score: this._score,
        maxCombo: this._maxCombo,
        counts: { ...this._counts },
        accuracy: acc,
        grade,
      };
    }

    // ── Private ─────────────────────────────────────────────────
    private _quality(absDelta: number): Quality | null {
      if (absDelta <= HIT_WIN.perfect) return "perfect";
      if (absDelta <= HIT_WIN.good) return "good";
      if (absDelta <= HIT_WIN.bad) return "bad";
      return null;
    }

    private _registerHit(note: LiveNote, q: Quality, lx: number, ly: number) {
      note.state = note.data.type === "hold" ? "holding" : "done";
      this._counts[q]++;

      if (q !== "bad") {
        this._combo++;
        this._maxCombo = Math.max(this._maxCombo, this._combo);
      } else {
        this._combo = 0;
      }

      const mult = q !== "bad" ? this._combo : 1;
      this._score += SCORE_BASE[q] * mult;
      this.scanFlash = 1;

      if (note.data.type === "hold") this._holdSet.add(note);

      this.onJudge(q, lx, ly);
    }
  }

  // ── Component setup ────────────────────────────────────────────
  let renderer: GameRenderer | null = null;
  let gameState: GameState | null = null;
  let rafId = 0;
  let songTime = 0;
  let countdownTimer = 0;

  const JUDGMENT_LABELS = ["PERFECT", "GOOD", "BAD", "MISS"] as const;
  const JUDGMENT_COLORS: Record<string, string> = {
    PERFECT: "#00FFFF",
    GOOD:    "#66FF99",
    BAD:     "#FFAA33",
    MISS:    "#FF4455",
  };
  const FLOAT_TEX_SIZE: Record<string, { w: number; h: number }> = {};

  // Floating judgement texts (Canvas 2D overlay, not WebGL)
  let floats: FloatingText[] = [];

  // ── onMount ─────────────────────────────────────────────────────
  onMount(() => {
    renderer = new GameRenderer(canvas);
    gameState = new GameState(song);
    const songLength = song.length * (60 / song.bpm);

    for (const label of JUDGMENT_LABELS) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const font = "bold 28px 'Arial', sans-serif";
      ctx.font = font;
      const m = ctx.measureText(label);
      canvas.width  = Math.ceil(m.width) + 16;
      canvas.height = 40;
      ctx.font = font;
      ctx.fillStyle = JUDGMENT_COLORS[label];
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      // optional: soft shadow for depth
      ctx.shadowColor = JUDGMENT_COLORS[label];
      ctx.shadowBlur  = 8;
      ctx.fillText(label, canvas.width / 2, canvas.height / 2);
      renderer.uploadBitmap(`float_${label}`, canvas);
      FLOAT_TEX_SIZE[label] = { w: canvas.width, h: canvas.height };
    }

    // Wire callbacks that push data into Svelte state
    gameState.onJudge = (q, px, py) => {
      // Update HUD reactives
      score = gameState!.scoreValue;
      combo = gameState!.comboValue;
      accuracy = Math.round(gameState!.accuracyPct * 10) / 10;
      lastJudge = q.toUpperCase();
      lastJudgeTs = performance.now();

      // Trigger renderer effects
      renderer?.triggerChromaFlash(
        CHROMA_HIT[q as keyof typeof CHROMA_HIT] ?? 0,
      );

      // Floating text
      if (px > 0 || py > 0) {

        floats.push({
          text: q.toUpperCase(),
          color:
          {
          "perfect": "#00FFFF",
          "good": "#66FF99",
          "bad": "#FFAA33",
          "miss": "#FF4455",
          }[q],
          x: px,
          y: py - NOTE_R - 8,
          born: performance.now(),
          life: 700,
        });
      }
    };

    gameState.onFinish = (snap) => {
      phase = "results";
      resultsData = snap;
    };

    // ── Countdown then start ──────────────────────────────────
    let lastTS = performance.now();
    phase = "countdown";

    function loop(ts: number) {
      rafId = requestAnimationFrame(loop);
      const dt = Math.min((ts - lastTS) / 1000, 0.1);
      lastTS = ts;

      // ── Countdown phase ────────────────────────────────────
      if (phase === "countdown") {
        countdownTimer += dt;
        if (countdownTimer < 1) countdown = 3;
        else if (countdownTimer < 2) countdown = 2;
        else if (countdownTimer < 3) countdown = 1;
        else if (countdownTimer < 3.5)
          countdown = 0; // shows 'GO'
        else {
          audio.play()
          phase = "playing";
          songTime = 0;
        }
      }

      // ── Playing phase ──────────────────────────────────────
      if (phase === "playing") {
        // Use AudioContext clock for precise timing if available
        songTime = audio ? audio.currentTime - songStartAC : songTime + dt;

        const finished = gameState!.update(songTime, songLength);
        if (finished) {
          const snap = gameState!.buildResults();
          gameState!.onFinish(snap);
        }

        // Sync HUD score/combo (updated by onJudge too, but keep smooth)
        score = gameState!.scoreValue;
        combo = gameState!.comboValue;
        accuracy = Math.round(gameState!.accuracyPct * 10) / 10;
      }

      // ── Render (during all non-results phases) ─────────────
      if (phase !== "results") {
        drawFrame(ts / 1000, songTime);
      }
    }

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      renderer?.dispose();
    };
  });

  // ── Render frame ───────────────────────────────────────────────
  function drawFrame(time: number, st: number) {
    if (!renderer || !gameState) return;
    const r = renderer;
    const gs = gameState;

    const W = r.logicalWidth;
    const H = r.logicalHeight;

    const laneLeft = PAD_X * W;
    const laneRight = W * (1 - PAD_X);
    const laneTop = getPlayTop();           // dynamic — respects HUD height
    const laneBot = getPlayBot(H);          // dynamic — respects bottom logo
    const playW = laneRight - laneLeft;
    const playH = laneBot - laneTop;

    const sy = getScannerYPosition(song, Math.max(0, st));
    const scanPxY = laneTop + sy * playH;
    const scroll = (Math.max(0, st) / (SCAN_BEATS * gs.beatLen)) % 1;

    r.beginFrame(time);

    // ── Background ────────────────────────────────────────────
    r.drawRect("bg", { x: 0, y: 0, w: W, h: H }, COL.bg);

    // ── Lane backdrop ─────────────────────────────────────────
    r.drawLane(
      { x: laneLeft, y: laneTop, w: playW, h: playH },
      COL.lane,
      scroll,
    );

    // ── Notes ─────────────────────────────────────────────────
    for (const note of gs.notes) {
      if (note.state === "missed") continue;
      if (note.state === "done" && note.data.type === "tap") continue;

      const notePxX = laneLeft + note.data.x * playW;
      const notePxY = laneTop + note.scanY * playH;

      // Skip notes far in the future (beyond one full scan period)
      const delta = note.hitTime - st;
      if (delta > (SCAN_BEATS * gs.beatLen) / 4 + 0.5) continue;

      const approachT = delta > 0 ? Math.max(0, delta / (gs.beatLen * 2.5)) : 0;
      const glow = Math.max(0, 1 - Math.abs(delta) / (gs.beatLen * 1.5));

      const isHold = note.data.type === "hold";

      // Draw hold body
      if (isHold && (note.state === "idle" || note.state === "holding")) {
        const endPxY = laneTop + note.holdEndSY * playH;
        r.drawHoldBody(
          "notes",
          notePxX,
          Math.min(notePxY, endPxY),
          Math.max(notePxY, endPxY),
          HOLD_W,
          COL.holdNote,
          note.holdProg,
        );
      }

      // Draw the note circle
      if (note.state !== "done") {
        r.drawNote(
          "notes",
          notePxX,
          notePxY,
          NOTE_R,
          isHold ? COL.holdNote : COL.tapNote,
          glow,
          approachT,
        );
      }
    }

    // ── Scanner ───────────────────────────────────────────────
    r.drawScanner(scanPxY, laneLeft, laneRight, 28, COL.scanner, gs.scanFlash);

    r.endFrame();
  }

  // ── Input handling ─────────────────────────────────────────────
  // We use pointer events on the *wrapper div* so the HUD buttons
  // above the canvas still fire independently.
  function onPointerDown(e: PointerEvent) {
    if (phase !== "playing" || !gameState || !renderer) return;
    e.preventDefault();

    // Convert client coords to logical canvas pixels
    const rect = canvas.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;

    gameState.tryHit(
      lx,
      ly,
      songTime,
      renderer.logicalWidth,
      renderer.logicalHeight,
    );
  }

  function onPointerUp() {
    if (phase === "playing") gameState?.releaseHolds();
  }

  // ── Pause / resume ─────────────────────────────────────────────
  function togglePause() {
    if (phase === "playing") {
      phase = "paused";
      showPause = true;
      audio.pause();
    } else if (phase === "paused") {
      phase = "playing";
      showPause = false;
      if (audio.paused) audio.play();
    }
  }

  // ── Derived / helpers ──────────────────────────────────────────
  function gradeColor(grade: string): string {
    return (
      {
        "S+": "#FFD700",
        S: "#FFD700",
        A: "#00FFFF",
        B: "#66FF99",
        C: "#FFAA33",
        D: "#FF4455",
      }[grade] ?? "#fff"
    );
  }

  function judgeColor(j: string): string {
    return j === "PERFECT"
      ? "#00FFFF"
      : j === "GOOD"
        ? "#66FF99"
        : j === "BAD"
          ? "#FFAA33"
          : "#FF4455";
  }

  // Progress 0–1 through the song
  let progress = $derived(
    song.length > 0
      ? Math.min(1, Math.max(0, songTime / (song.length * (60 / song.bpm))))
      : 0,
  );
</script>

<!-- ─────────────────────────────────────────────────────────── -->
<!--  Template                                                   -->
<!-- ─────────────────────────────────────────────────────────── -->

<div
  class="game-wrapper"
  data-game-wrapper
  onpointerdown={onPointerDown}
  onpointerup={onPointerUp}
>
  <!-- WebGL canvas — fills the wrapper -->
  <canvas bind:this={canvas}></canvas>

  <!-- ── Countdown overlay ─────────────────────────────────── -->
  {#if phase === "countdown"}
    <div class="overlay countdown-overlay">
      {#key countdown}
        <span class="countdown-number">
          {countdown > 0 ? countdown : "GO"}
        </span>
      {/key}
    </div>
  {/if}

  <!-- ── HUD (visible during play + pause) ─────────────────── -->
  {#if phase === "playing" || phase === "paused"}
    <div class="hud">
      <!-- Top-left: title + accuracy -->
      <div class="hud-left">
        <div class="song-title">{song.title}</div>
        <div class="song-artist">{song.artist}</div>
        <div class="accuracy">{accuracy.toFixed(1)}%</div>
      </div>

      <!-- Top-centre: combo -->
      {#if combo > 1}
        <div class="hud-centre">
          <div class="combo-number">{combo}</div>
          <div class="combo-label">COMBO</div>
        </div>
      {/if}

      <!-- Top-right: score + pause -->
      <div class="hud-right">
        <div class="score">{String(score).padStart(8, "0")}</div>
        <button
          class="icon-btn pause-btn"
          onclick={togglePause}
          aria-label="Pause"
        >
          {#if phase === "paused"}▶{:else}⏸{/if}
        </button>
      </div>

      <!-- Floating judge text (CSS-animated) -->
      {#if lastJudge && performance.now() - lastJudgeTs < 600}
        <div class="judge-text" style="color: {judgeColor(lastJudge)}">
          {lastJudge}
        </div>
      {/if}

      <!-- Progress bar — top edge, full width, matching HTML style -->
      <div class="progress-wrap">
        <div class="progress-fill" style="width: {progress * 100}%"></div>
      </div>
    </div>
  {/if}

  <!-- ── Pause menu ─────────────────────────────────────────── -->
  {#if phase === "paused"}
    <div class="overlay pause-overlay">
      <div class="pause-card">
        <h2>PAUSED</h2>
        <button class="menu-btn accent" onclick={togglePause}>Resume</button>
        <button
          class="menu-btn"
          onclick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else {
              canvas.requestFullscreen();
            }
          }}>Fullscreen</button
        >
        <button class="menu-btn" onclick={exit}>Quit</button>
      </div>
    </div>
  {/if}

  <!-- ── Results screen ─────────────────────────────────────── -->
  {#if phase === "results" && resultsData}
    {@const r = resultsData}
    <div class="overlay results-overlay">
      <div class="results-card">
        <div class="results-header">
          <div class="results-song">
            <span class="results-title">{song.title}</span>
            <span class="results-artist">{song.artist}</span>
          </div>
          <div class="results-grade" style="color: {gradeColor(r.grade)}">
            {r.grade}
          </div>
        </div>

        <div class="results-score">{String(r.score).padStart(8, "0")}</div>

        <div class="results-stats">
          <div class="stat-row">
            <span class="stat-label">MAX COMBO</span>
            <span class="stat-value">{r.maxCombo}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label perfect-col">PERFECT</span>
            <span class="stat-value">{r.counts.perfect}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label good-col">GOOD</span>
            <span class="stat-value">{r.counts.good}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label bad-col">BAD</span>
            <span class="stat-value">{r.counts.bad}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label miss-col">MISS</span>
            <span class="stat-value">{r.counts.miss}</span>
          </div>
          <div class="stat-row accent-row">
            <span class="stat-label">ACCURACY</span>
            <span class="stat-value">{r.accuracy.toFixed(2)}%</span>
          </div>
        </div>

        <button class="menu-btn accent wide" onclick={exit}>Back to Menu</button
        >
      </div>
    </div>
  {/if}

  <!-- ── Exit button (always visible) ──────────────────────── -->
  {#if phase !== "results"}
    <button class="exit-btn icon-btn" onclick={exit} aria-label="Exit">✕</button
    >
  {/if}
</div>

<style>
  /* ── Wrapper ──────────────────────────────────────────────────── */
  .game-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #060612;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    font-family: "Rajdhani", "Share Tech Mono", system-ui, sans-serif;
  }

  canvas {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  /* ── HUD ──────────────────────────────────────────────────────── */
  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .hud-left {
    position: absolute;
    top: 12px;
    left: 20px;
    pointer-events: none;
  }
  .song-title {
    font-size: 0.82rem;
    font-weight: 700;
    color: rgba(0, 255, 255, 0.65);
    letter-spacing: 0.08em;
  }
  .song-artist {
    font-size: 0.68rem;
    font-weight: 300;
    color: rgba(255, 255, 255, 0.35);
  }
  .accuracy {
    font-size: 0.72rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    margin-top: 2px;
  }

  .hud-centre {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    pointer-events: none;
  }
  .combo-number {
    font-size: clamp(1.6rem, 5vw, 2.4rem);
    font-weight: 700;
    color: #fff;
    line-height: 1;
    text-shadow: 0 0 18px rgba(0, 255, 255, 0.7);
    letter-spacing: 0.04em;
  }
  .combo-label {
    font-size: 0.62rem;
    color: rgba(0, 255, 255, 0.55);
    letter-spacing: 0.18em;
  }

  .hud-right {
    position: absolute;
    top: 12px;
    right: 20px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    pointer-events: all;
  }
  .score {
    font-size: clamp(1rem, 3.5vw, 1.5rem);
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
  }

  /* Judge text — centred, pops then fades */
  .judge-text {
    position: absolute;
    top: 44%;
    left: 50%;
    transform: translateX(-50%);
    font-size: clamp(1.1rem, 4vw, 1.8rem);
    font-weight: 700;
    letter-spacing: 0.14em;
    pointer-events: none;
    text-shadow: 0 0 16px currentColor;
    animation: judgePop 0.6s ease-out forwards;
  }
  @keyframes judgePop {
    0% {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1.2);
    }
    40% {
      opacity: 1;
      transform: translateX(-50%) translateY(-8px) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) translateY(-22px) scale(0.9);
    }
  }

  /* Progress bar — full-width top strip, below the HUD row */
  .progress-wrap {
    position: absolute;
    top: 52px;
    left: 0;
    right: 0;
    height: 3px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
    z-index: 25;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #00f5ff, #cc00ff);
    box-shadow: 0 0 8px #00f5ff;
    transition: width 0.08s linear;
  }

  /* ── Buttons ─────────────────────────────────────────────────── */
  .icon-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.9rem;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    backdrop-filter: blur(6px);
  }
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
  }
  .icon-btn:active {
    transform: scale(0.94);
  }

  .pause-btn {
    pointer-events: all;
  }

  .exit-btn {
    position: absolute;
    top: 12px;
    right: 62px;
    z-index: 20;
  }

  /* ── Overlays ────────────────────────────────────────────────── */
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  /* Countdown */
  .countdown-overlay {
    background: rgba(6, 6, 18, 0.72);
    z-index: 30;
  }
  .countdown-number {
    font-size: clamp(4rem, 18vw, 9rem);
    font-weight: 700;
    color: #fff;
    text-shadow: 0 0 40px rgba(0, 255, 255, 0.8);
    animation: countPulse 1s ease-in-out forwards;
  }
  @keyframes countPulse {
    0% {
      transform: scale(1.45);
      opacity: 0;
    }
    18% {
      transform: scale(1);
      opacity: 1;
    }
    72% {
      transform: scale(1);
      opacity: 1;
    }
    100% {
      transform: scale(0.85);
      opacity: 0;
    }
  }

  /* Pause */
  .pause-overlay {
    background: rgba(6, 6, 18, 0.82);
    z-index: 40;
    backdrop-filter: blur(8px);
  }
  .pause-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 40px 48px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(0, 255, 255, 0.15);
    border-radius: 20px;
  }
  .pause-card h2 {
    color: rgba(0, 255, 255, 0.9);
    font-size: 1.6rem;
    letter-spacing: 0.2em;
    margin: 0 0 8px;
  }

  /* Shared menu button */
  .menu-btn {
    width: 180px;
    padding: 12px 0;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.8);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s,
      border-color 0.15s;
  }
  .menu-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
  .menu-btn:active {
    transform: scale(0.97);
  }
  .menu-btn.accent {
    background: rgba(0, 255, 255, 0.12);
    border-color: rgba(0, 255, 255, 0.35);
    color: rgba(0, 255, 255, 0.95);
  }
  .menu-btn.accent:hover {
    background: rgba(0, 255, 255, 0.22);
  }
  .menu-btn.wide {
    width: 220px;
  }

  /* Results */
  .results-overlay {
    background: rgba(6, 6, 18, 0.94);
    z-index: 50;
    backdrop-filter: blur(12px);
  }
  .results-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    padding: 36px 48px 40px;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(0, 200, 255, 0.15);
    border-radius: 22px;
    min-width: min(86vw, 380px);
  }

  .results-header {
    width: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  .results-song {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .results-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: #fff;
  }
  .results-artist {
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.4);
  }
  .results-grade {
    font-size: 3.4rem;
    font-weight: 700;
    line-height: 1;
    text-shadow: 0 0 28px currentColor;
  }

  .results-score {
    font-size: clamp(1.5rem, 6vw, 2.2rem);
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.1em;
    font-variant-numeric: tabular-nums;
  }

  .results-stats {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stat-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 8px;
  }
  .stat-label {
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.42);
    letter-spacing: 0.08em;
  }
  .stat-value {
    font-size: 0.82rem;
    font-weight: 700;
    color: #fff;
  }
  .perfect-col {
    color: #00ffff;
  }
  .good-col {
    color: #66ff99;
  }
  .bad-col {
    color: #ffaa33;
  }
  .miss-col {
    color: #ff4455;
  }
  .accent-row {
    border: 1px solid rgba(0, 255, 255, 0.12);
  }
  .accent-row .stat-label {
    color: rgba(0, 255, 255, 0.6);
  }
  .accent-row .stat-value {
    color: rgba(0, 255, 255, 0.9);
  }
</style>