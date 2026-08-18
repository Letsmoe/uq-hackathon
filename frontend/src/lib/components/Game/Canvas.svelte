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

<div class="relative w-full h-full" data-game-wrapper>
  <!-- Pale base field -->
  <div
    class="absolute inset-0 pointer-events-none"
    style="background: linear-gradient(135deg, #f2f0f4 0%, #e9e6ee 45%, #e0dce8 100%);"
  ></div>

  <!-- Cover art, washed out and anchored right, fading toward the playfield -->
  <img
    src={coverSrc}
    alt=""
    class="absolute inset-y-0 right-0 h-full w-3/5 object-cover pointer-events-none"
    style="
      opacity: 0.4;
      filter: grayscale(0.75) brightness(1.18) contrast(0.92);
      mix-blend-mode: multiply;
      mask-image: linear-gradient(to right, transparent 0%, black 38%, black 100%);
      -webkit-mask-image: linear-gradient(to right, transparent 0%, black 38%, black 100%);
    "
  />

  <!-- Technical grid -->
  <div
    class="absolute inset-0 pointer-events-none"
    style="
      background-image:
        linear-gradient(rgba(60,52,90,0.055) 1px, transparent 1px),
        linear-gradient(90deg, rgba(60,52,90,0.055) 1px, transparent 1px);
      background-size: 80px 80px;
    "
  ></div>

  <!-- Light vignette to seat the playfield -->
  <div
    class="absolute inset-0 pointer-events-none"
    style="background: radial-gradient(ellipse at center, rgba(255,255,255,0.25) 0%, rgba(120,110,150,0.14) 100%);"
  ></div>

  <canvas
    bind:this={canvas}
    class="absolute inset-0 w-full h-full"
  ></canvas>

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
      class="absolute inset-0 flex flex-col items-center justify-center gap-6"
      class:cursor-pointer={ready}
      style="background: rgba(240,238,245,0.92); backdrop-filter: blur(6px); font-family: 'Rajdhani', sans-serif; border: 0;"
      onclick={handleBegin}
      disabled={!ready}
    >
      {#if loadError}
        <p
          style="
            font-family: 'Orbitron', monospace;
            font-size: 0.9rem;
            font-weight: 700;
            letter-spacing: 0.25em;
            text-transform: uppercase;
            color: #c04a63;
          "
        >Audio failed to load</p>
        <p style="color: rgba(60,52,90,0.6); font-size: 0.85rem; max-width: 32rem; text-align: center;">
          {loadError}
        </p>
      {:else if !ready}
        <p
          style="
            font-family: 'Orbitron', monospace;
            font-size: 1rem;
            font-weight: 700;
            letter-spacing: 0.5em;
            text-transform: uppercase;
            color: rgba(60,52,90,0.45);
          "
        >{loadingLabel}</p>
      {:else}
        <p
          style="
            font-family: 'Orbitron', monospace;
            font-size: 1.5rem;
            font-weight: 900;
            letter-spacing: 0.6em;
            text-transform: uppercase;
            color: #7d67d2;
            text-shadow: 0 0 30px rgba(125,103,210,0.45), 0 0 70px rgba(125,103,210,0.2);
          "
        >Tap to begin</p>
        <p
          style="
            font-size: 0.85rem;
            letter-spacing: 0.3em;
            text-transform: uppercase;
            color: rgba(60,52,90,0.45);
          "
        >{songTitle}</p>
      {/if}
    </button>
  {/if}

  <!-- ── PAUSE OVERLAY ────────────────────────────────────────────────── -->
  {#if paused}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-8"
      style="background: rgba(240,238,245,0.9); backdrop-filter: blur(6px); font-family: 'Rajdhani', sans-serif;">

      <p
        style="
          font-family: 'Orbitron', monospace;
          font-size: 1.5rem;
          font-weight: 900;
          letter-spacing: 0.6em;
          text-transform: uppercase;
          color: #7d67d2;
          text-shadow: 0 0 30px rgba(125,103,210,0.45), 0 0 70px rgba(125,103,210,0.2);
        "
      >Paused</p>

      <div class="flex flex-row gap-4">
        <button
          onclick={handleResume}
          class="cursor-pointer bg-transparent"
          style="
            font-family: 'Orbitron', monospace;
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 0.3em;
            text-transform: uppercase;
            color: #7d67d2;
            border: 1px solid rgba(125,103,210,0.5);
            padding: 0.75rem 2.5rem;
            transition: all 0.2s;
          "
          onmouseenter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(125,103,210,0.12)';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(125,103,210,0.3)';
          }}
          onmouseleave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.boxShadow = 'none';
          }}
        >Resume</button>

        <button
          onclick={handleRestart}
          class="cursor-pointer bg-transparent"
          style="
            font-family: 'Orbitron', monospace;
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 0.3em;
            text-transform: uppercase;
            color: rgba(60,52,90,0.6);
            border: 1px solid rgba(60,52,90,0.2);
            padding: 0.75rem 2.5rem;
            transition: all 0.2s;
          "
          onmouseenter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(60,52,90,0.08)';
            (e.currentTarget as HTMLElement).style.color = '#2e2840';
          }}
          onmouseleave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'rgba(60,52,90,0.6)';
          }}
        >Restart</button>

        <button
          onclick={handleQuit}
          class="cursor-pointer bg-transparent"
          style="
            font-family: 'Orbitron', monospace;
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 0.3em;
            text-transform: uppercase;
            color: rgba(60,52,90,0.6);
            border: 1px solid rgba(60,52,90,0.2);
            padding: 0.75rem 2.5rem;
            transition: all 0.2s;
          "
          onmouseenter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(60,52,90,0.08)';
            (e.currentTarget as HTMLElement).style.color = '#2e2840';
          }}
          onmouseleave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'rgba(60,52,90,0.6)';
          }}
        >Quit</button>
      </div>
    </div>
  {/if}
</div>