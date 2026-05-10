<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { GameEngine } from "../../game/Engine";
  import GameUI from "./UI.svelte";
  import type { Chart } from "../../game/chart";

  let {
    chart = undefined as Chart | undefined,
    buffer = new ArrayBuffer(0),
    songTitle = "",
    artist = "",
    difficulty = "EX",
    level = 10,
    coverSrc = "/ellasy.png",
    onpause = () => {},
    onfinish = (_stats: unknown) => {},
  }: {
    chart?: Chart;
    buffer?: ArrayBuffer;
    songTitle?: string;
    artist?: string;
    difficulty?: string;
    level?: number;
    coverSrc?: string;
    onpause?: () => void;
    onfinish?: (stats: unknown) => void;
  } = $props();

  let canvas: HTMLCanvasElement;
  let engine: GameEngine | null = null;

  let score = $state(0);
  let combo = $state(0);
  let tp = $state(100);
  let elapsed = $state(0);
  let paused = $state(false);

  const BOT_PAD = 80; // px: clears bottom logos
  let hudHeight = $state(0);
  let hudEl: HTMLElement | undefined; // bound to the HUD block element

  let audio: HTMLAudioElement | null = null;
  let chartLength = $state(0); // in seconds
  let rafId = 0;

  const progress = $derived(chartLength > 0 ? Math.min(1, elapsed / chartLength) : 0);

  onMount(async () => {
    engine = await GameEngine.create(canvas);

    // ── Measure HUD and set play area BEFORE loadChart ─────────────
    // Query the HUD block that UI.svelte renders. It's a sibling of the canvas
    // inside [data-game-wrapper]. We use offsetHeight for the synchronous value.
    const wrapper = canvas.closest('[data-game-wrapper]') as HTMLElement | null;
    const hud = wrapper?.querySelector('[data-hud-block]') as HTMLElement | null;
    const measuredTop = hud ? hud.offsetHeight : 210;
    hudHeight = measuredTop;
    engine.setPlayArea(measuredTop, BOT_PAD);

    // Keep play area in sync if the HUD ever resizes (e.g. font load, window resize)
    if (hud) {
      const ro = new ResizeObserver(() => {
        hudHeight = hud.offsetHeight;
        engine?.setPlayArea(hudHeight, BOT_PAD);
      });
      ro.observe(hud);
      // ro is cleaned up in onDestroy via the returned fn — store ref
      ;(canvas as any).__ro = ro;
    }

    if (chart) {
      engine.loadChart(chart);
    }

    const audioBlob = new Blob([buffer], { type: "audio/mp3" });
    audio = new Audio();
    audio.src = URL.createObjectURL(audioBlob);

    audio.addEventListener("loadedmetadata", () => {
      if (audio && isFinite(audio.duration)) {
        chartLength = audio.duration;
      }
    });

    engine.onStateChange = () => {
      score = engine!.state.score;
      combo = engine!.state.combo;
      tp = engine!.state.tp;
    };

    engine.onFinish = () => onfinish(engine!.state);

    // Drive elapsed from audio clock — reliable source of truth
    function tick() {
      if (audio && !audio.paused) {
        elapsed = audio.currentTime;
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    await audio.play();
    engine.start(audio);
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    ;(canvas as any)?.__ro?.disconnect();
    engine?.destroy();
    engine = null;
  });

  function handlePause() {
    paused = true;
    engine?.pause();
    audio?.pause();
  }

  function handleResume() {
    paused = false;
    engine?.resume();
    audio?.play();
  }

  function handleRestart() {
    paused = false;
    elapsed = 0;
    score = 0;
    combo = 0;
    tp = 100;
    if (audio) {
      audio.currentTime = 0;
      audio.play();
    }
    if (engine && chart) {
      engine.loadChart(chart);
      engine.start(audio!);
    }
  }

  function handleQuit() {
    paused = false;
    engine?.pause();
    audio?.pause();
    onpause();
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
  <link
    href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;600;700&family=Orbitron:wght@400;700;900&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="relative w-full h-full" data-game-wrapper>
  <!-- Cover art background -->
  <img
    src={coverSrc}
    alt=""
    class="absolute inset-0 w-full h-full object-cover pointer-events-none"
    style="opacity: 0.55; filter: blur(1px) brightness(0.65) saturate(0.8); transform: scale(1.02);"
  />
  <!-- Subtle vignette -->
  <div
    class="absolute inset-0 pointer-events-none"
    style="background: radial-gradient(ellipse at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.45) 100%);"
  ></div>

  <!-- Grid lines (matching main page) -->
  <div
    class="absolute inset-0 pointer-events-none"
    style="
      background-image:
        linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
      background-size: 80px 80px;
    "
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
    {level}
    {progress}
    onpause={handlePause}
  />

  <!-- ── PAUSE OVERLAY ────────────────────────────────────────────────── -->
  {#if paused}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-8"
      style="background: rgba(4,6,20,0.82); backdrop-filter: blur(6px); font-family: 'Rajdhani', sans-serif;">

      <p
        style="
          font-family: 'Orbitron', monospace;
          font-size: 1.5rem;
          font-weight: 900;
          letter-spacing: 0.6em;
          text-transform: uppercase;
          color: #cc00ff;
          text-shadow: 0 0 20px #cc00ff, 0 0 50px #aa00dd, 0 0 90px rgba(180,0,255,0.4);
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
            color: #cc00ff;
            border: 1px solid rgba(200,0,255,0.5);
            padding: 0.75rem 2.5rem;
            transition: all 0.2s;
          "
          onmouseenter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(180,0,255,0.12)';
            (e.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(180,0,255,0.3)';
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
            color: rgba(255,255,255,0.6);
            border: 1px solid rgba(255,255,255,0.2);
            padding: 0.75rem 2.5rem;
            transition: all 0.2s;
          "
          onmouseenter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
            (e.currentTarget as HTMLElement).style.color = '#fff';
          }}
          onmouseleave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)';
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
            color: rgba(255,255,255,0.6);
            border: 1px solid rgba(255,255,255,0.2);
            padding: 0.75rem 2.5rem;
            transition: all 0.2s;
          "
          onmouseenter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
            (e.currentTarget as HTMLElement).style.color = '#fff';
          }}
          onmouseleave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)';
          }}
        >Quit</button>
      </div>
    </div>
  {/if}
</div>