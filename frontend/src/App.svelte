<script lang="ts">
  import { onMount } from "svelte";
  import ShaderGrid from "./lib/ShaderGrid.svelte";

  import UserHeader from "./lib/components/UserHeader.svelte";
  import NavButtons from "./lib/components/NavButtons.svelte";
  import SongCarousel from "./lib/components/SongCarousel.svelte";
  import SongInfo from "./lib/components/SongInfo.svelte";
  import RecentlyPlayed from "./lib/components/RecentlyPlayed.svelte";
  import Logo from "./lib/components/Logo.svelte";
  import BottomPanel from "./lib/components/BottomPanel.svelte";
  import Canvas from "./lib/components/Game/Canvas.svelte";

  // ── Types ──────────────────────────────────────────────────────────────────
  type Song = {
    title: string;
    artist: string;
    badge: string;
    cover: string;
    description?: string;
    difficulty?: "easy" | "normal" | "hard" | "expert";
    level?: number;
    bestScore?: number;
  };

  // ── Data ───────────────────────────────────────────────────────────────────
  const songs: Song[] = $state([
    {
      title: "Unnamed",
      artist: "Upload",
      badge: "A",
      cover: "/cover/placeholder.png",
      description: "Upload an mp3 file to get started!",
      difficulty: "normal",
      level: 0,
      bestScore: 0,
    },
  ]);

  // ── State ──────────────────────────────────────────────────────────────────
  let selected = $state(0);
  let level = $state(songs[selected].level ?? 8);
  let page = $state<"Menu" | "Game">("Menu");

  // Keep level in sync when selected changes
  $effect(() => {
    level = songs[selected].level ?? 8;
  });

  // ── Scaling ────────────────────────────────────────────────────────────────
  let content: HTMLDivElement;
  let frame: HTMLDivElement;

  function resizeGame() {
    if (!frame || !content) return;
    content.style.transform = `scale(${frame.clientWidth / 1920})`;
  }

  onMount(resizeGame);

  let score: number = $state(0);
  let combo: number = $state(0);
  let tp: number = $state(0);
</script>

<svelte:window onresize={resizeGame} onorientationchange={resizeGame} />

<div id="viewport">
  <div id="content-frame" bind:this={frame}>
    <div id="content" bind:this={content}>
      {#if page === "Menu"}
        <!-- Background -->
        <ShaderGrid />
        <img
          src="/ellasy.png"
          class="absolute -right-24 -bottom-24 h-full object-cover opacity-20 pointer-events-none"
          alt=""
        />

        <!-- Root layout: 3 columns, 2 rows -->
        <div
          class="relative w-full h-full grid grid-cols-[1fr_2fr_1fr] grid-rows-[auto_1fr] p-8 gap-0"
        >
          <!-- ── Row 1: Logo + Header ──────────────────────────────────────── -->
          <Logo></Logo>
          <div class="col-span-2">
            <!-- <UserHeader -->
            <!--   username="ink" -->
            <!--   rating={12.41} -->
            <!--   ratingCurrent={2430} -->
            <!--   ratingMax={8000} -->
            <!--   fragments={8756} -->
            <!--   memories={315} -->
            <!--   avatarSrc="/ellasy.png" -->
            <!-- /> -->
          </div>

          <!-- ── Row 2: Main area ──────────────────────────────────────────── -->
          <div class="col-span-3 grid grid-rows-[auto_1fr_auto] min-h-0">
            <!-- Nav buttons -->
            <div class="flex items-center justify-center py-2">
              <NavButtons />
            </div>

            <!-- Song carousel — grows to fill space -->
            <div class="min-h-0">
              <SongCarousel {songs} bind:selected />
            </div>

            <!-- Bottom strip: recently played | song info + start -->
            <div class="grid grid-cols-[1fr_2fr_1fr] items-end pb-4">
              <!-- Recently played -->
              <div class="flex items-end">
                <!-- <RecentlyPlayed /> -->
              </div>

              <!-- Song info + start button -->
              <div class="flex flex-col items-center gap-4">
                <SongInfo
                  title={songs[selected].title}
                  artist={songs[selected].artist}
                  description={songs[selected].description ?? ""}
                  difficulty={songs[selected].difficulty ?? "normal"}
                  bind:level
                  bestScore={songs[selected].bestScore ?? 0}
                  badge={songs[selected].badge}
                  onstart={() => (page = "Game")}
                />
              </div>

              <!-- Right spacer (could hold future content) -->
              <BottomPanel
                notifications={2}
                version="1.2.0"
                onquickplay={() => {
                  selected = Math.floor(Math.random() * songs.length);
                }}
                onupload={(chart, buffer, file: File) => {
                  /* open upload modal */
                  songs.push({
                    title: file.name,
                    artist: "UNKNOWN",
                    badge: "C",
                    cover: "/cover/placeholder.png",
                    description: "A newly uploaded song.",
                    difficulty: "normal",
                    level: 7,
                    bestScore: 0,
                    chart,
                    buffer,
                  });
                }}
              />
            </div>
          </div>
        </div>
      {:else if page === "Game"}
        <!-- Placeholder — replace with your game component -->
        <div class="relative w-full h-full bg-[#e8e8ec]">
          <!-- HUD overlay -->
          <Canvas
            chart={songs[selected].chart}
            buffer={songs[selected].buffer}
            songTitle={songs[selected].title}
            artist={songs[selected].artist}
            difficulty={songs[selected].badge}
            level={songs[selected].level ?? 8}
            coverSrc={songs[selected].cover}
            onpause={() => (page = "Menu")}
            onfinish={(stats) => console.log("Final stats:", stats)}
          ></Canvas>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  @reference "tailwindcss";
  @reference "./style/global.css";

  #viewport {
    width: 100vw;
    height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  #content-frame {
    width: 100vw;
    max-width: calc(100dvh * 16 / 10);
    aspect-ratio: 16 / 10;
    background: #111;
    overflow: hidden;
    position: relative;
  }

  #content {
    width: 1920px;
    height: 1200px;
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
    background-color: #fff;
  }

  .install-btn {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 9999;
    padding: 0.6rem 1.2rem;
    background: rgba(16, 17, 28, 0.92);
    border: 1px solid rgba(62, 155, 255, 0.4);
    color: #e8e8ee;
    font-family: "Rajdhani", system-ui, sans-serif;
    font-size: 0.85rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    border-radius: 4px;
    cursor: pointer;
    backdrop-filter: blur(8px);
    transition:
      border-color 150ms,
      background 150ms;
  }
  .install-btn:hover {
    background: rgba(62, 155, 255, 0.12);
    border-color: rgba(62, 155, 255, 0.7);
  }
</style>
