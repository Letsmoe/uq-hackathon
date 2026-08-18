<script lang="ts">
  import {
    settings,
    setOffsetMilliseconds,
    setVolume,
  } from "../settings.svelte";

  const volumePercent = $derived(Math.round(settings.volume * 100));

  function handleVolume(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    setVolume(Number(input.value) / 100);
  }

  function handleOffset(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    setOffsetMilliseconds(Number(input.value));
  }
</script>

<div class="flex flex-col gap-8">
  <div class="flex flex-col gap-3">
    <div class="flex flex-row items-baseline justify-between">
      <span class="label-caps">Master volume</span>
      <span class="text-base font-semibold text-fg">{volumePercent}%</span>
    </div>
    <input
      type="range"
      min="0"
      max="100"
      step="1"
      value={volumePercent}
      oninput={handleVolume}
      class="w-full cursor-pointer accent-accent"
    />
    <p class="text-2xs leading-relaxed text-fg-dim">
      Applies to the next track you start.
    </p>
  </div>

  <div class="flex flex-col gap-3">
    <div class="flex flex-row items-baseline justify-between">
      <span class="label-caps">Audio offset</span>
      <span class="text-base font-semibold text-fg">
        {settings.offsetMilliseconds} ms
      </span>
    </div>
    <input
      type="range"
      min="-200"
      max="200"
      step="5"
      value={settings.offsetMilliseconds}
      oninput={handleOffset}
      class="w-full cursor-pointer accent-accent"
    />
    <p class="text-2xs leading-relaxed text-fg-dim">
      Raise it if you consistently hit late. Applied on top of the measured
      hardware latency.
    </p>
  </div>
</div>
