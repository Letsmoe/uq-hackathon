<script lang="ts">
  import type { Snippet } from "svelte";
  import XIcon from "phosphor-svelte/lib/XIcon";

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
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <section
    class="flex h-full w-[420px] flex-col border-l border-line-strong bg-overlay"
    onclick={(event) => event.stopPropagation()}
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
