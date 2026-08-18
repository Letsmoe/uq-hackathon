<script lang="ts">
  let { index = "01" } = $props();
</script>

<div class="flex flex-row items-center gap-4">
  <span class="text-2xs tracking-loose text-fg-dim">// {index}</span>
  <div class="h-px w-8 bg-line-strong"></div>
  <!-- The wordmark ships as dark artwork, so it is inverted onto the canvas. -->
  <img
    src="/logo.png"
    alt="Synapse: Rhythm Protocol"
    class="h-9 w-auto invert"
  />
</div>
