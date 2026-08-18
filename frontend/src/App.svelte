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
  import type { Chart } from "./lib/game/chart";
  import { loadDemoSong } from "./lib/demoSong";
  import { generateChart } from "./lib/chartGeneration";
  import type { Difficulty } from "./lib/chartGeneration";

  // ── Types ──────────────────────────────────────────────────────────────────
  type Song = {
    title: string;
    artist: string;
    badge: string;
    cover: string;
    description?: string;
    difficulty: Difficulty;
    level?: number;
    bestScore?: number;
    // Charts are generated per difficulty on demand and kept so that switching
    // back to one already played does not pay for a second decode.
    charts: Partial<Record<Difficulty, Chart>>;
    // Present only on user-uploaded songs, which is every playable song.
    buffer?: ArrayBuffer;
  };

  // The in-game HUD badge only has room for a couple of characters.
  const difficultyBadge: Record<Difficulty, string> = {
    easy: "EZ",
    normal: "NM",
    hard: "HD",
    expert: "EX",
    chaos: "CH",
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
      charts: {},
    },
  ]);

  // ── State ──────────────────────────────────────────────────────────────────
  let selected = $state(0);
  let level = $state(songs[selected].level ?? 8);
  let page = $state<"Menu" | "Game">("Menu");
  let generating = $state(false);

  const selectedSong = $derived(songs[selected]);
  const selectedChart = $derived(selectedSong.charts[selectedSong.difficulty]);

  // Keep level in sync when selected changes
  $effect(() => {
    level = songs[selected].level ?? 8;
  });

  // ── Difficulty ─────────────────────────────────────────────────────────────
  async function changeDifficulty(difficulty: Difficulty) {
    const song = songs[selected];
    song.difficulty = difficulty;

    if (song.charts[difficulty] || !song.buffer) {
      return;
    }

    await buildChart(song, song.buffer, difficulty);
  }

  async function buildChart(
    song: Song,
    buffer: ArrayBuffer,
    difficulty: Difficulty,
  ) {
    generating = true;
    try {
      song.charts[difficulty] = await generateChart(buffer, difficulty);
    } catch (error) {
      console.error("Chart generation failed", error);
    } finally {
      generating = false;
    }
  }

  // ── Scaling ────────────────────────────────────────────────────────────────
  let content: HTMLDivElement;
  let frame: HTMLDivElement;

  function resizeGame() {
    if (!frame || !content) return;
    content.style.transform = `scale(${frame.clientWidth / 1920})`;
  }

  // Generating the chart for the demo track goes through the same decode →
  // wasm → chart path as an upload, so this exercises the real pipeline.
  async function addDemoSong() {
    try {
      const demo = await loadDemoSong();
      if (!demo) {
        return;
      }
      songs.push({
        title: "We Are The Energy",
        artist: "Metrik",
        badge: "A",
        cover: "/cover/cover-1.png",
        description: "Bundled demo track.",
        difficulty: "normal",
        level: 9,
        bestScore: 0,
        charts: { normal: demo.chart },
        buffer: demo.buffer,
      });
      selected = songs.length - 1;
    } catch (error) {
      console.error("Demo song failed to load", error);
    }
  }

  onMount(() => {
    resizeGame();
    void addDemoSong();
  });
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
            <UserHeader
              username="ink"
              rating={12.41}
              ratingCurrent={2430}
              ratingMax={8000}
              fragments={8756}
              memories={315}
              avatarSrc="/ellasy.png"
            />
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
                <RecentlyPlayed />
              </div>

              <!-- Song info + start button -->
              <div class="flex flex-col items-center gap-4">
                <SongInfo
                  title={selectedSong.title}
                  artist={selectedSong.artist}
                  description={selectedSong.description ?? ""}
                  difficulty={selectedSong.difficulty}
                  bind:level
                  bestScore={selectedSong.bestScore ?? 0}
                  badge={selectedSong.badge}
                  {generating}
                  canStart={Boolean(selectedChart)}
                  ondifficultychange={changeDifficulty}
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
                onupload={(
                  chart,
                  buffer,
                  file: File,
                  coverUrl: string | null,
                  difficulty: Difficulty,
                ) => {
                  songs.push({
                    title: file.name.replace(/\.[^.]+$/, ""),
                    artist: "UNKNOWN",
                    badge: "C",
                    cover: coverUrl ?? "/cover/placeholder.png",
                    description: "A newly uploaded song.",
                    difficulty,
                    level: 7,
                    bestScore: 0,
                    charts: { [difficulty]: chart },
                    buffer,
                  });
                  selected = songs.length - 1;
                }}
              />
            </div>
          </div>
        </div>
      {:else if page === "Game"}
        <!-- Placeholder — replace with your game component -->
        <div class="relative w-full h-full bg-[#eceae4]">
          <!-- HUD overlay -->
          <Canvas
            chart={selectedChart}
            buffer={selectedSong.buffer}
            songTitle={selectedSong.title}
            artist={selectedSong.artist}
            difficulty={difficultyBadge[selectedSong.difficulty]}
            level={selectedSong.level ?? 8}
            coverSrc={selectedSong.cover}
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
    /* The frame is fixed-size with nothing to scroll. Releasing touch
       gestures to the browser only costs pointer events to pointercancel. */
    touch-action: none;
    overscroll-behavior: none;
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

</style>

