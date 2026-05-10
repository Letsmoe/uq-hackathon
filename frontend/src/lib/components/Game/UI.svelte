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
    onpause = () => {},
  }: Props = $props();

  // Dot grid config
  const DOTS_COLS = 8;
  const DOTS_ROWS = 2;
</script>

<!-- Full overlay, pointer-events passthrough except interactive elements -->
<div class="absolute inset-0 pointer-events-none select-none">
  <!-- ── TOP LEFT: pause + song info ──────────────────────────────────── -->
  <div
    class="absolute top-6 left-8 flex flex-row items-start gap-5 pointer-events-auto"
  >
    <button
      onclick={onpause}
      class="mt-1 flex flex-col gap-[5px] cursor-pointer bg-transparent border-none p-0 group text-white/70 hover:text-white transition-colors"
      aria-label="Pause"
    >
      <Pause size="36"></Pause>
    </button>
    <div class="flex flex-col gap-0.5">
      <span class="text-lg tracking-widest text-white font-light"
        >{title}</span
      >
      <span class="text-base tracking-widest text-white/40"
        >{artist}</span
      >
    </div>
  </div>

  <!-- ── TOP CENTER: dot grid + combo ─────────────────────────────────── -->
  <div
    class="absolute top-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3"
  >
    <!-- Dot grid -->
    <div
      class="grid gap-[6px]"
      style="grid-template-columns: repeat({DOTS_COLS}, 1fr);"
    >
      {#each Array(DOTS_COLS * DOTS_ROWS) as _, i}
        <div class="w-[4px] h-[4px] rounded-full bg-white/20"></div>
      {/each}
    </div>

    <!-- Combo -->
    <div class="flex flex-col items-center gap-0.5">
      <span
        class="text-6xl font-extralight tracking-widest text-white leading-none"
      >
        {combo}
      </span>
      <span
        class="text-[0.6rem] tracking-[0.4em] text-white/35 uppercase"
        >Combo</span
      >
    </div>

    <!-- Dot grid (mirror below) -->
    <div
      class="grid gap-[6px]"
      style="grid-template-columns: repeat({DOTS_COLS}, 1fr);"
    >
      {#each Array(DOTS_COLS * DOTS_ROWS) as _, i}
        <div class="w-[4px] h-[4px] rounded-full bg-white/20"></div>
      {/each}
    </div>
  </div>

  <!-- ── TOP RIGHT: score + TP ─────────────────────────────────────────── -->
  <div class="absolute top-5 right-8 flex flex-col items-end gap-3">
    <div class="flex flex-col items-end gap-0.5">
      <span
        class="text-[0.6rem] tracking-[0.3em] text-white/35 uppercase"
        >Score</span
      >
      <span
        class="text-5xl font-extralight tracking-wider text-white leading-none tabular-nums"
      >
        {String(score).padStart(7, "0")}
      </span>
    </div>
    <div class="flex flex-col items-end gap-0.5">
      <span
        class="text-[0.6rem] tracking-[0.3em] text-white/35 uppercase"
        >TP</span
      >
      <span
        class="text-2xl font-light tracking-wider text-white leading-none"
      >
        {tp.toFixed(2)}%
      </span>
    </div>
  </div>

  <!-- ── BOTTOM LEFT: logo watermark ──────────────────────────────────── -->
  <div class="absolute bottom-6 left-8 flex flex-row items-center gap-4">
    <!-- Snowflake / asterisk logo icon -->
    <svg
      class="w-9 h-9 text-white/30"
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
      <!-- tick marks -->
      <line x1="20" y1="2" x2="15" y2="8" />
      <line x1="20" y1="2" x2="25" y2="8" />
      <line x1="20" y1="38" x2="15" y2="32" />
      <line x1="20" y1="38" x2="25" y2="32" />
      <line x1="2" y1="20" x2="8" y2="15" />
      <line x1="2" y1="20" x2="8" y2="25" />
      <line x1="38" y1="20" x2="32" y2="15" />
      <line x1="38" y1="20" x2="32" y2="25" />
    </svg>

    <img src="/logo.png" class="w-1/4" />
  </div>

  <!-- ── BOTTOM RIGHT: difficulty badge ───────────────────────────────── -->
  <div class="absolute bottom-6 right-8 flex flex-row items-end gap-3">
    <div class="w-px h-12 bg-accent-purple/60"></div>
    <div class="flex flex-col items-start gap-0.5">
      <span
        class="text-4xl font-light tracking-widest text-accent-purple leading-none"
        >{difficulty}</span
      >
      <span class="text-xs tracking-widest text-white/35">Lv. {level}</span
      >
    </div>
  </div>
</div>