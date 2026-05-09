<script lang="ts">
  import { ChevronLeft, ChevronRight } from "svelte-radix";

  type Song = {
    title: string;
    artist: string;
    badge: string;
    cover: string;
  };

  let { songs, selected = $bindable(1) } = $props();

  function prev() {
    if (selected > 0) selected--;
  }
  function next() {
    if (selected < songs.length - 1) selected++;
  }

  let touchStartX = $state(0);

  function getCardProps(i: number) {
    const offset = i - selected;
    const abs = Math.abs(offset);
    const sign = Math.sign(offset);

    const size = abs === 0 ? 420 : abs === 1 ? 300 : 190;
    const zIndex = 30 - abs * 5;
    const opacity = abs === 0 ? 1 : abs === 1 ? 0.85 : 0.5;

    const stepToAdj = 210 + 150 + 32; // half-center + half-adj + gap
    const stepToFar = 150 + 95 + 24; // half-adj   + half-far + gap

    let tx = 0;
    if (abs === 1) tx = sign * stepToAdj;
    if (abs === 2) tx = sign * (stepToAdj + stepToFar);
    if (abs > 2) tx = sign * (stepToAdj + stepToFar + (abs - 2) * 250);

    return { size, zIndex, opacity, tx, offset, abs };
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  }}
/>

<div
  class="relative flex flex-col items-center justify-center w-full h-full select-none overflow-hidden"
  ontouchstart={(e) => {
    touchStartX = e.touches[0].clientX;
  }}
  ontouchend={(e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (dx < -40) next();
    else if (dx > 40) prev();
  }}
>
  <!-- Cards stage -->
  <div
    class="relative w-full flex items-center justify-center"
    style="height: 440px;"
  >
    {#each songs as song, i}
      {@const p = getCardProps(i)}

      <button
        onclick={() => {
          if (p.offset < 0) prev();
          else if (p.offset > 0) next();
        }}
        aria-label={song.title}
        class="absolute top-1/2 left-1/2 overflow-hidden border-none p-0 cursor-pointer transition-all duration-500 ease-out {p.abs ===
        0
          ? 'border-2 border-accent-blue shadow-[0_0_56px_rgba(91,141,246,0.3)]'
          : p.abs === 1
            ? 'border border-white/10'
            : 'border border-white/5'}"
        style="
          width: {p.size}px;
          height: {p.size}px;
          z-index: {p.zIndex};
          opacity: {p.opacity};
          transform: translate(calc(-50% + {p.tx}px), -50%);
          pointer-events: {p.abs > 2 ? 'none' : 'auto'};
        "
      >
        <!-- Cover -->
        <img
          src={song.cover}
          alt={song.title}
          class="absolute inset-0 w-full h-full object-cover transition-all duration-500 {p.abs >
          0
            ? 'grayscale-[50%] brightness-[0.7]'
            : ''}"
        />

        <!-- Gradient -->
        <div
          class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"
        ></div>

        <!-- Index number -->
        <span
          class="absolute top-3 left-3 text-xs tracking-widest font-light {p.abs ===
          0
            ? 'text-accent-blue'
            : 'text-white/50'}"
        >
          {String(i).padStart(2, "0")}
        </span>

        <!-- Title + artist on non-center cards -->
        {#if p.abs > 0}
          <div class="absolute bottom-4 left-4">
            <p
              class="text-white/90 font-semibold tracking-widest leading-none {p.abs ===
              1
                ? 'text-sm'
                : 'text-xs'}"
            >
              {song.title}
            </p>
            <p
              class="text-white/40 tracking-widest mt-1 {p.abs === 1
                ? 'text-xs'
                : 'text-[10px]'}"
            >
              {song.artist}
            </p>
          </div>
        {/if}

        <!-- Badge letter -->
        <span
          class="absolute bottom-3 right-4 font-bold text-white/20 leading-none {p.abs ===
          0
            ? 'text-6xl'
            : p.abs === 1
              ? 'text-4xl'
              : 'text-2xl'}">{song.badge}</span
        >
      </button>
    {/each}

    <!-- Arrows -->
    <button
      onclick={prev}
      disabled={selected === 0}
      class="absolute left-6 z-50 text-on-surface/40 hover:text-on-surface/80 disabled:opacity-0 disabled:pointer-events-none transition-all duration-200 cursor-pointer bg-transparent border-none p-2"
    >
      <ChevronLeft size="36" />
    </button>

    <button
      onclick={next}
      disabled={selected === songs.length - 1}
      class="absolute right-6 z-50 text-on-surface/40 hover:text-on-surface/80 disabled:opacity-0 disabled:pointer-events-none transition-all duration-200 cursor-pointer bg-transparent border-none p-2"
    >
      <ChevronRight size="36" />
    </button>
  </div>

  <!-- Song title -->
  <div class="mt-8 flex flex-col items-center gap-1.5">
    <h2 class="text-2xl tracking-[0.6em] text-on-surface font-light">
      {songs[selected].title}
    </h2>
    <span class="text-sm tracking-[0.3em] text-on-surface/40 uppercase"
      >{songs[selected].artist}</span
    >
  </div>

  <!-- Dot indicators -->
  <div class="flex flex-row gap-2 mt-5">
    {#each songs as _, i}
      <button
        onclick={() => {
          selected = i;
        }}
        class="rounded-full transition-all duration-300 cursor-pointer border-none p-0 {i ===
        selected
          ? 'w-4 h-1.5 bg-accent-purple'
          : 'w-1.5 h-1.5 bg-on-surface/20 hover:bg-on-surface/40'}"
        aria-label="Go to {songs[i].title}"
      ></button>
    {/each}
  </div>
</div>
