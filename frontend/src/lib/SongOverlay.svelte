<script lang="ts">
  import type { Song } from "./types";

  let {
    song,
    phase = $bindable(),
  }: { song: Song | null; phase: "game" | "menu" } = $props();

  function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // placeholder until you have real score data
  const highScore = 987450;
  const rank = "S";
</script>

{#if song}
  <div class="detail">
    <div class="bg" style="background-image: url({song.coverUrl})"></div>

    <div class="content">
      <div class="meta">
        <p class="artist">{song.artist}</p>
        <h1 class="title">{song.title}</h1>
        <p class="sub">{song.album} · {formatDuration(song.duration)}</p>
      </div>

      <div class="score-row">
        <div class="rank">{rank}</div>
        <div class="score-block">
          <p class="score-label">Best score</p>
          <p class="score">{highScore.toLocaleString()}</p>
        </div>
      </div>

      <button
        class="play-btn"
        onclick={() => {
          phase = "game";
        }}
      >
        ▶
      </button>
    </div>
  </div>
{:else}
  <div class="detail empty">
    <p>Select a song</p>
  </div>
{/if}

<style>
  .detail {
    margin-top: calc(15 * var(--h-percent));
    position: relative;
    flex: 1;
    height: calc(63 * var(--h-percent));
    overflow: hidden;
    display: flex;
    align-items: flex-end;
    padding-left: calc(7 * var(--slant));
    background: rgba(0, 0, 0, 0.5);
    clip-path: polygon(
      calc(7 * var(--slant)) 0,
      100% 0,
      calc(100% - 7 * var(--slant)) 100%,
      0 100%
    );
  }

  .bg {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    transition: background-image 0.3s ease;
    filter: blur(4px) brightness(0.7);
    z-index: 1;
  }

  .content {
    position: relative;
    z-index: 2;
    width: 100%;
    padding: 4%;
    display: flex;
    flex-direction: column;
    gap: calc(2 * var(--h-percent));
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: calc(0.5 * var(--h-percent));
  }

  .title {
    font-size: calc(4 * var(--w-percent));
    font-weight: 700;
    color: white;
    line-height: 1.1;
  }

  .artist {
    font-size: calc(1.5 * var(--w-percent));
    color: rgba(255, 255, 255, 0.6);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .sub {
    font-size: calc(1.2 * var(--w-percent));
    color: rgba(255, 255, 255, 0.4);
  }

  .score-row {
    display: flex;
    align-items: center;
    gap: calc(2 * var(--w-percent));
  }

  .rank {
    font-size: calc(6 * var(--w-percent));
    font-weight: 900;
    color: white;
    line-height: 1;
    text-shadow: 0 0 30px rgba(255, 255, 255, 0.3);
  }

  .score-label {
    font-size: calc(1 * var(--w-percent));
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .score {
    font-size: calc(2.5 * var(--w-percent));
    font-weight: 700;
    color: white;
  }

  .play-btn {
    align-self: flex-end;
    width: calc(8 * var(--w-percent));
    height: calc(8 * var(--w-percent));
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.15);
    color: white;
    font-size: calc(3 * var(--w-percent));
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background 0.15s,
      transform 0.15s;
    backdrop-filter: blur(10px);

    &:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.05);
    }

    &:active {
      transform: scale(0.96);
    }
  }

  .empty {
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.3);
    font-size: calc(1.5 * var(--w-percent));
  }
</style>
