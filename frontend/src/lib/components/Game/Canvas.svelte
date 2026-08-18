<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { GameEngine } from "../../game/Engine";
  import { AudioPlayer } from "../../game/AudioPlayer";
  import GameUI from "./UI.svelte";
  import type { Chart } from "../../game/chart";

  let {
    chart = undefined as Chart | undefined,
    buffer = new ArrayBuffer(0),
    songTitle = "",
    artist = "",
    difficulty = "EX",
    coverSrc = "/ellasy.png",
    onpause = () => {},
    onfinish = (_stats: unknown) => {},
  }: {
    chart?: Chart;
    buffer?: ArrayBuffer;
    songTitle?: string;
    artist?: string;
    difficulty?: string;
    coverSrc?: string;
    onpause?: () => void;
    onfinish?: (stats: unknown) => void;
  } = $props();

  const BOTTOM_PADDING = 80; // px: clears bottom logos
  const FALLBACK_HUD_HEIGHT = 210;

  let canvas: HTMLCanvasElement;
  let engine: GameEngine | null = null;
  let audioPlayer: AudioPlayer | null = null;
  let hudObserver: ResizeObserver | null = null;
  let rafId = 0;

  let score = $state(0);
  let combo = $state(0);
  let tp = $state(100);
  let elapsed = $state(0);
  let paused = $state(false);
  let hudHeight = $state(0);
  let chartLength = $state(0); // seconds
  let ready = $state(false);
  let started = $state(false);
  let loadError = $state<string | null>(null);
  let loadingPhase = $state<"renderer" | "audio">("renderer");

  const loadingLabel = $derived.by(() => {
    if (loadingPhase === "renderer") {
      return "Starting renderer…";
    }
    return "Decoding audio…";
  });

  const progress = $derived.by(() => {
    if (chartLength <= 0) {
      return 0;
    }
    return Math.min(1, elapsed / chartLength);
  });

  function findHudElement(): HTMLElement | null {
    const wrapper = canvas.closest("[data-game-wrapper]");
    if (!wrapper) {
      return null;
    }
    const hud = wrapper.querySelector("[data-hud-block]");
    if (!(hud instanceof HTMLElement)) {
      return null;
    }
    return hud;
  }

  // The play area must be sized before loadChart, because note pixel
  // positions are derived from it.
  function syncPlayArea() {
    const hud = findHudElement();
    if (!hud) {
      hudHeight = FALLBACK_HUD_HEIGHT;
      engine?.setPlayArea(FALLBACK_HUD_HEIGHT, BOTTOM_PADDING);
      return;
    }
    hudHeight = hud.offsetHeight;
    engine?.setPlayArea(hudHeight, BOTTOM_PADDING);

    if (!hudObserver) {
      hudObserver = new ResizeObserver(() => syncPlayArea());
      hudObserver.observe(hud);
    }
  }

  onMount(async () => {
    engine = await GameEngine.create(canvas);
    syncPlayArea();

    engine.onStateChange = () => {
      score = engine!.state.score;
      combo = engine!.state.combo;
      tp = engine!.state.tp;
    };
    engine.onFinish = () => onfinish(engine!.state);

    if (chart) {
      engine.loadChart(chart);
    }

    loadingPhase = "audio";
    try {
      audioPlayer = new AudioPlayer();
      await audioPlayer.load(buffer);
      chartLength = audioPlayer.durationSeconds;
      ready = true;
    } catch (error) {
      if (error instanceof Error) {
        loadError = error.message;
      } else {
        loadError = String(error);
      }
    }

    function pollClock() {
      if (audioPlayer && audioPlayer.isPlaying) {
        elapsed = audioPlayer.positionSeconds;
      }
      rafId = requestAnimationFrame(pollClock);
    }
    rafId = requestAnimationFrame(pollClock);
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    hudObserver?.disconnect();
    hudObserver = null;
    audioPlayer?.destroy();
    audioPlayer = null;
    engine?.destroy();
    engine = null;
  });

  /**
   * Runs from a real pointer event. An AudioContext starts suspended and iOS
   * only permits resuming it inside a user gesture, so playback cannot be
   * kicked off from onMount.
   */
  async function handleBegin() {
    if (!ready || started || !audioPlayer || !engine) {
      return;
    }
    started = true;
    await audioPlayer.unlock();
    audioPlayer.play(0);
    engine.start(audioPlayer);
  }

  function handlePause() {
    paused = true;
    engine?.pause();
    audioPlayer?.pause();
  }

  async function handleResume() {
    paused = false;
    engine?.resume();
    await audioPlayer?.unlock();
    audioPlayer?.resume();
  }

  function handleRestart() {
    paused = false;
    elapsed = 0;
    score = 0;
    combo = 0;
    tp = 100;
    if (engine && chart) {
      engine.loadChart(chart);
      engine.start(audioPlayer!);
    }
    audioPlayer?.play(0);
  }

  function handleQuit() {
    paused = false;
    engine?.pause();
    audioPlayer?.pause();
    onpause();
  }
