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

<div class="flex w-full flex-col gap-3">
  <div class="flex flex-row items-center gap-3">
    <div class="h-4 w-0.5 shrink-0 bg-accent"></div>
    <span class="label-caps">Recently Played</span>
  </div>
  <div class="h-px w-full bg-line"></div>

  <div class="flex h-[68px] flex-row items-center gap-3">
    {#if tracks.length === 0}
      <p class="text-2xs tracking-loose text-fg-dim uppercase">No plays yet</p>
    {:else}
      {#each tracks as track (track.songIndex)}
        <button
          onclick={() => onselect(track.songIndex)}
          title="{track.title} — {track.artist}"
          class="group relative h-[68px] w-[68px] shrink-0 cursor-pointer overflow-hidden border-2 border-line p-0 transition-colors duration-150 hover:border-line-strong"
        >
          <img
            src={track.cover}
            alt={track.title}
            class="h-full w-full object-cover"
          />
          <!-- Dimmed by an overlay rather than a filter, so the hover
               composites instead of re-rasterising the cover. -->
          <div
            class="absolute inset-0 bg-black/30 transition-opacity duration-200 group-hover:opacity-0"
          ></div>
        </button>
      {/each}
    {/if}
  </div>
</div>
