<script lang="ts">
  import { Pause } from "svelte-radix";

  type Props = {
    title?: string;
    artist?: string;
    score?: number;
    combo?: number;
    tp?: number;
    difficulty?: string;
    level?: number;
    progress?: number; // 0–1
    onpause?: () => void;
  };

  let {
    title = "Stardust",
    artist = "Nhato",
    score = $bindable(628731),
    combo = $bindable(125),
    tp = $bindable(98.42),
    difficulty = "EX",
    level = 10,
    progress = 0,
    onpause = () => {},
  }: Props = $props();

  const DOTS_COLS = 8;
  const DOTS_ROWS = 2;

  const INK = "#2e2840";

  // Big numerals read as light-on-pale, so they carry their own soft shadow
  // to stay legible against the playfield.
  const NUMERAL_GLOW =
    "0 1px 2px rgba(46,40,64,0.28), 0 0 22px rgba(125,103,210,0.5), 0 0 55px rgba(125,103,210,0.25)";

  let hudBlock: HTMLElement;
  let hudHeight = $state(210);

  $effect(() => {
    if (!hudBlock) return;
    const ro = new ResizeObserver(() => {
      hudHeight = hudBlock.offsetHeight;
      const wrapper = hudBlock.closest(
        ".game-wrapper, [data-game-wrapper]",
      ) as HTMLElement | null;
      if (wrapper) wrapper.style.setProperty("--hud-height", hudHeight + "px");
    });
    ro.observe(hudBlock);
    return () => ro.disconnect();
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
  <link
    href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;600;700&family=Orbitron:wght@400;700;900&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<!-- Full overlay, pointer-events passthrough except interactive elements -->
<div
  class="absolute inset-0 pointer-events-none select-none"
  style="font-family: 'Rajdhani', sans-serif;"
>
  <!-- ── TOP HUD BLOCK ──────────────────────────────────────────────────── -->
  <div
    class="absolute top-0 left-0 right-0 flex flex-col"
    bind:this={hudBlock}
    data-hud-block
  >
    <div class="relative flex items-start justify-between px-8 pt-5">
      <!-- LEFT: pause + song info -->
      <div class="flex flex-row items-start gap-5 pointer-events-auto">
        <button
          onclick={onpause}
          class="mt-1 flex flex-col gap-[5px] cursor-pointer bg-transparent border-none p-0 transition-colors"
          style="color: rgba(46,40,64,0.7);"
          aria-label="Pause"
        >
          <Pause size="36"></Pause>
        </button>
        <div class="flex flex-col gap-0.5">
          <span
            class="text-lg tracking-widest font-light"
            style="color: {INK};">{title}</span
          >
          <span
            class="text-base"
            style="color: rgba(46,40,64,0.42); letter-spacing: 0.3em;"
            >{artist}</span
          >
        </div>
      </div>

      <!-- CENTRE: dot grid + combo -->
      <div
        class="flex flex-col items-center gap-3 absolute left-1/2 -translate-x-1/2"
      >
        <div
          class="grid gap-[6px]"
          style="grid-template-columns: repeat({DOTS_COLS}, 1fr);"
        >
          {#each Array(DOTS_COLS * DOTS_ROWS) as _, i}
            <div
              class="w-[4px] h-[4px] rounded-full"
              style="background: rgba(60,52,90,0.22);"
            ></div>
          {/each}
        </div>
        <div class="flex flex-col items-center gap-0.5">
          <span
            class="leading-none"
            style="
              font-family: 'Orbitron', monospace;
              font-size: 3.5rem;
              font-weight: 900;
              letter-spacing: 0.08em;
              color: #ffffff;
              text-shadow: {NUMERAL_GLOW};
            ">{combo}</span
          >
          <span
            class="uppercase"
            style="
              font-size: 0.6rem;
              letter-spacing: 0.4em;
              color: rgba(46,40,64,0.5);
            ">Combo</span
          >
        </div>
        <div
          class="grid gap-[6px]"
          style="grid-template-columns: repeat({DOTS_COLS}, 1fr);"
        >
          {#each Array(DOTS_COLS * DOTS_ROWS) as _, i}
            <div
              class="w-[4px] h-[4px] rounded-full"
              style="background: rgba(60,52,90,0.22);"
            ></div>
          {/each}
        </div>
      </div>

      <!-- RIGHT: score + TP -->
      <div class="flex flex-col items-end gap-3">
        <div class="flex flex-col items-end gap-0.5">
          <span
            class="uppercase"
            style="
              font-size: 0.6rem;
              letter-spacing: 0.3em;
              color: rgba(46,40,64,0.5);
            ">Score</span
          >
          <span
            class="leading-none tabular-nums"
            style="
              font-family: 'Orbitron', monospace;
              font-size: 2.6rem;
              font-weight: 700;
              letter-spacing: 0.06em;
              color: #ffffff;
              text-shadow: {NUMERAL_GLOW};
            "
          >
            {String(score).padStart(7, "0")}
          </span>
          <div
            class="mt-1"
            style="width: 100%; height: 1px; background: rgba(125,103,210,0.75);"
          ></div>
        </div>
        <div class="flex flex-col items-end gap-0.5">
          <span
            class="uppercase"
            style="
              font-size: 0.6rem;
              letter-spacing: 0.3em;
              color: rgba(46,40,64,0.4);
            ">TP</span
          >
          <span
            class="leading-none"
            style="
              font-family: 'Orbitron', monospace;
              font-size: 1.4rem;
              font-weight: 400;
              letter-spacing: 0.06em;
              color: rgba(46,40,64,0.8);
            "
          >
            {tp.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>

    <!-- ── PROGRESS BAR ──────────────────────────────────────────────────── -->
    <div class="w-full mt-6" style="height: 3px; background: rgba(60,52,90,0.12);">
      <div
        style="height: 100%; width: {progress *
          100}%; background: linear-gradient(90deg, #7d67d2, #b07cff); box-shadow: 0 0 10px rgba(125,103,210,0.6); transition: width 0.08s linear;"
      ></div>
    </div>
  </div>

  <!-- ── BOTTOM LEFT: logo watermark ────────────────────────────────────── -->
  <div class="absolute bottom-6 left-8 flex flex-row items-center gap-4">
    <svg
      class="w-9 h-9"
      style="color: rgba(60,52,90,0.4);"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
    >
      <line x1="20" y1="2" x2="20" y2="38" />
      <line x1="2" y1="20" x2="38" y2="20" />
      <line x1="6.1" y1="6.1" x2="33.9" y2="33.9" />
      <line x1="33.9" y1="6.1" x2="6.1" y2="33.9" />
      <line x1="20" y1="2" x2="15" y2="8" /><line x1="20" y1="2" x2="25" y2="8" />
      <line x1="20" y1="38" x2="15" y2="32" /><line
        x1="20"
        y1="38"
        x2="25"
        y2="32"
      />
      <line x1="2" y1="20" x2="8" y2="15" /><line x1="2" y1="20" x2="8" y2="25" />
      <line x1="38" y1="20" x2="32" y2="15" /><line
        x1="38"
        y1="20"
        x2="32"
        y2="25"
      />
    </svg>
    <div class="flex flex-col gap-0.5">
      <span
        class="uppercase leading-none"
        style="font-size: 0.72rem; letter-spacing: 0.34em; color: rgba(46,40,64,0.62);"
        >Synapse</span
      >
      <span
        class="uppercase leading-none"
        style="font-size: 0.6rem; letter-spacing: 0.28em; color: rgba(46,40,64,0.38);"
        >Rhythm Protocol</span
      >
    </div>
  </div>

  <!-- ── BOTTOM RIGHT: difficulty badge ─────────────────────────────────── -->
  <div class="absolute bottom-6 right-8 flex flex-row items-end gap-3">
    <div style="width: 1px; height: 3rem; background: rgba(125,103,210,0.7);"></div>
    <div class="flex flex-col items-start gap-0.5">
      <span
        class="leading-none"
        style="
          font-family: 'Orbitron', monospace;
          font-size: 2rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          color: #7d67d2;
        ">{difficulty}</span
      >
      <span
        class="tracking-widest"
        style="font-size: 0.75rem; color: rgba(46,40,64,0.45);"
        >Lv. {level}</span
      >
    </div>
  </div>
</div>
