<script lang="ts">
  export let username = 'ink"';
  export let rating = 12.41;
  export let ratingCurrent = 2430;
  export let ratingMax = 8000;
  export let fragments = 8756;
  export let memories = 315;
  export let avatarSrc = "/ellasy.png";

  $: ratingProgress = (ratingCurrent / ratingMax) * 100;
  $: formattedFragments = fragments.toLocaleString();
</script>

<header
  class="ml-auto flex flex-row justify-end items-center h-20 px-8 border-b border-black/8"
>
  <!-- Left: Avatar + Identity -->
  <div class="flex flex-row items-center gap-4 shrink-0">
    <div class="w-13 h-13 overflow-hidden shrink-0 border border-black/10">
      <img
        src={avatarSrc}
        alt="avatar"
        class="w-full h-full object-cover object-top"
      />
    </div>
    <div class="flex flex-col gap-1.5">
      <span class="text-base text-on-surface tracking-wide leading-none"
        >{username}</span
      >
      <div class="flex flex-row items-center gap-2">
        <span class="text-[0.6rem] tracking-widest text-on-surface/35 uppercase"
          >RATING</span
        >
        <span class="text-sm font-semibold text-accent-blue tracking-wide"
          >{rating.toFixed(2)}</span
        >
        <div class="w-20 h-0.5 bg-black/10 relative overflow-hidden">
          <div
            class="absolute left-0 top-0 h-full bg-accent-blue transition-all duration-300"
            style="width: {ratingProgress}%"
          ></div>
        </div>
        <span class="text-[0.6rem] text-on-surface/25 tracking-wide"
          >{ratingCurrent.toLocaleString()} / {ratingMax.toLocaleString()}</span
        >
      </div>
    </div>
  </div>

  <!-- Divider -->
  <div class="w-px h-9 bg-black/10 mx-8 shrink-0"></div>

  <!-- Middle: Stats -->
  <div class="flex flex-row items-center gap-10">
    <div class="flex flex-col gap-1">
      <span class="text-[0.6rem] tracking-[0.14em] text-on-surface/35 uppercase"
        >FRAGMENTS</span
      >
      <div class="flex flex-row items-center gap-2">
        <svg
          class="w-3.5 h-3.5 shrink-0 text-on-surface/70"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M8 1L15 8L8 15L1 8Z" />
        </svg>
        <span
          class="text-xl font-medium text-on-surface tracking-tight leading-none"
          >{formattedFragments}</span
        >
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <span class="text-[0.6rem] tracking-[0.14em] text-on-surface/35 uppercase"
        >MEMORIES</span
      >
      <div class="flex flex-row items-center gap-2">
        <svg
          class="w-3.5 h-3.5 shrink-0 text-accent-purple"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path
            d="M8 1L9.8 6.2H15.3L10.9 9.4L12.6 14.6L8 11.4L3.4 14.6L5.1 9.4L0.7 6.2H6.2L8 1Z"
          />
        </svg>
        <span
          class="text-xl font-medium text-on-surface tracking-tight leading-none"
          >{memories}</span
        >
      </div>
    </div>
  </div>

  <!-- Divider -->
  <div class="w-px h-9 bg-black/10 mx-8 shrink-0"></div>

  <!-- Right: Action Icons -->
  <div class="flex flex-row items-center gap-6">
    <button
      class="p-1.5 flex items-center justify-center text-on-surface/30 hover:text-on-surface/70 transition-colors duration-200 cursor-pointer"
      title="Messages"
    >
      <svg
        class="w-5 h-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M2 7l10 7 10-7" />
      </svg>
    </button>
    <button
      class="p-1.5 flex items-center justify-center text-on-surface/30 hover:text-on-surface/70 transition-colors duration-200 cursor-pointer"
      title="Stats"
    >
      <svg
        class="w-5 h-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <rect x="2" y="13" width="4" height="8" rx="0.5" />
        <rect x="10" y="8" width="4" height="13" rx="0.5" />
        <rect x="18" y="3" width="4" height="18" rx="0.5" />
      </svg>
    </button>
    <button
      class="p-1.5 flex items-center justify-center text-on-surface/30 hover:text-on-surface/70 transition-colors duration-200 cursor-pointer"
      title="Settings"
    >
      <svg
        class="w-5 h-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
    </button>
  </div>
</header>
