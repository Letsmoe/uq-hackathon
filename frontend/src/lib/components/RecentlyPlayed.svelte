<script lang="ts">
  type Track = {
    id: number;
    title: string;
    artist: string;
    cover: string;
  };

  export let tracks: Track[] = [
    { id: 1, title: "Stardust", artist: "Nhato", cover: "/cover/cover-3.png" },
    { id: 2, title: "Abyss Gate", artist: "xi", cover: "/cover/cover-2.png" },
    {
      id: 3,
      title: "Skycastle",
      artist: "Camellia",
      cover: "/cover/cover-1.png",
    },
    { id: 4, title: "Cloudbreak", artist: "HiTech", cover: "/cover-image.png" },
  ];

  let selected = 0;
</script>

<div class="flex flex-col gap-4 p-6 w-full">
  <!-- Section header -->
  <div class="flex flex-row items-center gap-4">
    <div class="w-0.5 h-5 bg-surface-dark shrink-0"></div>
    <span class="text-xs tracking-[0.25em] text-on-surface/40 uppercase"
      >Recently Played</span
    >
  </div>
  <hr class="h-[0.5px] w-full bg-surface-dark/15 -my-2" />

  <!-- Cards row -->
  <div class="flex flex-row gap-4 items-end">
    {#each tracks as track, i}
      <button
        class="flex flex-col items-center gap-2 group cursor-pointer bg-transparent border-none p-0"
        onclick={() => (selected = i)}
      >
        <!-- Cover art -->
        <div
          class="relative overflow-hidden transition-all duration-300 {selected ===
          i
            ? 'border-2 border-accent-purple w-28 h-28 shadow-[0_0_24px_rgba(139,92,246,0.35)]'
            : 'border border-white/10 w-24 h-24 opacity-70 group-hover:opacity-100 group-hover:border-white/25'}"
        >
          <img
            src={track.cover}
            alt={track.title}
            class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <!-- Subtle dark overlay on unselected -->
          {#if selected !== i}
            <div
              class="absolute inset-0 bg-black/30 transition-opacity duration-300 group-hover:bg-black/10"
            ></div>
          {/if}
        </div>

        <!-- Dot indicator -->
        <div
          class="w-1.5 h-1.5 rounded-full transition-all duration-300 {selected ===
          i
            ? 'bg-accent-purple'
            : 'bg-on-surface/20 group-hover:bg-on-surface/40'}"
        ></div>
      </button>
    {/each}
  </div>
</div>
