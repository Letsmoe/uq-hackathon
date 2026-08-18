<script lang="ts">
  interface Props {
    notifications?: number;
    version?: string;
  }

  let { notifications = 0, version = "0.0.0" }: Props = $props();

  function notificationClass() {
    if (notifications > 0) {
      return "border-hard bg-accent text-ink-fg";
    }
    return "border-hard bg-raised text-fg-dim";
  }
</script>

<!-- Status line. It lives at the foot of the mode rail rather than in the
     bottom row, where it was overlapping the controls it shared a grid with. -->
<div class="flex w-full flex-col gap-2">
  <div class="flex flex-row items-center gap-2">
    <span class="label-caps">Alerts</span>
    <span
      class="cut-sm min-w-6 px-2 py-0.5 text-center text-2xs leading-none font-black {notificationClass()}"
    >
      {notifications}
    </span>
  </div>

  <span class="label-caps">Version {version}</span>
</div>
