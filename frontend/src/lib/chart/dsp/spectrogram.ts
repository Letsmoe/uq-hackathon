import { FastFourierTransform } from "./fft";

const FFT_SIZE = 1024;
const TARGET_FRAME_RATE = 100;
const MAX_ANALYSIS_RATE = 24000;

// Log-spaced filterbank matching the SuperFlux onset detector: filters centred
// on musical pitches so that vibrato and slight detuning do not read as onsets.
const FILTERS_PER_OCTAVE = 24;
const LOWEST_BAND_HZ = 27.5;
const HIGHEST_BAND_HZ = 11000;

/**
 * Log-magnitude spectrogram on a log-frequency band scale. Rows are frames,
 * columns are bands, stored flat because a four minute track produces tens of
 * thousands of frames.
 */
export interface Spectrogram {
  data: Float32Array;
  frameCount: number;
  bandCount: number;
  bandCenterHz: Float32Array;
  frameRate: number;
}

export function bandValue(spectrogram: Spectrogram, frame: number, band: number): number {
  return spectrogram.data[frame * spectrogram.bandCount + band];
}

export function computeSpectrogram(mono: Float32Array, sampleRate: number): Spectrogram {
  const reduced = reduceSampleRate(mono, sampleRate);
  const hopSize = Math.max(1, Math.round(reduced.sampleRate / TARGET_FRAME_RATE));
  const filterBank = buildFilterBank(reduced.sampleRate);
  const frameCount = countFrames(reduced.samples.length, hopSize);

  const spectrogram: Spectrogram = {
    data: new Float32Array(frameCount * filterBank.bandCount),
    frameCount,
    bandCount: filterBank.bandCount,
    bandCenterHz: filterBank.centerHz,
    frameRate: reduced.sampleRate / hopSize,
  };

  fillSpectrogram(spectrogram, reduced.samples, hopSize, filterBank);

  return spectrogram;
}

function countFrames(sampleCount: number, hopSize: number): number {
  if (sampleCount < FFT_SIZE) {
    return 0;
  }

  return Math.floor((sampleCount - FFT_SIZE) / hopSize) + 1;
}

function fillSpectrogram(
  spectrogram: Spectrogram,
  samples: Float32Array,
  hopSize: number,
  filterBank: FilterBank,
): void {
  const transform = new FastFourierTransform(FFT_SIZE);
  const window = buildHannWindow(FFT_SIZE);
  const real = new Float32Array(FFT_SIZE);
  const imaginary = new Float32Array(FFT_SIZE);
  const magnitude = new Float32Array(FFT_SIZE / 2 + 1);

  for (let frame = 0; frame < spectrogram.frameCount; frame++) {
    applyWindow(samples, frame * hopSize, window, real);
    imaginary.fill(0);
    transform.forward(real, imaginary);
    transform.magnitudes(real, imaginary, magnitude);
    applyFilterBank(magnitude, filterBank, spectrogram.data, frame * spectrogram.bandCount);
  }
}

function applyWindow(
  samples: Float32Array,
  start: number,
  window: Float32Array,
  into: Float32Array,
): void {
  for (let index = 0; index < window.length; index++) {
    into[index] = samples[start + index] * window[index];
  }
}

function buildHannWindow(size: number): Float32Array {
  const window = new Float32Array(size);

  for (let index = 0; index < size; index++) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }

  return window;
}

// ── Downsampling ────────────────────────────────────────────────────────────

