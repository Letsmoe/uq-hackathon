<script lang="ts">
  import type { MouseEventHandler } from "svelte/elements";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { DIFFICULTIES } from "../chartGeneration";
  import type { Difficulty } from "../chartGeneration";

  const SCORE_COUNT_MS = 520;

  interface Props {
    description?: string;
    difficulty?: Difficulty;
    bestScore?: number;
    badge?: string;
    /** True while the chart for the picked difficulty is still being generated. */
    generating?: boolean;
    canStart?: boolean;
    ondifficultychange?: (difficulty: Difficulty) => void;
    onstart?: MouseEventHandler<HTMLButtonElement>;
  }

  let {
    description = "",
    difficulty = "normal",
    bestScore = 0,
    badge = "S",
    generating = false,
    canStart = true,
    ondifficultychange = () => {},
    onstart = () => {},
  }: Props = $props();

  const difficultyColor: Record<Difficulty, string> = {
    easy: "text-success",
    normal: "text-signal",
    hard: "text-accent",
    expert: "text-warning",
    chaos: "text-danger",
  };

  const startLabel = $derived.by(() => {
    if (generating) {
      return "Generating";
    }
    return "Start";
  });

  // The score counts up to the newly selected song's best rather than
  // swapping, so switching songs reads as a change and not a redraw.
  const countedScore = new Tween(bestScore, {
    duration: SCORE_COUNT_MS,
    easing: cubicOut,
  });

  $effect(() => {
    countedScore.target = bestScore;
  });

  const scoreDigits = $derived(
    String(Math.round(countedScore.current)).padStart(7, "0"),
  );
</script>

<div class="flex h-full w-full flex-col items-center justify-end gap-3">
  <p
    class="h-4 text-center text-2xs leading-none tracking-loose text-fg-muted uppercase"
  >
    {description}
  </p>

  <!-- Difficulty — one target per difficulty beats a pair of tiny arrows -->
  <div class="flex w-full flex-row gap-2">
    {#each DIFFICULTIES as option (option)}
      <button
        onclick={() => ondifficultychange(option)}
        disabled={generating}
        class="flex h-12 flex-1 cursor-pointer items-center justify-center border text-sm font-semibold tracking-ui uppercase transition-colors duration-150 disabled:cursor-not-allowed {option ===
        difficulty
          ? `border-line-strong bg-raised ${difficultyColor[option]}`
          : 'border-line bg-canvas/40 text-fg-dim hover:bg-raised hover:text-fg-muted'}"
      >
        {option}
      </button>
    {/each}
  </div>

  <!-- Score readout -->
  <div class="flex w-full flex-row items-baseline justify-center gap-4">
    <span class="label-caps">Best Score</span>
    <span class="text-xl leading-none font-semibold tracking-num text-fg tabular-nums">
      {scoreDigits}
    </span>
    <span class="text-2xl leading-none font-bold text-accent">{badge}</span>
  </div>

  <!-- Start -->
  <button
    onclick={onstart}
    disabled={generating || !canStart}
    class="clip-arrow-right flex h-[76px] w-[560px] cursor-pointer flex-row items-center justify-center gap-4 border-none bg-ink pr-10 text-2xl tracking-display text-ink-fg uppercase transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
  >
    {startLabel}
    <svg class="h-4 w-4 shrink-0 fill-ink-fg/50" viewBox="0 0 10 10">
      <polygon points="0,0 10,5 0,10" />
    </svg>
  </button>
</div>
