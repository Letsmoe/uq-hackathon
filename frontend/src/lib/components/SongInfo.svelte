<script lang="ts">
  import type { MouseEventHandler } from "svelte/elements";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import ShuffleIcon from "phosphor-svelte/lib/ShuffleIcon";
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
    onshuffle?: () => void;
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
    onshuffle = () => {},
  }: Props = $props();

  /** The picked difficulty fills with its own status colour; the rest stay
   *  white blocks, so the grade reads as a state and not as decoration. */
  const difficultyFill: Record<Difficulty, string> = {
    easy: "bg-success",
    normal: "bg-signal",
    hard: "bg-accent",
    expert: "bg-warning",
    chaos: "bg-danger",
  };

  function difficultyClass(option: Difficulty) {
    if (option === difficulty) {
      return `${difficultyFill[option]} text-ink-fg`;
    }
    return "bg-raised text-fg hover:bg-hover";
  }

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

<div class="flex w-full flex-col items-center gap-3">
  <!-- Description and score share a line. They are both one short string, and
       the row each used to hold came out of the carousel's height. -->
  <div class="flex w-full flex-row items-center justify-between gap-6">
    <p
      class="truncate text-2xs leading-none font-bold tracking-loose text-fg-muted uppercase"
    >
      {description}
    </p>

    <div class="flex shrink-0 flex-row items-center gap-3">
      <span class="label-caps">Best</span>
      <span
        class="text-lg leading-none font-black tracking-num text-fg tabular-nums"
      >
        {scoreDigits}
      </span>
      <span
        class="border-hard cut-sm bg-accent px-2.5 py-1 text-base leading-none font-black text-ink-fg"
      >
        {badge}
      </span>
    </div>
  </div>

  <!-- Difficulty — one target per difficulty beats a pair of tiny arrows -->
  <div class="flex w-full flex-row gap-3">
    {#each DIFFICULTIES as option (option)}
      <button
        onclick={() => ondifficultychange(option)}
        disabled={generating}
        class="hard-press border-hard cut flex h-[clamp(44px,6.5vh,64px)] min-w-24 flex-1 cursor-pointer items-center justify-center text-base font-black tracking-ui uppercase transition-colors duration-150 disabled:cursor-not-allowed {difficultyClass(
          option,
        )}"
      >
        {option}
      </button>
    {/each}
  </div>

  <!-- Start, with the reroll beside it: both are ways of choosing what to
       play next, so they belong on the same line. -->
  <div class="flex w-full flex-row items-stretch justify-center gap-3">
    <button
      onclick={onstart}
      disabled={generating || !canStart}
      class="hard-press border-hard cut flex h-[clamp(52px,8vh,84px)] w-full max-w-[640px] cursor-pointer flex-row items-center justify-center gap-5 bg-accent text-2xl font-black tracking-display text-ink-fg uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-hover disabled:text-fg-dim"
    >
      {startLabel}
      <svg class="h-7 w-7 shrink-0 fill-current" viewBox="0 0 10 10">
        <polygon points="0,0 10,5 0,10" />
      </svg>
    </button>

    <button
      onclick={onshuffle}
      title="Random song"
      aria-label="Random song"
      class="hard-press border-hard cut flex aspect-square h-[clamp(52px,8vh,84px)] shrink-0 cursor-pointer items-center justify-center bg-raised text-fg transition-colors duration-150 hover:bg-hover"
    >
      <ShuffleIcon size={26} weight="bold" />
    </button>
  </div>
</div>
