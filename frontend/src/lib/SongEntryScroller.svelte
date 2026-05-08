<script lang="ts">
  import type { Song } from "./types";
  let {
    songs,
    slant,
    selectedSong = $bindable(),
  }: { songs: Song[]; slant: number; selectedSong: Song } = $props();

  let listEl: HTMLElement = $state(undefined!);
  let currentOffset = $state(0);
  let selected: number | null = $state(null);
  let velocity = 0;
  let rafId: number;
  const ITEMS_VISIBLE = 10;

  function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
  }

  function applyMomentum() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (Math.abs(velocity) < 0.01) return;
      velocity *= 0.75; // friction — lower = stops faster
      currentOffset = clamp(
        currentOffset + velocity,
        0,
        songs.length - ITEMS_VISIBLE,
      );

      // keep selected within visible window
      if (selected !== null) {
        const visibleStart = Math.floor(currentOffset);
        const visibleEnd = visibleStart + ITEMS_VISIBLE - 1;
        if (selected < visibleStart) selected = visibleStart;
        if (selected > visibleEnd) selected = visibleEnd;
      }

      applyMomentum();
    });
  }

  function moveBy(delta: number) {
    velocity += delta * 0.01;
    applyMomentum();
  }
  let touchStartY = 0;

  // Need manual listeners so we can pass passive: false
  $effect(() => {
    if (!listEl) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      moveBy(e.deltaY);
    }

    function onTouchStart(e: TouchEvent) {
      touchStartY = e.touches[0].clientY;
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      const delta = touchStartY - e.touches[0].clientY;
      touchStartY = e.touches[0].clientY;
      moveBy(delta);
    }

    listEl.addEventListener("wheel", onWheel, { passive: false });
    listEl.addEventListener("touchstart", onTouchStart, { passive: true });
    listEl.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      listEl.removeEventListener("wheel", onWheel);
      listEl.removeEventListener("touchstart", onTouchStart);
      listEl.removeEventListener("touchmove", onTouchMove);
    };
  });
</script>

<div class="flex flex-col w-[25%] song-list" bind:this={listEl}>
  {#each songs.slice(Math.floor(currentOffset), Math.floor(currentOffset) + ITEMS_VISIBLE) as song, i}
    {@const absoluteIndex = Math.floor(currentOffset) + i}
    {@const margin = 12 - i * slant}
    <div
      class="song-list-entry"
      class:selected={selected === absoluteIndex}
      style="margin-left: {margin}px;"
      onclick={() => {
        selected = absoluteIndex;

        selectedSong = songs[absoluteIndex];
      }}
    >
      <div class="flex flex-col">
        <h2 class="heading font-semibold text-white">{song.title}</h2>
        <p class="opacity-60 text">{song.artist}</p>
      </div>
      <div class="flex flex-col difficulty-indicator-container">
        <p class="heading font-bold">{song.difficulty}</p>
        <p class="subheading">{song.difficulty}</p>
      </div>
    </div>
  {/each}
</div>

<style>
  .song-list {
    display: flex;
    flex-direction: column;
    gap: calc(0.1 * var(--h-percent));
    user-select: none;
  }

  .song-list-entry {
    transition: 0.3s ease;
    padding-left: calc(var(--slant) + 12px);
    cursor: pointer;
    height: calc(10 * var(--h-percent));

    padding-right: calc(2 * var(--w-percent));
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: white;
    background: rgba(0, 0, 0, 0.5);
    clip-path: polygon(
      var(--slant) 0,
      100% 0,
      calc(100% - var(--slant)) 100%,
      0 100%
    );

    .difficulty-indicator-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;

      height: 100%;
      width: 25%;
      padding-left: 4%;
      padding-right: 4%;
      clip-path: polygon(
        var(--slant) 0,
        100% 0,
        calc(100% - var(--slant)) 100%,
        0 100%
      );
    }

    &.selected {
      width: 110%;
      position: relative;
      left: -5%;
      background: rgba(0, 0, 0, 0.8);
    }

    &.selected .difficulty-indicator-container {
      background: white;
      color: black;
    }
  }
</style>
