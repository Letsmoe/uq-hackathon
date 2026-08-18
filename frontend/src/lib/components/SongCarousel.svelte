<script lang="ts">
  import { Spring } from "svelte/motion";
  import { carouselMotion } from "../carouselMotion";
  import {
    OPACITY_STOPS,
    DIM_STOPS,
    metricsForStage,
    interpolateStops,
    cardShift,
    withEdgeResistance,
    clamp,
  } from "./carouselGeometry";

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
  }

  let { songs, selected = $bindable(0) }: Props = $props();

  // Continuous carousel position in song indexes. Everything on screen is a
  // function of this one number, so a drag moves the cards through the same
  // states the spring settles into.
  const position = new Spring(selected, { stiffness: 0.16, damping: 0.72 });

  let stage: HTMLElement;
  let stageWidth = $state(0);
  let stageHeight = $state(0);

  let dragging = $state(false);
  let didDrag = false;
  let dragStartX = 0;
  let dragStartIndex = 0;
  let pressedIndex = $state(-1);

  const lastIndex = $derived(songs.length - 1);
  const metrics = $derived(metricsForStage(stageWidth, stageHeight));
  // Finger travel that moves the stage by one card. Matching the on-screen
  // step means the cards stay locked to the finger for the whole drag.
  const dragPixelsPerStep = $derived(metrics.stepToAdjacent);

  $effect(() => {
    const observer = new ResizeObserver(() => measureStage());
    observer.observe(stage);
    return () => observer.disconnect();
  });

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

  function measureStage() {
    stageWidth = stage.clientWidth;
    stageHeight = stage.clientHeight;
  }

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

    const raw = dragStartIndex + travelled / dragPixelsPerStep;
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
      scale: interpolateStops(distance, metrics.scaleStops),
      opacity: interpolateStops(distance, OPACITY_STOPS),
      dim: interpolateStops(distance, DIM_STOPS),
      shift: cardShift(offset, metrics),
      // The accent frame belongs to whichever card holds the centre.
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
  class="flex h-full w-full touch-none flex-col items-center justify-center gap-3 select-none"
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onpointerleave={endDrag}
>
  <!-- Cards stage. It takes the slack in the column, and the cards size
       themselves to whatever it ends up being. -->
  <div
    class="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
    bind:this={stage}
  >
    {#each songs as song, index}
      {@const card = getCardProps(index)}

      <button
        onclick={() => handleCardClick(card.offset)}
        onpointerdown={() => (pressedIndex = index)}
        aria-label={song.title}
        class="card absolute top-1/2 left-1/2 cursor-pointer p-0"
        style="
          width: {metrics.centerSize}px;
          height: {metrics.centerSize}px;
          z-index: {card.zIndex};
          opacity: {card.opacity};
          transform: translate(-50%, -50%) translateX({card.shift}px) scale({card.scale});
          pointer-events: {card.pointerEvents};
        "
      >
        <div
          class="card-body cut border-hard relative h-full w-full overflow-hidden bg-raised"
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

          <!-- Selection chrome. Fading a ready-made frame keeps the border off
               the animated properties. -->
          <div
            class="pointer-events-none absolute inset-0 border-[6px] border-accent"
            style="opacity: {card.focus};"
          ></div>

          <!-- Index plate -->
          <span
            class="absolute top-0 left-0 border-r-hard border-b-hard bg-ink px-3 py-1.5 text-sm font-bold text-ink-fg"
          >
            {String(index).padStart(2, "0")}
          </span>

          <div
            class="absolute right-0 bottom-0 left-0 border-t-hard bg-raised px-4 py-3 text-left"
            style="opacity: {card.label};"
          >
            <p class="truncate text-lg leading-none font-bold text-fg uppercase">
              {song.title}
            </p>
            <p class="mt-1 truncate text-sm leading-none font-semibold text-fg-muted uppercase">
              {song.artist}
            </p>
          </div>

          <span
            class="absolute top-0 right-0 border-b-hard border-l-hard bg-accent px-3 py-1.5 text-sm font-black text-ink-fg"
          >
            {song.badge}
          </span>
        </div>
      </button>
    {/each}
  </div>

  <!-- Title -->
  <div class="flex shrink-0 flex-col items-center gap-1">
    <h2
      class="text-center text-xl leading-none font-black tracking-display text-fg uppercase"
    >
      {songs[selected].title}
    </h2>
    <span class="text-sm font-bold tracking-loose text-fg-muted uppercase">
      {songs[selected].artist}
    </span>
  </div>

  <!-- Dots. The mark is small, the target around it is not. -->
  <div class="flex shrink-0 flex-row gap-2">
    {#each songs as song, index}
      <button
        onclick={() => (selected = index)}
        aria-label="Go to {song.title}"
        class="flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent p-0"
      >
        <span
          class="h-3 border-hard transition-all duration-300 {index === selected
            ? 'w-10 bg-accent'
            : 'w-3 bg-raised'}"
        ></span>
      </button>
    {/each}
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
