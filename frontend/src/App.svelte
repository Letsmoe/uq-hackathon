<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowLeft, EnterFullScreen, ExitFullScreen } from "svelte-radix";
  import SongEntryScroller from "./lib/SongEntryScroller.svelte";
  import SongOverlay from "./lib/SongOverlay.svelte";
  import type { Song } from "./lib/types";
  import RhythmCanvas from "./lib/RhythmCanvas.svelte";
  import { exampleSong } from "./lib/examples/we-r-da-energy";
  let screen: HTMLElement = $state(undefined!);
  let width = $state(0);
  let height = $state(0);
  let slant = $derived(Math.round(width * 0.01));

  $effect(() => {
    document.documentElement.style.setProperty("--slant", `${slant}px`);
    document.documentElement.style.setProperty(
      "--h-percent",
      `${height / 100}px`,
    );
    document.documentElement.style.setProperty(
      "--w-percent",
      `${width / 100}px`,
    );
    document.documentElement.style.setProperty(
      "--heading-font-size",
      `${width * 0.015}px`,
    );
    document.documentElement.style.setProperty(
      "--subheading-font-size",
      `${width * 0.01}px`,
    );

    document.documentElement.style.setProperty(
      "--text-font-size",
      `${width * 0.011}px`,
    );
  });

  onMount(() => {
    width = screen.clientWidth;
    height = screen.clientHeight;
    document.documentElement.requestFullscreen();
  });

  let selectedSong: Song = $state(null);
  let phase: "menu" | "game" = $state("menu");

  let fullscreen = $state()
</script>

<svelte:window
  onresize={() => {
    width = screen.clientWidth;
    height = screen.clientHeight;
  }}

  onfullscreenchange={() => {
		fullscreen = !!document.fullscreenElement;
	}}
/>

{#if phase === "menu"}
  <main
    bind:this={screen}
    class="w-full max-w-screen max-h-screen aspect-video flex flex-row relative container"
  >
    <div class="background"></div>
    <button class="back-btn" onclick={() => {
    				if (document.fullscreenElement) {
				document.exitFullscreen();
			} else {
				document.documentElement.requestFullscreen();
			}
    }}>
      {#if fullscreen}
      	<ExitFullScreen size={width / 50}></ExitFullScreen>
      {:else}
      	<EnterFullScreen size={width / 50}></EnterFullScreen>
      {/if}
    </button>
    <SongEntryScroller
      songs={[exampleSong]}
      {slant}
      bind:selectedSong
    ></SongEntryScroller>

    <SongOverlay song={selectedSong} {slant} bind:phase></SongOverlay>
  </main>
{:else if phase === "game"}
  <RhythmCanvas song={selectedSong} exit={() => (phase = "menu")}
  ></RhythmCanvas>
{/if}

<style is:global>
  .container {
    padding-top: calc(5 * var(--h-percent));
    padding-bottom: calc(5 * var(--h-percent));
  }
  :global(.heading) {
    font-size: var(--heading-font-size);
  }

 :global( .subheading) {
    font-size: var(--subheading-font-size);
  }

 :global( .text) {
    font-size: var(--text-font-size);
  }

  .background {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
    background-image: url("/cover-image.png");
    background-attachment: fixed;
    background-blend-mode: overlay;
    filter: blur(256px) brightness(0.7);
  }

  .back-btn {
    height: calc(10 * var(--h-percent));
    width: calc(10 * var(--w-percent));
    display: flex;
    align-items: center;
    justify-content: center;
    padding-right: 1%;
    gap: 8px;
    color: white;
    background: rgba(255, 255, 255, 1);
    clip-path: polygon(0 0, 100% 0, calc(100% - var(--slant)) 100%, 0 100%);
    cursor: pointer;
  }
  .back-btn::before {
    content: "";
    position: absolute;
    inset: 0 5% 0 0;
    background: rgba(0, 0, 0, 1);
    clip-path: polygon(0 0, 100% 0, calc(100% - var(--slant)) 100%, 0 100%);
    z-index: -1;
  }
</style>
