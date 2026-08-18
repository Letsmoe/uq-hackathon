<script lang="ts">
  interface Props {
    libraryCount?: number;
    playCount?: number;
    bestScore?: number;
    rating?: number;
    fragments?: number;
    memories?: number;
  }

  let {
    libraryCount = 0,
    playCount = 0,
    bestScore = 0,
    rating = 0,
    fragments = 0,
    memories = 0,
  }: Props = $props();

  const rows = $derived([
    { label: "Tracks in library", value: String(libraryCount) },
    { label: "Plays this session", value: String(playCount) },
    { label: "Best score", value: String(bestScore).padStart(7, "0") },
    { label: "Rating", value: rating.toFixed(2) },
    { label: "Fragments", value: fragments.toLocaleString() },
    { label: "Memories", value: memories.toLocaleString() },
  ]);
</script>

<div class="flex flex-col">
  {#each rows as row (row.label)}
    <div class="flex flex-row items-baseline justify-between border-b border-line py-3">
      <span class="label-caps">{row.label}</span>
      <span class="text-lg leading-none font-semibold tracking-num text-fg">
        {row.value}
      </span>
    </div>
  {/each}
</div>

<p class="mt-5 text-2xs leading-relaxed tracking-loose text-fg-dim uppercase">
  Progression numbers are placeholders. Only the library and play counts are
  measured.
</p>
