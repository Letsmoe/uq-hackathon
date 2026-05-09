<script lang="ts">
  import { Plus, Upload } from "svelte-radix";
  import UploadButton from "./UploadButton.svelte";

  let {
    notifications = 2,
    version = "1.2.0",
    onquickplay = () => {},
    onupload = () => {},
  } = $props();
</script>

<div class="flex flex-col justify-end gap-3 w-full h-full pb-4 pr-4">
  <div class="flex flex-row items-center justify-end gap-3">
    <!-- Upload / add button -->
    <UploadButton {onupload}></UploadButton>
    <!-- Quick play card -->
    <button
      onclick={onquickplay}
      class="flex flex-row items-center gap-5 border border-on-surface-light/10 bg-on-surface-light/[0.03] hover:bg-on-surface-light/[0.07] transition-colors duration-200 px-5 py-4 cursor-pointer w-fit self-end"
    >
      <!-- Waveform icon -->
      <div class="flex flex-row items-end gap-[3px] h-8">
        {#each [0.4, 0.7, 1, 0.6, 0.9, 0.5, 1, 0.75, 0.55, 0.85, 0.45, 0.65] as h}
          <div
            class="w-[3px] bg-on-surface-light/50 rounded-sm"
            style="height: {h * 100}%"
          ></div>
        {/each}
      </div>

      <!-- Labels -->
      <div class="flex flex-col items-start gap-1">
        <span
          class="text-sm tracking-[0.3em] text-on-surface-light font-light uppercase"
          >Quick Play</span
        >
        <span
          class="text-[0.6rem] tracking-[0.2em] text-on-surface-light/50 uppercase"
          >Random Song</span
        >
      </div>
    </button>
  </div>

  <!-- Bottom info bar -->
  <div class="flex flex-row items-center justify-end gap-4">
    <!-- Notifications -->
    <div class="flex flex-row items-center gap-2">
      <span class="text-[0.6rem] tracking-[0.2em] text-on-surface/35 uppercase"
        >Notifications</span
      >
      <span
        class="text-[0.6rem] font-semibold bg-accent-purple text-white px-1.5 py-0.5 leading-none"
      >
        {notifications}
      </span>
    </div>

    <!-- Divider -->
    <div class="w-px h-3 bg-on-surface-light/15"></div>

    <!-- Version -->
    <span class="text-[0.6rem] tracking-[0.2em] text-on-surface/35 uppercase"
      >Update {version}</span
    >
  </div>
</div>
