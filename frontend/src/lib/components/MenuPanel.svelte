<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import XIcon from "phosphor-svelte/lib/XIcon";

  const PANEL_WIDTH = 420;
  const SCRIM_MS = 180;
  const PANEL_MS = 280;

  interface Props {
    title: string;
    subtitle?: string;
    onclose?: () => void;
    children?: Snippet;
  }

  let { title, subtitle = "", onclose = () => {}, children }: Props = $props();
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape") onclose();
  }}
/>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="absolute inset-0 z-50 flex justify-end bg-canvas/75"
  onclick={onclose}
  transition:fade={{ duration: SCRIM_MS }}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <section
    class="flex h-full flex-col border-l border-line-strong bg-overlay"
    style="width: {PANEL_WIDTH}px;"
    onclick={(event) => event.stopPropagation()}
    transition:fly={{ x: PANEL_WIDTH, duration: PANEL_MS, easing: cubicOut }}
  >
    <header
      class="flex shrink-0 items-start justify-between border-b border-line px-7 py-6"
    >
      <div class="flex flex-col gap-2">
        <h2 class="text-lg leading-none font-semibold tracking-ui text-fg uppercase">
          {title}
        </h2>
        {#if subtitle}
          <span class="label-caps">{subtitle}</span>
        {/if}
      </div>

      <button
        onclick={onclose}
        aria-label="Close"
        class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border border-line bg-raised text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg"
      >
        <XIcon size={16} weight="bold" />
      </button>
    </header>

    <div class="flex-1 overflow-y-auto px-7 py-6">
      {@render children?.()}
    </div>
  </section>
</div>
