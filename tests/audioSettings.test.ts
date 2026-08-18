import { test, expect, describe, beforeEach } from "bun:test";

// AudioPlayer's settings accessors are plain localStorage reads, but the module
// is imported by code that expects a browser, so the store is stubbed here.
const store = new Map<string, string>();

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { AudioPlayer } = await import("../frontend/src/lib/game/AudioPlayer");

describe("AudioPlayer.volume", () => {
  beforeEach(() => {
    store.clear();
  });

  test("defaults to full volume when nothing is stored", () => {
    expect(AudioPlayer.volume).toBe(1);
  });

  test("round-trips a stored level", () => {
    AudioPlayer.volume = 0.35;
    expect(AudioPlayer.volume).toBeCloseTo(0.35);
  });

  test("falls back to full volume on a corrupt value", () => {
    store.set("synapse.volume", "not-a-number");
    expect(AudioPlayer.volume).toBe(1);
  });
});
