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
  }: Props = $props()

  const DOTS_COLS = 8;
  const DOTS_ROWS = 2;
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
<div class="absolute inset-0 pointer-events-none select-none" style="font-family: 'Rajdhani', sans-serif;">

  <!-- ── PROGRESS BAR (top edge) ───────────────────────────────────────── -->
  <div class="absolute top-0 left-0 right-0 h-[3px] bg-white/10">
    <div
      class="h-full transition-none"
      style="width: {progress * 100}%; background: linear-gradient(90deg, #00f5ff, #cc00ff); box-shadow: 0 0 8px #00f5ff;"
    ></div>
  </div>

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
      <span class="text-lg tracking-widest text-white font-light" style="font-family: 'Rajdhani', sans-serif;">{title}</span>
      <span class="text-base tracking-widest text-white/40" style="font-family: 'Rajdhani', sans-serif; letter-spacing: 0.3em;">{artist}</span>
    </div>
  </div>

  <!-- ── TOP CENTER: dot grid + combo ─────────────────────────────────── -->
  <div
    class="absolute top-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3"
  >
    <div class="grid gap-[6px]" style="grid-template-columns: repeat({DOTS_COLS}, 1fr);">
      {#each Array(DOTS_COLS * DOTS_ROWS) as _, i}
        <div class="w-[4px] h-[4px] rounded-full bg-white/20"></div>
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
          text-shadow: 0 0 18px #cc00ff, 0 0 40px #aa00dd, 0 0 70px rgba(180,0,255,0.4);
        "
      >{combo}</span>
      <span
        class="uppercase"
        style="
          font-family: 'Rajdhani', sans-serif;
          font-size: 0.6rem;
          letter-spacing: 0.4em;
          color: rgba(200,100,255,0.55);
        "
      >Combo</span>
    </div>
    <div class="grid gap-[6px]" style="grid-template-columns: repeat({DOTS_COLS}, 1fr);">
      {#each Array(DOTS_COLS * DOTS_ROWS) as _, i}
        <div class="w-[4px] h-[4px] rounded-full bg-white/20"></div>
      {/each}
    </div>
  </div>

  <!-- ── TOP RIGHT: score + TP ─────────────────────────────────────────── -->
  <div class="absolute top-5 right-8 flex flex-col items-end gap-3">
    <div class="flex flex-col items-end gap-0.5">
      <span
        class="uppercase"
        style="
          font-family: 'Rajdhani', sans-serif;
          font-size: 0.6rem;
          letter-spacing: 0.3em;
          color: rgba(200,100,255,0.55);
        "
      >Score</span>
      <span
        class="leading-none tabular-nums"
        style="
          font-family: 'Orbitron', monospace;
          font-size: 2.6rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #ffffff;
          text-shadow: 0 0 16px #cc00ff, 0 0 36px #aa00dd, 0 0 60px rgba(180,0,255,0.35);
        "
      >
        {String(score).padStart(7, "0")}
      </span>
    </div>
    <div class="flex flex-col items-end gap-0.5">
      <span
        class="uppercase"
        style="
          font-family: 'Rajdhani', sans-serif;
          font-size: 0.6rem;
          letter-spacing: 0.3em;
          color: rgba(255,255,255,0.35);
        "
      >TP</span>
      <span
        class="leading-none"
        style="
          font-family: 'Orbitron', monospace;
          font-size: 1.4rem;
          font-weight: 400;
          letter-spacing: 0.06em;
          color: rgba(255,255,255,0.85);
        "
      >
        {tp.toFixed(2)}%
      </span>
    </div>
  </div>

  <!-- ── BOTTOM LEFT: logo watermark ──────────────────────────────────── -->
  <div class="absolute bottom-6 left-8 flex flex-row items-center gap-4">
    <svg class="w-9 h-9 text-white/30" viewBox="0 0 40 40" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <line x1="20" y1="2" x2="20" y2="38" />
      <line x1="2" y1="20" x2="38" y2="20" />
      <line x1="6.1" y1="6.1" x2="33.9" y2="33.9" />
      <line x1="33.9" y1="6.1" x2="6.1" y2="33.9" />
      <line x1="20" y1="2" x2="15" y2="8" /><line x1="20" y1="2" x2="25" y2="8" />
      <line x1="20" y1="38" x2="15" y2="32" /><line x1="20" y1="38" x2="25" y2="32" />
      <line x1="2" y1="20" x2="8" y2="15" /><line x1="2" y1="20" x2="8" y2="25" />
      <line x1="38" y1="20" x2="32" y2="15" /><line x1="38" y1="20" x2="32" y2="25" />
    </svg>
    <img src="/logo.png" class="w-1/4" />
  </div>

  <!-- ── BOTTOM RIGHT: difficulty badge ───────────────────────────────── -->
  <div class="absolute bottom-6 right-8 flex flex-row items-end gap-3">
    <div class="w-px h-12 bg-accent-purple/60"></div>
    <div class="flex flex-col items-start gap-0.5">
      <span
        class="leading-none"
        style="
          font-family: 'Orbitron', monospace;
          font-size: 2rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          color: #a855f7;
        "
      >{difficulty}</span>
      <span
        class="tracking-widest text-white/35"
        style="font-family: 'Rajdhani', sans-serif; font-size: 0.75rem;"
      >Lv. {level}</span>
    </div>
  </div>
</div>