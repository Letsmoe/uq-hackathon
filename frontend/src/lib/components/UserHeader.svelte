<script lang="ts">
  import ChartBarIcon from "phosphor-svelte/lib/ChartBarIcon";
  import DiamondIcon from "phosphor-svelte/lib/DiamondIcon";
  import EnvelopeIcon from "phosphor-svelte/lib/EnvelopeIcon";
  import GearIcon from "phosphor-svelte/lib/GearIcon";
  import StarIcon from "phosphor-svelte/lib/StarIcon";

  interface Props {
    username?: string;
    rating?: number;
    ratingCurrent?: number;
    ratingMax?: number;
    fragments?: number;
    memories?: number;
    avatarSrc?: string;
    unreadCount?: number;
    onmessages?: () => void;
    onstats?: () => void;
    onsettings?: () => void;
  }

  let {
    username = "ink",
    rating = 12.41,
    ratingCurrent = 2430,
    ratingMax = 8000,
    fragments = 8756,
    memories = 315,
    avatarSrc = "/ellasy.png",
    unreadCount = 0,
    onmessages = () => {},
    onstats = () => {},
    onsettings = () => {},
  }: Props = $props();

  const ratingProgress = $derived((ratingCurrent / ratingMax) * 100);

  const iconButtonClass =
    "relative flex h-14 w-14 items-center justify-center border border-line bg-raised text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg cursor-pointer";
</script>

<header class="flex flex-row items-center gap-7">
  <!-- Identity -->
  <div class="flex shrink-0 flex-row items-center gap-3">
    <div class="h-12 w-12 shrink-0 overflow-hidden border border-line">
      <img
        src={avatarSrc}
        alt="avatar"
        class="h-full w-full object-cover object-top"
      />
    </div>
    <div class="flex flex-col gap-2">
      <span class="text-base leading-none font-semibold tracking-ui text-fg">
        {username}
      </span>
      <div class="flex flex-row items-center gap-2">
        <span class="text-2xs tracking-loose text-fg-muted uppercase">
          Rating
        </span>
        <span class="text-sm leading-none font-semibold text-signal">
          {rating.toFixed(2)}
        </span>
        <div class="relative h-1 w-20 overflow-hidden bg-line">
          <div
            class="absolute top-0 left-0 h-full bg-signal transition-all duration-300"
            style="width: {ratingProgress}%"
          ></div>
        </div>
        <span class="text-2xs text-fg-dim">
          {ratingCurrent.toLocaleString()} / {ratingMax.toLocaleString()}
        </span>
      </div>
    </div>
  </div>

  <div class="h-10 w-px shrink-0 bg-line"></div>

  <!-- Currencies -->
  <div class="flex flex-row items-center gap-8">
    <div class="flex flex-col gap-1.5">
      <span class="label-caps">Fragments</span>
      <div class="flex flex-row items-center gap-2">
        <DiamondIcon size={14} weight="fill" class="shrink-0 text-fg-muted" />
        <span class="text-xl leading-none font-semibold text-fg">
          {fragments.toLocaleString()}
        </span>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <span class="label-caps">Memories</span>
      <div class="flex flex-row items-center gap-2">
        <StarIcon size={14} weight="fill" class="shrink-0 text-accent" />
        <span class="text-xl leading-none font-semibold text-fg">
          {memories.toLocaleString()}
        </span>
      </div>
    </div>
  </div>

  <div class="h-10 w-px shrink-0 bg-line"></div>

  <!-- Panels -->
  <div class="flex flex-row items-center gap-2">
    <button
      onclick={onmessages}
      title="Messages"
      aria-label="Messages"
      class={iconButtonClass}
    >
      <EnvelopeIcon size={18} />
      {#if unreadCount > 0}
        <span
          class="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center bg-accent px-1 text-2xs leading-none font-semibold text-fg"
        >
          {unreadCount}
        </span>
      {/if}
    </button>

    <button
      onclick={onstats}
      title="Stats"
      aria-label="Stats"
      class={iconButtonClass}
    >
      <ChartBarIcon size={18} />
    </button>

    <button
      onclick={onsettings}
      title="Settings"
      aria-label="Settings"
      class={iconButtonClass}
    >
      <GearIcon size={18} />
    </button>
  </div>
</header>
