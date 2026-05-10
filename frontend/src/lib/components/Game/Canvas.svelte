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

  let audio: HTMLAudioElement | null = null;

  onMount(async () => {
    engine = await GameEngine.create(canvas);
    if (chart) engine.loadChart(chart);

    const audioBlob = new Blob([buffer], { type: "audio/mp3" });
    audio = new Audio();
    audio.src = URL.createObjectURL(audioBlob);

    engine.onStateChange = () => {
      score = engine!.state.score;
      combo = engine!.state.combo;
      tp = engine!.state.tp;
    };

    engine.onFinish = () => onfinish(engine!.state);

    // Start audio and engine together so audio.currentTime is the shared clock.
    await audio.play();
    engine.start(audio);
  });

  onDestroy(() => {
    engine?.destroy();
    engine = null;
  });

  function handlePause() {
    engine?.pause();
    audio?.pause();
    onpause();
  }
</script>

<div class="relative w-full h-full">
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

  <canvas bind:this={canvas} class="absolute inset-0 w-full h-full"></canvas>

  <GameUI
    title={songTitle}
    {artist}
    {score}
    {combo}
    {tp}
    {difficulty}
    {level}
    onpause={handlePause}
  />
</div>