# Synapse: Rhythm Protocol

A scanline rhythm game in the style of Cytus. You supply the music; the game
generates the level.

Notes do not fall. They sit at a fixed position on a 2D plane while a
horizontal scanline sweeps down and up the screen, and you tap each note as the
line crosses it. A note's vertical position is not stored in the chart — the
scanline position *is* the time axis.

The game ships with no music. Everything playable comes from a file the player
uploads.

## How it works

```
audio file
  → WebAudio decodeAudioData        (main thread, → mono Float32)
  → analyzeAudio                    (worker, once per track)
      → log-frequency spectrogram
      → SuperFlux onsets, split into low / mid / high registers
      → tempo + beat grid (comb-filtered tempogram, DP beat tracking)
      → onsets quantized onto the grid
      → sections and their repeats (self-similarity)
  → buildChart                      (worker, once per difficulty)
      → ranked onset selection per section
      → note kinds: taps, chords, holds, drags
      → x from register and pitch, under a hand-travel budget
  → Chart JSON
  → PixiJS renderer + judgment      (frontend/src/lib/game/)
```

Chart generation runs entirely client-side. There is no server.

## Layout

| Path | Purpose |
| --- | --- |
| `frontend/src/lib/chart/dsp/` | Spectrogram, onset detection, tempo tracking, section detection. |
| `frontend/src/lib/chart/generator/` | Quantization, difficulty, note selection, layout, chart assembly. |
| `frontend/src/lib/game/` | Engine, scanline, renderer, judgment, input, audio clock. |
| `patterns.json` | Charting vocabulary. Reference for pattern design, not read at runtime. |
| `frontend/src/lib/components/` | Menu and in-game UI. |
| `frontend/android/` | Capacitor native Android shell. |
| `playground/` | Native audio-analysis experiments (aubio). Reference only. |
| `audios/` | Local test audio. Untracked — nothing here ships. |

## Setup

### Frontend

Requires [Bun](https://bun.sh/).

```sh
cd frontend
bun install
bun run dev --host      # open the printed Network URL on a tablet or phone
```

Useful checks:

```sh
bun run check           # svelte-check + tsc
bun run build           # production build into frontend/dist
```

### Generator tests

The generator is plain TypeScript, so its rules are checked without a browser.
From the repo root:

```sh
bun test
```

The tests synthesize drum tracks with known hit times and assert that the
recovered tempo, the onset placement and each difficulty's own limits hold.

### Android (Capacitor)

Requires the Android SDK and **JDK 21** — newer JDKs fail with
`Unsupported class file major version`, because Gradle 8.14 does not support
them.

```sh
cd frontend
bun run android:apk     # build + sync + assembleDebug
bun run android:run     # build + sync + install on a connected device
bun run android:bundle  # same, but self-contained (no dev server)
bun run android:open    # open in Android Studio
```

The APK lands in `frontend/android/app/build/outputs/apk/debug/`.

The shell loads `http://<your-lan-ip>:5173` by default, so the installed app
picks up edits from a running dev server without a reinstall — start the server
alongside it:

```sh
bun run dev
```

Two environment variables override the default:

- `CAP_SERVER_URL=http://host:port` — pin a specific host instead of the
  auto-detected LAN address.
- `CAP_BUNDLE=1` — serve the bundled `dist/` build. **Required for anything you
  intend to ship**: the default enables cleartext HTTP and depends on a dev
  server that is not on the user's network.

## Chart format

Times are in ticks. `time_base` ticks make one beat:

```
seconds = 60 * tick / (bpm * time_base)
```

`x` is normalised across the playfield, `0` to `1`. `scan_line_direction` is
`-1` for a top-to-bottom sweep and `1` for bottom-to-top.

```json
{
  "bpm": 174.0,
  "time_base": 480,
  "start_offset_time": 0,
  "length": 212.5,
  "page_list": [
    { "start_tick": 0,    "end_tick": 1920, "scan_line_direction": -1 },
    { "start_tick": 1920, "end_tick": 3840, "scan_line_direction": 1 }
  ],
  "note_list": [
    { "type": 0, "id": 0, "tick": 480, "x": 0.42, "duration": 0 },
    { "type": 2, "id": 1, "tick": 960, "x": 0.42, "duration": 240 },
    {
      "type": 3,
      "id": 2,
      "nodes": [
        { "tick": 2400, "x": 0.42, "duration": 0 },
        { "tick": 2520, "x": 0.69, "duration": 0 }
      ]
    }
  ]
}
```

Note types: `0` tap, `1` flick, `2` hold, `3` chain (nested nodes).

This is *not* the Cytoid chart format. Cytoid numbers its types differently,
flattens chains into head/child notes linked by `next_id`, and carries a
`tempo_list` instead of a single `bpm`. Charts are not interchangeable.

## Known gaps

**Generator** — note *kinds* are chosen from a single onset's own properties.
A real charter also uses rhythmic context: the same sound should keep the same
shape across a section, and a pattern should resolve rather than stop. Sibling
note pairs are also not flagged for the renderer.

**Renderer** — sibling notes (two notes on the same tick) should be joined by a
connector line, as in Cytus. The generator computes the pairs but does not flag
them and the renderer does not draw them.

**Note approach** — `APPROACH_S` is a fixed 2-second window, which is
falling-note-game logic. In Cytus the approach animation is tied to scanline
distance, so a fixed window reads wrong when page speed varies.

**Scoring** — currently unbounded (1000/700/300/0). Cytus normalises to
1,000,000 and has a Great tier between Perfect and Good.

**Input** — single-touch only. `InputHandler` tracks `touches[0]`, so chords
and simultaneous holds cannot be played.

**Assets** — `frontend/public` carries ~12MB of unoptimised PNGs, and
`favicon.svg` is a 0.7MB base64-wrapped raster. Both should be compressed.

## References

- [Cytoid charting patterns](https://sites.google.com/site/cytoidcommunity/charting/extra-information-on-charting/patterns)
- [Cytus combo and scoring](https://cytus.fandom.com/wiki/Combo)
- [Phira](https://github.com/TeamFlos/phira) — open-source scanline rhythm game
