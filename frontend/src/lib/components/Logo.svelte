<script lang="ts">
  let { index = "01" } = $props();
</script>

<div class="flex flex-row items-center gap-6 px-8 py-5 w-full">
  <!-- Index marker -->
  <div class="flex flex-row items-center gap-3 shrink-0">
    <span class="text-xs tracking-[0.2em] text-on-surface/30 font-light"
      >// {index}</span
    >
    <div class="w-8 h-px bg-on-surface/20"></div>
  </div>

  <!-- Wordmark -->
  <img src="logo.png" class="w-3/4" />
</div>