</script>

<div class="relative h-full w-full bg-canvas" data-game-wrapper>
  <!-- Cover art, drained and anchored right, fading toward the playfield.
       Multiply keeps it darkening the cream rather than lifting it. -->
  <img
    src={coverSrc}
    alt=""
    class="pointer-events-none absolute inset-y-0 right-0 h-full w-3/5 object-cover"
    style="
      opacity: 0.35;
      filter: grayscale(1) contrast(1.1);
      mix-blend-mode: multiply;
      mask-image: linear-gradient(to right, transparent 0%, black 38%, black 100%);
      -webkit-mask-image: linear-gradient(to right, transparent 0%, black 38%, black 100%);
    "
  />

  <!-- Ruled field. Same black as every other rule, just thinner and sparse. -->
  <div
    class="pointer-events-none absolute inset-0"
    style="
      background-image:
        linear-gradient(rgba(0, 0, 0, 0.07) 2px, transparent 2px),
        linear-gradient(90deg, rgba(0, 0, 0, 0.07) 2px, transparent 2px);
      background-size: 88px 88px;
    "
  ></div>

  <canvas bind:this={canvas} class="absolute inset-0 h-full w-full"></canvas>

  <GameUI
    title={songTitle}
    {artist}
    {score}
    {combo}
    {tp}
    {difficulty}
    {progress}
    onpause={handlePause}
  />

  <!-- ── TAP TO BEGIN ─────────────────────────────────────────────────────
       Playback must be started by a user gesture inside the game screen;
       an AudioContext cannot be resumed from onMount on iOS. -->
  {#if !started}
    <button
      class="absolute inset-0 flex flex-col items-center justify-center gap-6 border-none bg-canvas"
      class:cursor-pointer={ready}
      onclick={handleBegin}
      disabled={!ready}
    >
      {#if loadError}
        <p class="border-hard cut bg-danger px-8 py-4 text-lg font-black tracking-loose text-ink-fg uppercase">
          Audio failed to load
        </p>
        <p class="max-w-lg text-center text-sm font-semibold text-fg-muted">
          {loadError}
        </p>
      {:else if !ready}
        <p class="text-lg font-black tracking-display text-fg-dim uppercase">
          {loadingLabel}
        </p>
      {:else}
        <p class="border-hard cut hard-press bg-accent px-12 py-6 text-2xl font-black tracking-display text-ink-fg uppercase">
          Tap to begin
        </p>
        <p class="text-sm font-bold tracking-loose text-fg-muted uppercase">
          {songTitle}
        </p>
      {/if}
    </button>
  {/if}

  <!-- ── PAUSE OVERLAY ────────────────────────────────────────────────── -->
  {#if paused}
    <div
      class="absolute inset-0 flex flex-col items-center justify-center gap-10 bg-canvas"
    >
      <p class="text-3xl font-black tracking-display text-fg uppercase">
        Paused
      </p>

      <div class="flex flex-row gap-5">
        <button
          onclick={handleResume}
          class="hard-press border-hard cut cursor-pointer bg-accent px-12 py-5 text-lg font-black tracking-ui text-ink-fg uppercase"
        >
          Resume
        </button>

        <button
          onclick={handleRestart}
          class="hard-press border-hard cut cursor-pointer bg-raised px-12 py-5 text-lg font-black tracking-ui text-fg uppercase transition-colors duration-150 hover:bg-hover"
        >
          Restart
        </button>

        <button
          onclick={handleQuit}
          class="hard-press border-hard cut cursor-pointer bg-raised px-12 py-5 text-lg font-black tracking-ui text-fg uppercase transition-colors duration-150 hover:bg-hover"
        >
          Quit
        </button>
      </div>
    </div>
  {/if}
</div>
