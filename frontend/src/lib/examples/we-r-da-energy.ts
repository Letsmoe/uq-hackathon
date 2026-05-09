import type { Song } from "../types";
import rawJson from "../../../../charts/Metrik - We Are The Energy.json";
// import rawJson from "../../../../charts/Fox Stevenson - Bruises.json";


// ── JSON schema ────────────────────────────────────────────────────────────────

interface JsonNode {
  tick: number;
  duration: number;
  x: number;
}

interface JsonNote {
  id?: number;
  type: 0 | 1 | 2 | 3;
  // type 0 (tap) and type 2 (hold)
  tick?: number;
  duration?: number;
  x?: number;
  // type 3 (drag / slide)
  nodes?: JsonNode[];
}

interface SongJson {
  bpm: number;
  time_base: number;
  note_list: JsonNote[];
}

// ── Conversion ────────────────────────────────────────────────────────────────

function songFromJson(json: SongJson): Song {
  const { bpm, time_base, note_list } = json;

  let maxTick = 0;

  const notes: Song["notes"] = note_list.flatMap((n) => {
    if (n.type === 0) {
      // Tap
      const beat = n.tick! / time_base;
      maxTick = Math.max(maxTick, n.tick!);
      return [{ beat, x: n.x!, type: "tap" }];
    }

    if (n.type === 1) {
      // Swipe
      const beat = n.tick! / time_base;
      maxTick = Math.max(maxTick, n.tick!);
      return [{ beat, x: n.x!, type: "swipe" }];
    }

    if (n.type === 2) {
      // Hold
      const beat = n.tick! / time_base;
      const holdBeats = n.duration! / time_base;
      maxTick = Math.max(maxTick, n.tick! + n.duration!);
      return [{ beat, x: n.x!, type: "hold", holdBeats }];
    }

    if (n.type === 3 && n.nodes && n.nodes.length > 0) {
      // Drag / slide — anchor on the first node
      const first = n.nodes[0];
      const last = n.nodes[n.nodes.length - 1];
      maxTick = Math.max(maxTick, last.tick);
      return [
        {
          beat: first.tick / time_base,
          x: first.x,
          type: "drag",
          // Carry the full node path so the renderer can draw the slide curve
          nodes: n.nodes.map((node) => ({
            beat: node.tick / time_base,
            x: node.x,
          })),
        } as Song["notes"][number],
      ];
    }

    return [];
  });

  // Sort by beat so consumers can binary-search / iterate in order
  notes.sort((a, b) => a.beat - b.beat);

  const length = Math.ceil(maxTick / time_base);

  return {
    id: "we-are-the-energy",
    title: "We Are The Energy",
    artist: "Metrik",
    difficulty: "hard",
    bpm,
    length,
    notes,
    audioUrl: "/Metrik - We Are The Energy.mp3",
    player: rawJson
  };
}

// ── Export ────────────────────────────────────────────────────────────────────

export const exampleSong: Song = songFromJson(rawJson as SongJson);