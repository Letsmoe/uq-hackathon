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

  <div class="flex h-[88px] flex-row items-center gap-3">
    {#if tracks.length === 0}
      <p class="text-2xs tracking-loose text-fg-dim uppercase">No plays yet</p>
    {:else}
      {#each tracks as track (track.songIndex)}
        <button
          onclick={() => onselect(track.songIndex)}
          title="{track.title} — {track.artist}"
          class="group h-[88px] w-[88px] shrink-0 cursor-pointer overflow-hidden border border-line p-0 transition-colors duration-150 hover:border-line-strong"
        >
          <img
            src={track.cover}
            alt={track.title}
            class="h-full w-full object-cover brightness-75 transition-all duration-300 group-hover:brightness-100"
          />
        </button>
      {/each}
    {/if}
  </div>
</div>
