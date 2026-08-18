<script lang="ts">
  import { ChevronLeft, ChevronRight } from "svelte-radix";

  import type { MouseEventHandler } from "svelte/elements";
  import { DIFFICULTIES } from "../chartGeneration";
  import type { Difficulty } from "../chartGeneration";

  interface Props {
    title?: string;
    artist?: string;
    description?: string;
    difficulty?: Difficulty;
    level?: number;
    maxLevel?: number;
    bestScore?: number;
    badge?: string;
    /** True while the chart for the picked difficulty is still being generated. */
    generating?: boolean;
    canStart?: boolean;
    ondifficultychange?: (difficulty: Difficulty) => void;
    onstart?: MouseEventHandler<HTMLButtonElement>;
  }

  let {
    title = "STARDUST",
    artist = "Nhato",
    description = "Drift beyond the silence,\nwhere light becomes fragment.",
    difficulty = "hard",
    level = $bindable(8),
    maxLevel = 15,
    bestScore = 0,
    badge = "S",
    generating = false,
    canStart = true,
    ondifficultychange = () => {},
    onstart = () => {},
  }: Props = $props();

  const difficultyColor: Record<Difficulty, string> = {
    easy: "text-green-400",
    normal: "text-accent-blue",
    hard: "text-accent-purple",
    expert: "text-orange-400",
    chaos: "text-red-500",
  };

  const difficultyIndex = $derived(DIFFICULTIES.indexOf(difficulty));

  function decreaseLevel() {
    if (level > 1) level--;
  }
  function increaseLevel() {
    if (level < maxLevel) level++;
  }

  function easierDifficulty() {
    if (difficultyIndex <= 0) return;
    ondifficultychange(DIFFICULTIES[difficultyIndex - 1]);
  }

  function harderDifficulty() {
    if (difficultyIndex >= DIFFICULTIES.length - 1) return;
    ondifficultychange(DIFFICULTIES[difficultyIndex + 1]);
  }

  function startLabel(isGenerating: boolean) {
    if (isGenerating) return "GENERATING";
    return "START";
  }
</script>

<div class="flex flex-col items-center gap-6 w-full px-8 py-6">
  <!-- Description -->
  <p
    class="text-on-surface/35 tracking-[0.25em] text-xs text-center uppercase leading-relaxed whitespace-pre-line"
  >
    {description}
  </p>

  <!-- Stats row -->
  <div class="flex flex-row items-center justify-center gap-16 w-full mt-2">
    <!-- Difficulty picker -->
    <div class="flex flex-col items-center gap-1">
      <span class="text-[0.6rem] tracking-[0.2em] text-on-surface/35 uppercase"
        >Difficulty</span
      >
      <div class="flex flex-row items-center gap-3">
        <button
          onclick={easierDifficulty}
          disabled={generating || difficultyIndex <= 0}
          class="text-on-surface/30 hover:text-on-surface/70 disabled:opacity-20 transition-colors cursor-pointer bg-transparent border-none p-0"
        >
          <ChevronLeft size="20" />
        </button>

        <span
          class="w-28 text-center text-base font-semibold tracking-widest uppercase transition-opacity duration-200 {difficultyColor[
            difficulty
          ]}"
          class:opacity-40={generating}>{difficulty}</span
        >

        <button
          onclick={harderDifficulty}
          disabled={generating || difficultyIndex >= DIFFICULTIES.length - 1}
          class="text-on-surface/30 hover:text-on-surface/70 disabled:opacity-20 transition-colors cursor-pointer bg-transparent border-none p-0"
        >
          <ChevronRight size="20" />
        </button>
      </div>
    </div>

    <!-- Level picker -->
    <div class="flex flex-row items-center gap-5">
      <button
        onclick={decreaseLevel}
        disabled={level <= 1}
        class="text-on-surface/30 hover:text-on-surface/70 disabled:opacity-20 transition-colors cursor-pointer bg-transparent border-none p-0"
      >
        <ChevronLeft size="24" />
      </button>

      <div class="flex flex-col items-center gap-0.5">
        <span
          class="text-5xl font-semibold text-on-surface tracking-tight leading-none"
        >
          {String(level).padStart(2, "0")}
        </span>
        <span
          class="text-[0.6rem] tracking-[0.25em] text-on-surface/35 uppercase"
          >Level</span
        >
      </div>

      <button
        onclick={increaseLevel}
        disabled={level >= maxLevel}
        class="text-on-surface/30 hover:text-on-surface/70 disabled:opacity-20 transition-colors cursor-pointer bg-transparent border-none p-0"
      >
        <ChevronRight size="24" />
      </button>
    </div>

    <!-- Best score -->
    <div class="flex flex-row items-end gap-3">
      <div class="flex flex-col items-end gap-1">
        <span
          class="text-[0.6rem] tracking-[0.2em] text-on-surface/35 uppercase"
          >Best Score</span
        >
        <span
          class="text-base font-semibold tracking-widest text-on-surface/80"
        >
          {String(bestScore).padStart(7, "0")}
        </span>
      </div>
      <span class="text-2xl font-bold text-accent-purple/60 leading-none mb-0.5"
        >{badge}</span
      >
    </div>
  </div>

  <!-- Start button -->
  <button
    onclick={onstart}
    disabled={generating || !canStart}
    class="relative mt-4 flex flex-row items-center justify-center gap-6 bg-surface-dark text-on-surface-dark px-32 py-7 text-2xl tracking-[0.75em] uppercase border-l-4 border-l-accent-purple shadow-xl cursor-pointer border-none transition-opacity duration-200 hover:opacity-90 active:opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
    style="clip-path: polygon(0 0, calc(100% - 40px) 0, 100% 50%, calc(100% - 40px) 100%, 0 100%);"
  >
    {startLabel(generating)}
    <!-- Arrow triangle -->
    <svg
      class="w-3 h-3 fill-on-surface-dark/50 shrink-0 ml-2"
      viewBox="0 0 10 10"
    >
      <polygon points="0,0 10,5 0,10" />
    </svg>
  </button>
</div>
