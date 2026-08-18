<script lang="ts">
  import { Spring } from "svelte/motion";
  import ShuffleIcon from "phosphor-svelte/lib/ShuffleIcon";
  import { carouselMotion } from "../carouselMotion";
  import {
    CENTER_SIZE,
    STAGE_HEIGHT,
    STEP_TO_ADJACENT,
    SCALE_STOPS,
    OPACITY_STOPS,
    DIM_STOPS,
    interpolateStops,
    cardShift,
    withEdgeResistance,
    clamp,
  } from "./carouselGeometry";

  // Finger travel that moves the stage by one card. Matching the on-screen
  // step means the cards stay locked to the finger for the whole drag.
  const DRAG_PIXELS_PER_STEP = STEP_TO_ADJACENT;
  const DRAG_INTENT_PX = 12;
  const EDGE_RESISTANCE = 0.35;

  /** Only the fields the carousel puts on a card. */
  type CarouselSong = {
    title: string;
    artist: string;
    badge: string;
    cover: string;
  };

  interface Props {
    songs: CarouselSong[];
    selected?: number;
    onshuffle?: () => void;
  }

  let {
    songs,
    selected = $bindable(0),
    onshuffle = () => {},
  }: Props = $props();

  // Continuous carousel position in song indexes. Everything on screen is a
  // function of this one number, so a drag moves the cards through the same
  // states the spring settles into.
  const position = new Spring(selected, { stiffness: 0.16, damping: 0.72 });

  let dragging = $state(false);
  let didDrag = false;
  let dragStartX = 0;
  let dragStartIndex = 0;
  let pressedIndex = $state(-1);

  const lastIndex = $derived(songs.length - 1);

  $effect(() => {
    if (dragging) {
      return;
    }
    position.target = selected;
  });

  // The background shader leans with the swipe, so it needs the same position
  // the cards are placed from.
  $effect(() => {
    carouselMotion.position = position.current;
  });

  function prev() {
    if (selected > 0) selected--;
  }

  function next() {
    if (selected < songs.length - 1) selected++;
  }

  function handlePointerDown(event: PointerEvent) {
    dragStartX = event.clientX;
    dragStartIndex = selected;
    dragging = true;
    didDrag = false;
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging) {
      return;
    }

    const travelled = dragStartX - event.clientX;
    if (Math.abs(travelled) > DRAG_INTENT_PX) {
      didDrag = true;
      pressedIndex = -1;
    }

    const raw = dragStartIndex + travelled / DRAG_PIXELS_PER_STEP;
    position.set(withEdgeResistance(raw, lastIndex, EDGE_RESISTANCE), {
      instant: true,
    });
    selected = clamp(Math.round(raw), 0, lastIndex);
  }

  function endDrag() {
    dragging = false;
    pressedIndex = -1;
  }

  function handleCardClick(offset: number) {
    if (didDrag) {
      return;
    }
    if (offset < 0) {
      prev();
    } else if (offset > 0) {
      next();
    }
  }

  function pressScale(index: number) {
    if (pressedIndex === index) {
      return 0.96;
    }
    return 1;
  }

  function ramp(value: number) {
    return clamp(value, 0, 1);
  }

  /// Cards far enough off-centre to be decoration should not swallow taps
  /// meant for the ones behind them.
  function pointerEvents(distance: number) {
    if (distance < 2.6) {
      return "auto";
    }
    return "none";
  }

  function getCardProps(index: number) {
    const offset = index - position.current;
    const distance = Math.abs(offset);

    return {
      offset: index - selected,
      distance,
      scale: interpolateStops(distance, SCALE_STOPS),
      opacity: interpolateStops(distance, OPACITY_STOPS),
      dim: interpolateStops(distance, DIM_STOPS),
      shift: cardShift(offset),
      // Accent ring and glow belong to whichever card holds the centre.
      focus: ramp(1 - distance * 2),
      // The centre card's name is spelled out below the stage, so its label
      // only fades in as it leaves.
      label: ramp((distance - 0.3) * 2.5),
      zIndex: 30 - Math.round(distance) * 5,
      pointerEvents: pointerEvents(distance),
    };
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "ArrowLeft") prev();
    if (event.key === "ArrowRight") next();
  }}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex h-full w-full touch-none flex-col items-center justify-center select-none"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onpointerleave={endDrag}
