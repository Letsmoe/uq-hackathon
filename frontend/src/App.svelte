<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  import UserHeader from "./lib/components/UserHeader.svelte";
  import NavButtons from "./lib/components/NavButtons.svelte";
  import type { NavId } from "./lib/components/NavButtons.svelte";
  import SongCarousel from "./lib/components/SongCarousel.svelte";
  import SongInfo from "./lib/components/SongInfo.svelte";
  import CarouselDots from "./lib/components/CarouselDots.svelte";
  import RecentlyPlayed from "./lib/components/RecentlyPlayed.svelte";
  import type { RecentTrack } from "./lib/components/RecentlyPlayed.svelte";
  import Logo from "./lib/components/Logo.svelte";
  import UploadButton from "./lib/components/UploadButton.svelte";
  import MenuPanel from "./lib/components/MenuPanel.svelte";
  import MessagesPanel from "./lib/components/MessagesPanel.svelte";
  import StatsPanel from "./lib/components/StatsPanel.svelte";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";
  import Canvas from "./lib/components/Game/Canvas.svelte";
  import type { Chart } from "./lib/game/chart";
  import { loadDemoSong } from "./lib/demoSong";
  import { messages } from "./lib/messages.svelte";
  import { generateChart, DIFFICULTIES } from "./lib/chartGeneration";
  import type { Difficulty } from "./lib/chartGeneration";
  import { levelForDifficulty, statsForChart } from "./lib/trackStats";

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
  // The menu's bands arrive in reading order.
  const NAV_ENTRY_DELAY_MS = 70;
  const CAROUSEL_ENTRY_DELAY_MS = 140;
  const BOTTOM_ENTRY_DELAY_MS = 210;

  const selectedSong = $derived(songs[selected]);
  const selectedChart = $derived(selectedSong.charts[selectedSong.difficulty]);
  const unreadCount = $derived(
    messages.filter((message) => !message.read).length,
  );
  const songTitles = $derived(songs.map((song) => song.title));
  const selectedStats = $derived.by(() => {
    if (!selectedChart) {
      return null;
    }
    return statsForChart(selectedChart);
  });
  const difficultyLevels = $derived(
    Object.fromEntries(
      DIFFICULTIES.map((difficulty) => [
        difficulty,
        levelForDifficulty(difficulty, selectedSong.charts[difficulty]),
      ]),
    ) as Record<Difficulty, number>,
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
    void addDemoSong();
  });
</script>

<div id="viewport">
      {#if page === "Menu"}
        <!-- Menu and game overlap for the length of the crossfade, so both
             sides are taken out of flow. -->
        <div
          class="absolute inset-0"
          transition:fade={{ duration: PAGE_FADE_MS, easing: cubicOut }}
        >
          <!-- Two columns. The left rail runs the full height, so the
               carousel and the song info below it share one centre line
               instead of each centring in a different width. -->
          <div class="relative flex h-full w-full flex-row gap-6 p-6">
            <div
              class="rise-in flex shrink-0 flex-col gap-6"
              style="animation-delay: {NAV_ENTRY_DELAY_MS}ms;"
            >
              <Logo />
              <NavButtons bind:active={activeTab} />

              <div class="mt-auto w-60">
                <RecentlyPlayed
                  tracks={recentTracks}
                  onselect={(songIndex) => (selected = songIndex)}
                />
              </div>
            </div>

            <div class="flex min-h-0 flex-1 flex-col gap-5">
              <div class="rise-in flex shrink-0 flex-row items-center justify-end gap-5">
                <UploadButton onupload={addUploadedSong} />
                <UserHeader
                  username="ink"
                  rating={12.41}
                  ratingCurrent={2430}
                  ratingMax={8000}
                  avatarSrc="/ellasy.png"
                  {unreadCount}
                  onmessages={() => (openPanel = "messages")}
                  onstats={() => (openPanel = "stats")}
                  onsettings={() => (openPanel = "settings")}
                />
              </div>

              <div
                class="rise-in min-h-0 flex-1"
                style="animation-delay: {CAROUSEL_ENTRY_DELAY_MS}ms;"
              >
                <SongCarousel {songs} bind:selected />
              </div>

              <!-- Flexible side rails keep the song info on the column's
                   centre line however wide they get. -->
              <div
                class="rise-in grid shrink-0 grid-cols-[minmax(120px,1fr)_auto_minmax(120px,1fr)] items-end gap-6"
                style="animation-delay: {BOTTOM_ENTRY_DELAY_MS}ms;"
              >
                <div aria-hidden="true"></div>

                <SongInfo
                  description={selectedSong.description ?? ""}
                  difficulty={selectedSong.difficulty}
                  levels={difficultyLevels}
                  stats={selectedStats}
                  bestScore={selectedSong.bestScore ?? 0}
                  badge={selectedSong.badge}
                  {generating}
                  canStart={Boolean(selectedChart)}
                  ondifficultychange={changeDifficulty}
                  onstart={startSong}
                  onshuffle={pickRandomSong}
                >
                  {#snippet indicator()}
                    <CarouselDots titles={songTitles} bind:selected />
                  {/snippet}
                </SongInfo>

                <div aria-hidden="true"></div>
              </div>
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

<style>
  @reference "tailwindcss";
  @reference "./style/global.css";

  /* The menu fills the viewport and lays itself out, rather than being a
     fixed design resolution scaled onto a letterboxed frame. Controls are
     then sized in real pixels instead of inheriting whatever scale factor
     the frame happened to land on. */
  #viewport {
    position: relative;
    width: 100vw;
    height: 100dvh;
    overflow: hidden;
    background-color: var(--color-canvas);
    /* Nothing here scrolls. Releasing touch gestures to the browser only
       costs pointer events to pointercancel. */
    touch-action: none;
    overscroll-behavior: none;
  }
</style>
