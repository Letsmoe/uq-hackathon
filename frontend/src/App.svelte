<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import ShaderGrid from "./lib/ShaderGrid.svelte";

  import UserHeader from "./lib/components/UserHeader.svelte";
  import NavButtons from "./lib/components/NavButtons.svelte";
  import type { NavId } from "./lib/components/NavButtons.svelte";
  import SongCarousel from "./lib/components/SongCarousel.svelte";
  import SongInfo from "./lib/components/SongInfo.svelte";
  import RecentlyPlayed from "./lib/components/RecentlyPlayed.svelte";
  import type { RecentTrack } from "./lib/components/RecentlyPlayed.svelte";
  import Logo from "./lib/components/Logo.svelte";
  import BottomPanel from "./lib/components/BottomPanel.svelte";
  import MenuPanel from "./lib/components/MenuPanel.svelte";
  import MessagesPanel from "./lib/components/MessagesPanel.svelte";
  import StatsPanel from "./lib/components/StatsPanel.svelte";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";
  import Canvas from "./lib/components/Game/Canvas.svelte";
  import type { Chart } from "./lib/game/chart";
  import { loadDemoSong } from "./lib/demoSong";
  import { messages } from "./lib/messages.svelte";
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
      bestScore: 0,
      charts: {},
    },
  ]);

  // ── State ──────────────────────────────────────────────────────────────────
  let selected = $state(0);
  let page = $state<"Menu" | "Game">("Menu");
  let generating = $state(false);
  let activeTab = $state<NavId>("solo");
  let openPanel = $state<"messages" | "stats" | "settings" | null>(null);
  // Song indexes in play order, most recent first.
  let recentIndexes = $state<number[]>([]);
  let playCount = $state(0);

  const RECENT_LIMIT = 4;
  const PAGE_FADE_MS = 220;

  const selectedSong = $derived(songs[selected]);
  const selectedChart = $derived(selectedSong.charts[selectedSong.difficulty]);
  const unreadCount = $derived(
    messages.filter((message) => !message.read).length,
  );
  const recentTracks: RecentTrack[] = $derived(
    recentIndexes.map((songIndex) => ({
      songIndex,
      title: songs[songIndex].title,
      artist: songs[songIndex].artist,
      cover: songs[songIndex].cover,
    })),
  );

  function startSong() {
    recentIndexes = [
      selected,
      ...recentIndexes.filter((index) => index !== selected),
    ].slice(0, RECENT_LIMIT);
    playCount++;
    page = "Game";
  }

  function pickRandomSong() {
    if (songs.length < 2) {
      return;
    }
    let candidate = selected;
    while (candidate === selected) {
      candidate = Math.floor(Math.random() * songs.length);
    }
    selected = candidate;
  }

  function addUploadedSong(
    chart: Chart,
    buffer: ArrayBuffer,
    file: File,
    coverUrl: string | null,
    difficulty: Difficulty,
  ) {
    songs.push({
      title: file.name.replace(/\.[^.]+$/, ""),
      artist: "Unknown",
      badge: "C",
      cover: coverUrl ?? "/cover/placeholder.png",
      description: "A newly uploaded song.",
      difficulty,
      bestScore: 0,
      charts: { [difficulty]: chart },
      buffer,
    });
    selected = songs.length - 1;
  }

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
  // Menu and game are authored against a fixed design resolution and uniformly
  // scaled onto the frame. Lowering it renders every element larger on device.
  const DESIGN_WIDTH = 1440;
  const DESIGN_HEIGHT = 900;

  let content: HTMLDivElement;
  let frame: HTMLDivElement;

  function resizeGame() {
    if (!frame || !content) return;
    content.style.transform = `scale(${frame.clientWidth / DESIGN_WIDTH})`;
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
    <div
      id="content"
      bind:this={content}
      style="width: {DESIGN_WIDTH}px; height: {DESIGN_HEIGHT}px;"
    >
      {#if page === "Menu"}
        <!-- Menu and game overlap for the length of the crossfade, so both
             sides are taken out of flow. -->
        <div
          class="absolute inset-0"
          transition:fade={{ duration: PAGE_FADE_MS, easing: cubicOut }}
        >
          <!-- Background -->
          <ShaderGrid />
          <img
            src="/ellasy.png"
            class="pointer-events-none absolute -right-20 bottom-0 h-full object-cover opacity-15 [mask-image:linear-gradient(to_left,black,transparent_85%)]"
            alt=""
          />

          <!-- Rows are fixed height so no zone can grow into the one below it;
               only the carousel takes up the slack. -->
          <div class="relative flex h-full w-full flex-col px-10 pt-6 pb-6">
            <div class="flex h-20 shrink-0 flex-row items-center justify-between">
              <Logo />
              <UserHeader
                username="ink"
                rating={12.41}
                ratingCurrent={2430}
                ratingMax={8000}
                fragments={8756}
                memories={315}
                avatarSrc="/ellasy.png"
                {unreadCount}
                onmessages={() => (openPanel = "messages")}
                onstats={() => (openPanel = "stats")}
                onsettings={() => (openPanel = "settings")}
              />
            </div>

            <div class="flex h-[76px] shrink-0 items-center justify-center">
              <NavButtons bind:active={activeTab} onrandom={pickRandomSong} />
            </div>

            <div class="min-h-0 flex-1">
              <SongCarousel {songs} bind:selected />
            </div>

            <!-- Fixed side columns keep the song info on the frame's centre
                 line however wide the rails get. -->
            <div
              class="grid h-[240px] shrink-0 grid-cols-[minmax(0,1fr)_640px_minmax(0,1fr)] items-end gap-6"
            >
              <RecentlyPlayed
                tracks={recentTracks}
                onselect={(songIndex) => (selected = songIndex)}
              />

              <SongInfo
                description={selectedSong.description ?? ""}
                difficulty={selectedSong.difficulty}
                bestScore={selectedSong.bestScore ?? 0}
                badge={selectedSong.badge}
                {generating}
                canStart={Boolean(selectedChart)}
                ondifficultychange={changeDifficulty}
                onstart={startSong}
              />

              <BottomPanel
                notifications={unreadCount}
                version={__APP_VERSION__}
                onquickplay={pickRandomSong}
                onupload={addUploadedSong}
              />
            </div>
          </div>

          {#if openPanel === "messages"}
            <MenuPanel
              title="Messages"
              subtitle="{unreadCount} unread"
              onclose={() => (openPanel = null)}
            >
              <MessagesPanel />
            </MenuPanel>
          {:else if openPanel === "stats"}
            <MenuPanel
              title="Stats"
              subtitle="This session"
              onclose={() => (openPanel = null)}
            >
              <StatsPanel
                libraryCount={songs.length}
                {playCount}
                bestScore={selectedSong.bestScore ?? 0}
                rating={12.41}
                fragments={8756}
                memories={315}
              />
            </MenuPanel>
          {:else if openPanel === "settings"}
            <MenuPanel
              title="Settings"
              subtitle="Audio"
              onclose={() => (openPanel = null)}
            >
              <SettingsPanel />
            </MenuPanel>
          {/if}
        </div>
      {:else if page === "Game"}
        <div
          class="absolute inset-0 bg-canvas"
          transition:fade={{ duration: PAGE_FADE_MS, easing: cubicOut }}
        >
          <Canvas
            chart={selectedChart}
            buffer={selectedSong.buffer}
            songTitle={selectedSong.title}
            artist={selectedSong.artist}
            difficulty={difficultyBadge[selectedSong.difficulty]}
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
    background: #000;
    overflow: hidden;
    position: relative;
  }

  #content {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
    background-color: var(--color-canvas);
  }
</style>
