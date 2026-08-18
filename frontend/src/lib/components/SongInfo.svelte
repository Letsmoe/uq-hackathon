<script lang="ts">
  import type { MouseEventHandler } from "svelte/elements";
  import { DIFFICULTIES } from "../chartGeneration";
  import type { Difficulty } from "../chartGeneration";

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
    <span class="text-xl leading-none font-semibold tracking-num text-fg">
      {String(bestScore).padStart(7, "0")}
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
