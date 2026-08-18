<script lang="ts">
  const SWIPE_THRESHOLD_PX = 40;
  // Fraction of the finger travel the stage mirrors before the step commits.
  const DRAG_FOLLOW_RATIO = 0.4;

  // Card sizes and the gap between neighbours, in design pixels. The stage is
  // taller than the centre card so no card can bleed into the title below it.
  const CENTER_SIZE = 320;
  const ADJACENT_SIZE = 230;
  const FAR_SIZE = 150;
  const STAGE_HEIGHT = CENTER_SIZE + 20;
  const STEP_TO_ADJACENT = CENTER_SIZE / 2 + ADJACENT_SIZE / 2 + 30;
  const STEP_TO_FAR = ADJACENT_SIZE / 2 + FAR_SIZE / 2 + 24;

  let { songs, selected = $bindable(0) } = $props();

  function prev() {
    if (selected > 0) selected--;
  }
  function next() {
    if (selected < songs.length - 1) selected++;
  }

  let dragStartX = 0;
  let didDrag = false;
  let dragging = $state(false);
  let dragOffsetX = $state(0);
  let pressedIndex = $state(-1);

  const stageOffsetX = $derived(dragOffsetX * DRAG_FOLLOW_RATIO);

  // Following the finger has to be untransitioned or it lags behind it; the
  // snap back once the finger lifts does want easing.
  const stageTransitionMs = $derived.by(() => {
    if (dragging) {
      return 0;
    }
    return 200;
  });

  function handlePointerDown(event: PointerEvent) {
    dragStartX = event.clientX;
    dragOffsetX = 0;
    dragging = true;
    didDrag = false;
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragging) {
      return;
    }

    const dx = event.clientX - dragStartX;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) {
      dragOffsetX = dx;
      return;
    }

    // Stepping here rather than on pointerup is what removes the perceived
    // lag: the carousel moves the moment the swipe is unambiguous. Resetting
    // the origin lets one long drag walk several songs.
    didDrag = true;
    dragStartX = event.clientX;
    dragOffsetX = 0;
    pressedIndex = -1;
    if (dx < 0) {
      next();
    } else {
      prev();
    }
  }

  function endDrag() {
    dragging = false;
    dragOffsetX = 0;
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

  function cardSize(distance: number) {
    if (distance === 0) {
      return CENTER_SIZE;
    }
    if (distance === 1) {
      return ADJACENT_SIZE;
    }
    return FAR_SIZE;
  }

  function cardOpacity(distance: number) {
    if (distance === 0) {
      return 1;
    }
    if (distance === 1) {
      return 0.85;
    }
    return 0.45;
  }

  function cardShift(offset: number) {
    const distance = Math.abs(offset);
    const direction = Math.sign(offset);
    if (distance === 0) {
      return 0;
    }
    if (distance === 1) {
      return direction * STEP_TO_ADJACENT;
    }
    return (
      direction * (STEP_TO_ADJACENT + STEP_TO_FAR + (distance - 2) * FAR_SIZE)
    );
  }

  function getCardProps(index: number) {
    const offset = index - selected;
    const distance = Math.abs(offset);

    return {
      offset,
      distance,
      size: cardSize(distance),
      opacity: cardOpacity(distance),
      shift: cardShift(offset),
      zIndex: 30 - distance * 5,
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
    class="relative flex w-full shrink-0 items-center justify-center overflow-hidden will-change-transform"
    style="
      height: {STAGE_HEIGHT}px;
      transform: translateX({stageOffsetX}px);
      transition: transform {stageTransitionMs}ms var(--ease-ui);
    "
  >
    {#each songs as song, index}
      {@const card = getCardProps(index)}

      <button
        onclick={() => handleCardClick(card.offset)}
        onpointerdown={() => (pressedIndex = index)}
        aria-label={song.title}
        class="absolute top-1/2 left-1/2 cursor-pointer overflow-hidden p-0 transition-all duration-300 ease-out {card.distance ===
        0
          ? 'border-2 border-accent shadow-[0_0_64px_rgba(124,107,245,0.35)]'
          : 'border border-line'}"
        style="
          width: {card.size}px;
          height: {card.size}px;
          z-index: {card.zIndex};
          opacity: {card.opacity};
          transform: translate(calc(-50% + {card.shift}px), -50%) scale({pressScale(
          index,
        )});
          pointer-events: {card.distance > 2 ? 'none' : 'auto'};
        "
      >
        <img
          src={song.cover}
          alt={song.title}
          class="absolute inset-0 h-full w-full object-cover transition-all duration-300 {card.distance >
          0
            ? 'brightness-[0.55] grayscale-[45%]'
            : ''}"
        />

        <div
          class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent"
        ></div>

        <span
          class="absolute top-3 left-3 text-xs tracking-loose {card.distance ===
          0
            ? 'text-accent'
            : 'text-white/50'}"
        >
          {String(index).padStart(2, "0")}
        </span>

        {#if card.distance > 0}
          <div class="absolute bottom-4 left-4 flex flex-col items-start gap-1">
            <p
              class="leading-none font-semibold tracking-ui text-white {card.distance ===
              1
                ? 'text-sm'
                : 'text-2xs'}"
            >
              {song.title}
            </p>
            <p
              class="text-2xs leading-none tracking-loose text-white/50 uppercase"
            >
              {song.artist}
            </p>
          </div>
        {/if}

        <span
          class="absolute right-4 bottom-3 leading-none font-bold text-white/25 {card.distance ===
          0
            ? 'text-3xl'
            : 'text-2xl'}"
        >
          {song.badge}
        </span>
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

  <!-- Dots. The mark is small, the target around it is not. -->
  <div class="mt-2 flex shrink-0 flex-row">
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
</div>
