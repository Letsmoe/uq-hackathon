<script lang="ts">
  import PauseIcon from "phosphor-svelte/lib/PauseIcon";

  type Props = {
    title?: string;
    artist?: string;
    score?: number;
    combo?: number;
    tp?: number;
    difficulty?: string;
    /** 0–1 through the song. */
    progress?: number;
    onpause?: () => void;
  };

  let {
    title = "",
    artist = "",
    score = 0,
    combo = 0,
    tp = 100,
    difficulty = "EX",
    progress = 0,
    onpause = () => {},
  }: Props = $props();

  const DOTS_COLS = 8;
  const DOTS_ROWS = 2;
  const DOT_COUNT = DOTS_COLS * DOTS_ROWS;

  let hudBlock: HTMLElement;

  // The playfield sizes itself under the HUD, so it needs the measured height
  // rather than a guess that breaks when the song title wraps.
  $effect(() => {
    if (!hudBlock) {
      return;
    }
    const observer = new ResizeObserver(() => publishHudHeight());
    observer.observe(hudBlock);
    return () => observer.disconnect();
  });

  function publishHudHeight() {
    const wrapper = hudBlock.closest("[data-game-wrapper]");
    if (!(wrapper instanceof HTMLElement)) {
      return;
    }
    wrapper.style.setProperty("--hud-height", `${hudBlock.offsetHeight}px`);
  }
</script>

<!-- Full overlay, pointer-events passthrough except interactive elements -->
<div class="hud pointer-events-none absolute inset-0 select-none">
  <!-- ── TOP HUD BLOCK ──────────────────────────────────────────────────── -->
  <div
    class="absolute top-0 right-0 left-0 flex flex-col"
    bind:this={hudBlock}
    data-hud-block
  >
    <div class="relative flex items-start justify-between px-8 pt-5">
      <!-- LEFT: pause + song info -->
      <div class="pointer-events-auto flex flex-row items-start gap-5">
        <button
          onclick={onpause}
          aria-label="Pause"
          class="mt-1 cursor-pointer border-none bg-transparent p-0 text-play-ink-muted transition-opacity duration-150 hover:opacity-70"
        >
          <PauseIcon size={32} weight="fill" />
        </button>

        <div class="flex flex-col gap-0.5">
          <span class="text-lg font-light tracking-display text-play-ink">
            {title}
          </span>
          <span class="text-base tracking-display text-play-ink-dim">
            {artist}
          </span>
        </div>
      </div>

      <!-- CENTRE: dot grid + combo -->
      <div
        class="absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-3"
      >
        {#snippet dotGrid()}
          <div
            class="grid gap-[6px]"
            style="grid-template-columns: repeat({DOTS_COLS}, 1fr);"
          >
            {#each Array(DOT_COUNT) as _, index (index)}
              <div class="h-[4px] w-[4px] rounded-full bg-play-dot"></div>
            {/each}
          </div>
        {/snippet}

        {@render dotGrid()}

        <div class="flex flex-col items-center gap-0.5">
          <!-- Keyed on the value so a new combo replays the pop. -->
          {#key combo}
            <span class="numeral combo-pop text-[3.5rem] font-black">
              {combo}
            </span>
          {/key}
          <span class="hud-label text-play-ink-muted">Combo</span>
        </div>

        {@render dotGrid()}
      </div>

      <!-- RIGHT: score + TP -->
      <div class="flex flex-col items-end gap-3">
        <div class="flex flex-col items-end gap-0.5">
          <span class="hud-label text-play-ink-muted">Score</span>
          <span class="numeral text-[2.6rem] font-bold tabular-nums">
            {String(score).padStart(7, "0")}
          </span>
          <div class="mt-1 h-px w-full bg-play-accent"></div>
        </div>

        <div class="flex flex-col items-end gap-0.5">
          <span class="hud-label text-play-ink-dim">TP</span>
          <span
            class="text-[1.4rem] leading-none tabular-nums text-play-ink-muted"
            style="font-family: var(--font-numeral); letter-spacing: 0.06em;"
          >
            {tp.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>

    <!-- ── PROGRESS BAR ──────────────────────────────────────────────────── -->
    <!-- Scaled rather than resized: this advances every frame of the song, and
         a width animation would relayout the bar on each one. -->
    <div class="mt-6 h-[3px] w-full overflow-hidden bg-play-line">
      <div
        class="progress-fill h-full w-full origin-left"
        style="transform: scaleX({progress});"
      ></div>
    </div>
  </div>

  <!-- ── BOTTOM LEFT: logo watermark ────────────────────────────────────── -->
  <div class="absolute bottom-6 left-8 flex flex-row items-center gap-4">
    <svg
      class="h-9 w-9 text-play-ink-dim"
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
      <span class="hud-label leading-none text-play-ink-muted">Synapse</span>
      <span class="hud-label leading-none text-play-ink-dim">
        Rhythm Protocol
      </span>
    </div>
  </div>

  <!-- ── BOTTOM RIGHT: difficulty badge ─────────────────────────────────── -->
  <div class="absolute right-8 bottom-6 flex flex-row items-end gap-3">
    <div class="h-12 w-px bg-play-accent"></div>
    <span
      class="text-[2rem] leading-none font-bold text-play-accent"
      style="font-family: var(--font-numeral); letter-spacing: 0.12em;"
    >
      {difficulty}
    </span>
  </div>
</div>

<style>
  @reference "tailwindcss";
  @reference "../../../style/global.css";

  .hud {
    font-family: var(--font-ui);
  }

  .hud-label {
    @apply text-[0.6rem] uppercase;
    letter-spacing: 0.34em;
  }

  .numeral {
    font-family: var(--font-numeral);
    letter-spacing: 0.08em;
    line-height: 1;
    color: #ffffff;
    text-shadow: var(--shadow-numeral);
  }

  .progress-fill {
    background: linear-gradient(
      90deg,
      var(--color-play-accent),
      var(--color-play-accent-bright)
    );
    box-shadow: 0 0 10px rgba(125, 103, 210, 0.6);
  }

  @keyframes combo-pop {
    from {
      transform: scale(1.14);
    }
    to {
      transform: scale(1);
    }
  }

  .combo-pop {
    animation: combo-pop var(--duration-base) var(--ease-ui);
  }

  @media (prefers-reduced-motion: reduce) {
    .combo-pop {
      animation: none;
    }
  }
</style>
