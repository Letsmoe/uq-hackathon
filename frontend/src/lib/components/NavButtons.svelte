<script lang="ts">
  export let active: "solo" | "course" | "event" | "random" = "solo";

  const buttons = [
    {
      id: "solo",
      label: "SOLO",
      sub: "PLAY",
      shape: "slanted-right",
    },
    // {
    //   id: "course",
    //   label: "COURSE",
    //   sub: "CHALLENGE",
    //   shape: "slanted-left-right",
    // },
    // {
    //   id: "event",
    //   label: "EVENT",
    //   sub: "LIMITED",
    //   shape: "slanted-left-right",
    // },
    // {
    //   id: "random",
    //   label: "RANDOM",
    //   sub: "SURPRISE",
    //   shape: "slanted-left",
    // },
  ] as const;
</script>

<div class="flex flex-row items-stretch">
  {#each buttons as btn, i}
    <button
      class="nav-btn {btn.shape} {active === btn.id ? 'active' : ''}"
      onclick={() => (active = btn.id)}
    >
      <!-- Icon -->
      <span class="icon">
        {#if btn.id === "solo"}
          <!-- Diamond -->
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M12 2L22 12L12 22L2 12Z" />
          </svg>
        {:else if btn.id === "course"}
          <!-- Stacked layers -->
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linejoin="round"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M2 12L12 17L22 12" />
            <path d="M2 7L12 12L22 7L12 2L2 7Z" />
            <path d="M2 17L12 22L22 17" />
          </svg>
        {:else if btn.id === "event"}
          <!-- Asterisk / burst -->
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="12" y1="2" x2="12" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
          </svg>
        {:else}
          <!-- Shuffle -->
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            xmlns="http://www.w3.org/2000/svg"
          >
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
        {/if}
      </span>

      <!-- Labels -->
      <span class="labels">
        <span class="label-main">{btn.label}</span>
        <span class="label-sub">{btn.sub}</span>
      </span>
    </button>

    <!-- Divider between inactive buttons -->
    {#if i < buttons.length - 1 && !(active === btn.id || active === buttons[i + 1].id)}
      <div class="self-stretch w-px bg-on-surface/10 my-3"></div>
    {:else if i < buttons.length - 1}
      <div class="self-stretch w-px bg-transparent my-3"></div>
    {/if}
  {/each}
</div>

<style>
  @reference "tailwindcss";
  @reference "../../style/global.css";

  .nav-btn {
    @apply flex flex-row items-center gap-4 px-14 py-5 bg-transparent transition-colors duration-200 border-none cursor-pointer -mr-[26px];
  }

  /* Active: dark pill */
  .nav-btn.active {
    @apply bg-surface-dark;
  }

  /* Clip shapes */
  .slanted-right {
    clip-path: polygon(0 0, 100% 0, calc(100% - 24px) 100%, 0% 100%);
  }
  .slanted-left {
    clip-path: polygon(24px 0, 100% 0, 100% 100%, 0% 100%);
  }
  .slanted-left-right {
    clip-path: polygon(24px 0, 100% 0, calc(100% - 24px) 100%, 0% 100%);
  }

  /* Icon sizing & color */
  .icon {
    @apply w-6 h-6 shrink-0 flex items-center justify-center;
  }

  .icon svg {
    @apply w-full h-full;
  }

  /* Default (inactive) icon + text */
  .nav-btn:not(.active) .icon {
    @apply text-on-surface-light/30;
  }
  .nav-btn:not(.active) .label-main {
    @apply text-on-surface-light/40;
  }
  .nav-btn:not(.active) .label-sub {
    @apply text-on-surface-light/25;
  }
  .nav-btn:not(.active):hover .icon,
  .nav-btn:not(.active):hover .label-main {
    @apply text-on-surface-light/60;
  }

  /* Active icon + text */
  .nav-btn.active .icon {
    @apply text-accent-purple;
  }
  .nav-btn.active .label-main {
    @apply text-on-surface-dark font-semibold;
  }
  .nav-btn.active .label-sub {
    @apply text-on-surface-dark/50;
  }

  /* Label stack */
  .labels {
    @apply flex flex-col items-start;
  }
  .label-main {
    @apply text-lg tracking-widest leading-none;
  }
  .label-sub {
    @apply text-xs tracking-widest uppercase mt-1 leading-none;
  }
</style>
