<script lang="ts">
  import type { Snippet } from "svelte";
  import type { MouseEventHandler } from "svelte/elements";
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import ShuffleIcon from "phosphor-svelte/lib/ShuffleIcon";
  import { DIFFICULTIES } from "../chartGeneration";
  import type { Difficulty } from "../chartGeneration";
  import { formatCount, formatDuration } from "../trackStats";
  import type { TrackStats } from "../trackStats";

  const SCORE_COUNT_MS = 520;

  interface Props {
    description?: string;
    difficulty?: Difficulty;
    /** Chart level per difficulty, so the jump between them is a number. */
    levels?: Record<Difficulty, number>;
    /** Tempo, length and note count of the picked chart. */
    stats?: TrackStats | null;
    bestScore?: number;
    badge?: string;
    /** True while the chart for the picked difficulty is still being generated. */
    generating?: boolean;
    canStart?: boolean;
    ondifficultychange?: (difficulty: Difficulty) => void;
    onstart?: MouseEventHandler<HTMLButtonElement>;
    onshuffle?: () => void;
    /** Carousel position marks, shown between the description and the score. */
    indicator?: Snippet;
  }

  let {
    description = "",
    difficulty = "normal",
    levels = { easy: 3, normal: 5, hard: 7, expert: 11, chaos: 14 },
    stats = null,
    bestScore = 0,
    badge = "S",
    generating = false,
    canStart = true,
    ondifficultychange = () => {},
    onstart = () => {},
    onshuffle = () => {},
    indicator,
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

  const PLACEHOLDER = "———";

  // One line of chart facts, read left to right: tempo, length, note count.
  const statParts = $derived.by(() => {
    if (!stats) {
      return [`${PLACEHOLDER} BPM`, PLACEHOLDER, `${PLACEHOLDER} Notes`];
    }

    return [
      `${stats.bpm} BPM`,
      formatDuration(stats.durationSeconds),
      `${formatCount(stats.noteCount)} Notes`,
    ];
  });
</script>

<div class="flex w-full flex-col items-center gap-3">
  <!-- Tempo, length and note count: what a player checks before committing to
       a run, so it sits under the title rather than in a corner. -->
  <div class="flex flex-row items-center gap-4">
    {#each statParts as part, index (part)}
      {#if index > 0}
        <span class="h-3 w-px shrink-0 bg-line opacity-40"></span>
      {/if}

      <span
        class="text-2xs leading-none font-bold tracking-loose text-fg-muted uppercase tabular-nums"
      >
        {part}
      </span>
    {/each}
  </div>

  <!-- Description, indicator and score share a line. Equal side columns put
       the indicator on the same centre line as the middle difficulty. -->
  <div class="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-6">
    <p
      class="truncate text-2xs leading-none font-bold tracking-loose text-fg-muted uppercase"
    >
      {description}
    </p>

    <div class="flex shrink-0 justify-center">
      {@render indicator?.()}
    </div>

    <div class="flex shrink-0 flex-row items-center justify-end gap-3">
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
        class="hard-press border-hard cut flex h-[clamp(52px,7.5vh,72px)] min-w-24 flex-1 cursor-pointer flex-col items-center justify-center gap-1 transition-colors duration-150 disabled:cursor-not-allowed {difficultyClass(
          option,
        )}"
      >
        <span class="text-base leading-none font-black tracking-ui uppercase">
          {option}
        </span>
        <span class="text-2xs leading-none font-black tracking-num tabular-nums opacity-80">
          LV {levels[option]}
        </span>
      </button>
    {/each}
  </div>

  <!-- Start, with the reroll beside it: both are ways of choosing what to
       play next, so they belong on the same line. -->
  <div class="flex w-full flex-row items-stretch justify-center gap-3">
    <button
      onclick={onstart}
      disabled={generating || !canStart}
      class="hard-press border-hard cut flex h-[clamp(64px,10vh,104px)] w-full max-w-[520px] cursor-pointer flex-row items-center justify-center gap-5 bg-accent text-2xl font-black tracking-display text-ink-fg uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-hover disabled:text-fg-dim"
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
      class="hard-press border-hard cut flex aspect-square h-[clamp(64px,10vh,104px)] shrink-0 cursor-pointer items-center justify-center bg-raised text-fg transition-colors duration-150 hover:bg-hover"
    >
      <ShuffleIcon size={26} weight="bold" />
    </button>
  </div>
</div>
