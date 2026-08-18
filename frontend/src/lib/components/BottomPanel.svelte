<script lang="ts">
  import type { MouseEventHandler } from "svelte/elements";
  import UploadButton from "./UploadButton.svelte";
  import type { UploadHandler } from "./UploadButton.svelte";

  interface Props {
    notifications?: number;
    version?: string;
    onquickplay?: MouseEventHandler<HTMLButtonElement>;
    onupload?: UploadHandler;
  }

  let {
    notifications = 0,
    version = "0.0.0",
    onquickplay = () => {},
    onupload = () => {},
  }: Props = $props();

  const waveformBars = [0.4, 0.7, 1, 0.6, 0.9, 0.5, 1, 0.75, 0.55, 0.85];
</script>

<div class="flex h-full w-full flex-col items-end justify-end gap-4">
  <div class="flex flex-row items-stretch gap-3">
    <UploadButton {onupload} />

    <button
      onclick={onquickplay}
      class="flex h-20 cursor-pointer flex-row items-center gap-5 border border-line bg-raised px-6 transition-colors duration-150 hover:bg-hover"
    >
      <div class="flex h-9 flex-row items-end gap-[3px]">
        {#each waveformBars as height, index (index)}
          <div class="w-[3px] bg-accent" style="height: {height * 100}%"></div>
        {/each}
      </div>

      <div class="flex flex-col items-start gap-1.5">
        <span
          class="text-sm leading-none font-semibold tracking-display text-fg uppercase"
        >
          Quick Play
        </span>
        <span class="text-2xs leading-none tracking-loose text-fg-muted uppercase">
          Random Song
        </span>
      </div>
    </button>
  </div>

  <!-- Status line, sitting on the frame's bottom-right corner -->
  <div class="flex flex-row items-center gap-4">
    <div class="flex flex-row items-center gap-2">
      <span class="label-caps">Notifications</span>
      <span
        class="min-w-4 px-1 py-0.5 text-center text-2xs leading-none font-semibold {notifications >
        0
          ? 'bg-accent text-fg'
          : 'bg-raised text-fg-dim'}"
      >
        {notifications}
      </span>
    </div>

    <div class="h-3 w-px bg-line"></div>

    <span class="label-caps">Version {version}</span>
  </div>
</div>