>
  <!-- Cards stage. shrink-0 keeps the fixed height from collapsing under the
       flex column, which would let the absolute cards spill over the title. -->
  <div
    class="relative flex w-full shrink-0 items-center justify-center overflow-hidden"
    style="height: {STAGE_HEIGHT}px;"
  >
    {#each songs as song, index}
      {@const card = getCardProps(index)}

      <button
        onclick={() => handleCardClick(card.offset)}
        onpointerdown={() => (pressedIndex = index)}
        aria-label={song.title}
        class="card absolute top-1/2 left-1/2 cursor-pointer p-0"
        style="
          width: {CENTER_SIZE}px;
          height: {CENTER_SIZE}px;
          z-index: {card.zIndex};
          opacity: {card.opacity};
          transform: translate(-50%, -50%) translateX({card.shift}px) scale({card.scale});
          pointer-events: {card.pointerEvents};
        "
      >
        <div
          class="card-body relative h-full w-full overflow-hidden border border-line"
          style="transform: scale({pressScale(index)});"
        >
          <img
            src={song.cover}
            alt={song.title}
            class="absolute inset-0 h-full w-full object-cover"
          />

          <div
            class="absolute inset-0 bg-black"
            style="opacity: {card.dim};"
          ></div>

          <div
            class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent"
          ></div>

          <!-- Selection chrome. Fading a ready-made ring keeps the border and
               shadow off the animated properties. -->
          <div
            class="pointer-events-none absolute inset-0 border-2 border-accent shadow-[0_0_64px_rgba(124,107,245,0.35)]"
            style="opacity: {card.focus};"
          ></div>

          <!-- Cross-faded rather than recoloured: two opacities composite,
               a changing colour repaints the glyph. -->
          <span class="absolute top-3 left-3 text-base tracking-loose text-white/50">
            {String(index).padStart(2, "0")}
          </span>
          <span
            class="absolute top-3 left-3 text-base tracking-loose text-accent"
            style="opacity: {card.focus};"
          >
            {String(index).padStart(2, "0")}
          </span>

          <div
            class="absolute bottom-4 left-4 flex flex-col items-start gap-1"
            style="opacity: {card.label};"
          >
            <p class="leading-none font-semibold tracking-ui text-white text-lg">
              {song.title}
            </p>
            <p class="text-sm leading-none tracking-loose text-white/50 uppercase">
              {song.artist}
            </p>
          </div>

          <span
            class="absolute right-4 bottom-3 text-3xl leading-none font-bold text-white/25"
          >
            {song.badge}
          </span>
        </div>
      </button>
    {/each}
  </div>

  <!-- Title -->
  <div class="mt-6 flex shrink-0 flex-col items-center gap-2">
    <h2
      class="text-center text-xl leading-none font-semibold tracking-display text-fg uppercase"
    >
      {songs[selected].title}
    </h2>
    <span class="text-sm tracking-loose text-fg-muted uppercase">
      {songs[selected].artist}
    </span>
  </div>

  <!-- Dots, and the reroll that used to live on the far side of the screen.
       The mark is small, the target around it is not. -->
  <div class="mt-2 flex shrink-0 flex-row items-center gap-2">
    <div class="flex flex-row">
      {#each songs as song, index}
        <button
          onclick={() => (selected = index)}
          aria-label="Go to {song.title}"
          class="flex h-9 w-9 cursor-pointer items-center justify-center border-none bg-transparent p-0"
        >
          <span
            class="h-1.5 transition-all duration-300 {index === selected
              ? 'w-6 bg-accent'
              : 'w-2 bg-line-strong'}"
          ></span>
        </button>
      {/each}
    </div>

    {#if songs.length > 1}
      <button
        onclick={onshuffle}
        title="Random song"
        aria-label="Random song"
        class="flex h-9 w-9 cursor-pointer items-center justify-center border border-line bg-raised text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg"
      >
        <ShuffleIcon size={14} />
      </button>
    {/if}
  </div>
</div>

<style>
  .card {
    will-change: transform, opacity;
    background: none;
    border: none;
    /* The spring writes this transform every frame; a CSS transition on top
       of it would chase its own output. */
    transition: none;
  }

  /* The press dip is discrete, so it is the one thing on the card that wants
     a CSS transition rather than the spring. */
  .card-body {
    transition: transform var(--duration-fast) var(--ease-ui);
  }
</style>
