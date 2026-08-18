/** Synthetic drum tracks with known hit times, used to check the generator. */

export const SAMPLE_RATE = 44100;

export interface SynthOptions {
  bpm: number;
  /** Silent lead-in before the first beat, in seconds. */
  offsetSec: number;
  bars: BarLayer[][];
}

/** Which drums play during one bar of four beats. */
export type BarLayer = "kick" | "snare" | "hats";

export interface SynthTrack {
  mono: Float32Array;
  hitTimes: number[];
  durationSec: number;
  bpm: number;
  offsetSec: number;
}

export function synthesizeTrack(options: SynthOptions): SynthTrack {
  const beatSec = 60 / options.bpm;
  const durationSec = options.offsetSec + options.bars.length * 4 * beatSec + 2;
  const mono = new Float32Array(Math.round(durationSec * SAMPLE_RATE));
  const hitTimes: number[] = [];

  options.bars.forEach((layers, barIndex) => {
    const barStartSec = options.offsetSec + barIndex * 4 * beatSec;

    renderBar(mono, hitTimes, layers, barStartSec, beatSec);
  });

  return { mono, hitTimes, durationSec, bpm: options.bpm, offsetSec: options.offsetSec };
}

function renderBar(
  mono: Float32Array,
  hitTimes: number[],
  layers: BarLayer[],
  barStartSec: number,
  beatSec: number,
): void {
  for (const layer of layers) {
    renderLayer(mono, hitTimes, layer, barStartSec, beatSec);
  }
}

function renderLayer(
  mono: Float32Array,
  hitTimes: number[],
  layer: BarLayer,
  barStartSec: number,
  beatSec: number,
): void {
  for (const beatOffset of beatOffsetsFor(layer)) {
    const timeSec = barStartSec + beatOffset * beatSec;

    renderHit(mono, layer, timeSec);
    hitTimes.push(timeSec);
  }
}

function beatOffsetsFor(layer: BarLayer): number[] {
  if (layer === "kick") return [0, 1, 2, 3];
  if (layer === "snare") return [1, 3];

  return [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
}

function renderHit(mono: Float32Array, layer: BarLayer, timeSec: number): void {
  const voice = VOICE_SHAPES[layer];
  const start = Math.round(timeSec * SAMPLE_RATE);
  const length = Math.round(voice.decaySec * 4 * SAMPLE_RATE);

  for (let offset = 0; offset < length; offset++) {
    const index = start + offset;

    if (index >= mono.length) break;

    mono[index] += sampleAt(voice, offset / SAMPLE_RATE, offset);
  }
}

interface VoiceShape {
  carrierHz: number;
  decaySec: number;
  amplitude: number;
  noisy: boolean;
}

const VOICE_SHAPES: Record<BarLayer, VoiceShape> = {
  kick: { carrierHz: 55, decaySec: 0.12, amplitude: 1, noisy: false },
  snare: { carrierHz: 900, decaySec: 0.08, amplitude: 0.6, noisy: true },
  hats: { carrierHz: 6000, decaySec: 0.02, amplitude: 0.25, noisy: true },
};

function sampleAt(voice: VoiceShape, elapsedSec: number, offset: number): number {
  const envelope = Math.exp(-elapsedSec / voice.decaySec) * voice.amplitude;
  const carrier = Math.sin(2 * Math.PI * voice.carrierHz * elapsedSec);

  if (!voice.noisy) {
    return envelope * carrier;
  }

  return envelope * carrier * pseudoNoise(offset);
}

/** Deterministic noise so a failing test reproduces exactly. */
function pseudoNoise(index: number): number {
  const value = Math.sin(index * 12.9898) * 43758.5453;

  return (value - Math.floor(value)) * 2 - 1;
}
