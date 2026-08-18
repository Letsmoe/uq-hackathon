import { AudioPlayer } from "./game/AudioPlayer";

/**
 * Player settings surfaced by the menu. The engine reads these off
 * AudioPlayer's persisted statics, so this only mirrors them for the UI and
 * writes every change straight back.
 */
export const settings = $state({
  volume: AudioPlayer.volume,
  offsetMilliseconds: Math.round(AudioPlayer.calibrationSeconds * 1000),
});

export function setVolume(level: number) {
  settings.volume = level;
  AudioPlayer.volume = level;
}

export function setOffsetMilliseconds(milliseconds: number) {
  settings.offsetMilliseconds = milliseconds;
  AudioPlayer.calibrationSeconds = milliseconds / 1000;
}
