<script module lang="ts">
  export type RecentTrack = {
    songIndex: number;
    title: string;
    artist: string;
    cover: string;
  };
</script>

<script lang="ts">
  interface Props {
    tracks?: RecentTrack[];
    onselect?: (songIndex: number) => void;
  }

  let { tracks = [], onselect = () => {} }: Props = $props();
</script>

<!-- A column in the mode rail rather than a strip under the carousel: the
     covers sit next to their own heading and the bottom row keeps its
     centre line. -->
<div class="flex w-full flex-col gap-3">
  <div class="flex flex-row items-center gap-3">
    <div class="h-4 w-1.5 shrink-0 bg-accent"></div>
    <span class="label-caps">Recently Played</span>
  </div>

  {#if tracks.length === 0}
    <p class="text-2xs font-bold tracking-loose text-fg-dim uppercase">
      No plays yet
    </p>
  {:else}
    <div class="flex flex-col gap-2">
      {#each tracks as track (track.songIndex)}
        <button
          onclick={() => onselect(track.songIndex)}
          title="{track.title} — {track.artist}"
          class="recent-row hard-press border-hard cut-sm group"
        >
          <span class="relative h-11 w-11 shrink-0 overflow-hidden">
            <img
              src={track.cover}
              alt=""
              class="h-full w-full object-cover"
            />
            <!-- Dimmed by an overlay rather than a filter, so the hover
                 composites instead of re-rasterising the cover. -->
            <span
              class="absolute inset-0 bg-black/30 transition-opacity duration-200 group-hover:opacity-0"
            ></span>
          </span>

          <span class="flex min-w-0 flex-col items-start gap-1">
            <span
              class="w-full truncate text-2xs leading-none font-black tracking-ui text-fg uppercase"
            >
              {track.title}
            </span>
            <span
              class="w-full truncate text-2xs leading-none font-bold tracking-loose text-fg-muted uppercase"
            >
              {track.artist}
            </span>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  @reference "tailwindcss";
  @reference "../../style/global.css";

  .recent-row {
    @apply flex w-full cursor-pointer flex-row items-center gap-3 overflow-hidden bg-raised p-1.5 pr-3 text-left transition-colors duration-150;
  }

  .recent-row:hover {
    @apply bg-hover;
  }
</style>
