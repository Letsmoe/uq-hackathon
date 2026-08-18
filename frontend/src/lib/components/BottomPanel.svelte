<script lang="ts">
  import UploadButton from "./UploadButton.svelte";
  import type { UploadHandler } from "./UploadButton.svelte";

  interface Props {
    notifications?: number;
    version?: string;
    onupload?: UploadHandler;
  }

  let {
    notifications = 0,
    version = "0.0.0",
    onupload = () => {},
  }: Props = $props();
</script>

<!-- Quick Play used to sit beside upload. Rerolling the selection is the
     carousel's business, so it lives on the carousel now. -->
<div class="flex h-full w-full flex-col items-end justify-end gap-4">
  <div class="flex flex-row items-stretch gap-3">
    <UploadButton {onupload} />
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