interface ReducedAudio {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Onsets carry no information above ~11 kHz, so the signal is halved until it
 * is cheap enough to transform. Each halving is preceded by a three tap low
 * pass, without which cymbals alias down into the drum bands.
 */
function reduceSampleRate(mono: Float32Array, sampleRate: number): ReducedAudio {
  let samples = mono;
  let rate = sampleRate;

  while (rate > MAX_ANALYSIS_RATE) {
    samples = halveSampleRate(samples);
    rate /= 2;
  }

  return { samples, sampleRate: rate };
}

function halveSampleRate(samples: Float32Array): Float32Array {
  const halved = new Float32Array(Math.floor(samples.length / 2));

  for (let index = 0; index < halved.length; index++) {
    const center = index * 2;
    const previous = samples[Math.max(0, center - 1)];
    const next = samples[Math.min(samples.length - 1, center + 1)];

    halved[index] = previous * 0.25 + samples[center] * 0.5 + next * 0.25;
  }

  return halved;
}

// ── Filter bank ─────────────────────────────────────────────────────────────

interface FilterBank {
  bandCount: number;
  centerHz: Float32Array;
  startBin: Int32Array;
  weights: Float32Array[];
}

function buildFilterBank(sampleRate: number): FilterBank {
  const nyquist = sampleRate / 2;
  const topHz = Math.min(HIGHEST_BAND_HZ, nyquist * 0.95);
  const edges = buildLogSpacedEdges(LOWEST_BAND_HZ, topHz);
  const bandCount = Math.max(0, edges.length - 2);
  const binWidthHz = nyquist / (FFT_SIZE / 2);

  const bank: FilterBank = {
    bandCount,
    centerHz: new Float32Array(bandCount),
    startBin: new Int32Array(bandCount),
    weights: [],
  };

  for (let band = 0; band < bandCount; band++) {
    bank.centerHz[band] = edges[band + 1];
    addTriangularFilter(bank, band, edges, binWidthHz);
  }

  return bank;
}

function buildLogSpacedEdges(lowestHz: number, highestHz: number): number[] {
  const stepRatio = Math.pow(2, 1 / FILTERS_PER_OCTAVE);
  const edges: number[] = [];

  for (let hz = lowestHz; hz <= highestHz; hz *= stepRatio) {
    edges.push(hz);
  }

  return edges;
}

function addTriangularFilter(
  bank: FilterBank,
  band: number,
  edges: number[],
  binWidthHz: number,
): void {
  const lowBin = Math.floor(edges[band] / binWidthHz);
  const highBin = Math.ceil(edges[band + 2] / binWidthHz);
  const centerHz = edges[band + 1];
  const weights = new Float32Array(Math.max(1, highBin - lowBin + 1));

  for (let offset = 0; offset < weights.length; offset++) {
    const binHz = (lowBin + offset) * binWidthHz;

    weights[offset] = triangleWeight(binHz, edges[band], centerHz, edges[band + 2]);
  }

  bank.startBin[band] = lowBin;
  bank.weights.push(normalizeToUnitSum(weights));
}

function triangleWeight(hz: number, lowHz: number, centerHz: number, highHz: number): number {
  if (hz <= lowHz || hz >= highHz) {
    return 0;
  }

  if (hz <= centerHz) {
    return (hz - lowHz) / (centerHz - lowHz);
  }

  return (highHz - hz) / (highHz - centerHz);
}

function normalizeToUnitSum(weights: Float32Array): Float32Array {
  let total = 0;

  for (const weight of weights) {
    total += weight;
  }

  if (total <= 0) {
    return weights;
  }

  for (let index = 0; index < weights.length; index++) {
    weights[index] /= total;
  }

  return weights;
}

function applyFilterBank(
  magnitude: Float32Array,
  bank: FilterBank,
  into: Float32Array,
  rowStart: number,
): void {
  for (let band = 0; band < bank.bandCount; band++) {
    const energy = filterEnergy(magnitude, bank.startBin[band], bank.weights[band]);

    into[rowStart + band] = Math.log10(1 + energy * 100);
  }
}

function filterEnergy(magnitude: Float32Array, startBin: number, weights: Float32Array): number {
  let energy = 0;

  for (let offset = 0; offset < weights.length; offset++) {
    const bin = startBin + offset;

    if (bin < 0 || bin >= magnitude.length) continue;

    energy += magnitude[bin] * weights[offset];
  }

  return energy;
}
