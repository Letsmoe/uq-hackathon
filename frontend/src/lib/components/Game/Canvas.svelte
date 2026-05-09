<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { GameEngine } from "../../game/Engine";
  import { STARDUST } from "../../game/chart";
  import GameUI from "./UI.svelte";
  import type { Chart } from "../../game/chart";

  let {
    chart = STARDUST as Chart,
    buffer = new ArrayBuffer(0), // Placeholder, not used in this component
    songTitle = chart.title,
    artist = chart.artist,
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
    // v8: creation is async
    engine = await GameEngine.create(canvas);
    // engine.loadChart(chart);

    const audioBlob = new Blob([buffer], { type: "audio/mp3" });
    audio = new Audio();
    audio.src = URL.createObjectURL(audioBlob);
    audio.play();

    engine.onStateChange = () => {
      score = engine!.state.score;
      combo = engine!.state.combo;
      tp = engine!.state.tp;
    };

    engine.onFinish = () => onfinish(engine!.state);

    setTimeout(() => engine?.start(), 100);
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
  <img
    src={coverSrc}
    alt=""
    class="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
  />

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
