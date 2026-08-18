import { bandValue, type Spectrogram } from "./spectrogram";

/**
 * The three percussive registers a chart maps separately. A single broadband
 * envelope cannot tell a kick from a hi-hat, and without that distinction the
 * generator has no basis for choosing note types or lanes.
 */
export const VOICES = ["low", "mid", "high"] as const;
export type Voice = (typeof VOICES)[number];

const VOICE_UPPER_HZ: Record<Voice, number> = {
  low: 200,
  mid: 2000,
  high: Infinity,
};

// SuperFlux parameters: the spectral difference is taken against a frame two
// steps back, after a maximum filter across neighbouring bands.
const FLUX_LAG_FRAMES = 2;
const MAX_FILTER_RADIUS = 1;

// Peak picking. The threshold follows a local median so that quiet passages
// still yield onsets and a loud drop does not swamp everything around it.
const MEDIAN_WINDOW_SEC = 0.1;
const MEDIAN_FACTOR = 1.7;
const STATIC_THRESHOLD = 0.05;
const LOCAL_MAX_RADIUS_SEC = 0.03;
const MIN_ONSET_GAP_SEC = 0.045;

const NORMALIZATION_PERCENTILE = 0.98;
const SUSTAIN_DECAY_FRACTION = 0.4;
const MAX_SUSTAIN_SEC = 4;

export interface Onset {
  timeSec: number;
  voice: Voice;
  /** Flux at the peak, normalised so that a loud hit in this voice is near 1. */
  strength: number;
  /** Spectral centroid inside the voice's own frequency range, 0..1. */
  pitchNorm: number;
  /** How long the event keeps ringing, which is what makes a hold playable. */
  sustainSec: number;
}

export interface OnsetDetection {
  onsets: Onset[];
  /** Combined novelty curve, the input the tempo tracker works from. */
  novelty: Float32Array;
  frameRate: number;
}

interface VoiceCurves {
  flux: Float32Array[];
  centroid: Float32Array[];
  energy: Float32Array[];
  frameCount: number;
  frameRate: number;
}

export function detectOnsets(spectrogram: Spectrogram): OnsetDetection {
  const curves = computeVoiceCurves(spectrogram);
  const onsets: Onset[] = [];

  for (let voiceIndex = 0; voiceIndex < VOICES.length; voiceIndex++) {
    onsets.push(...collectVoiceOnsets(curves, voiceIndex));
  }

  onsets.sort((first, second) => first.timeSec - second.timeSec);

  return {
    onsets,
    novelty: combineNovelty(curves),
    frameRate: curves.frameRate,
  };
}

// ── Novelty curves ──────────────────────────────────────────────────────────

function computeVoiceCurves(spectrogram: Spectrogram): VoiceCurves {
  const bandVoice = mapBandsToVoices(spectrogram);
  const curves = allocateCurves(spectrogram.frameCount, spectrogram.frameRate);
  const fluxRow = new Float32Array(spectrogram.bandCount);
  const bandPitch = mapBandsToVoicePitch(spectrogram, bandVoice);

  for (let frame = FLUX_LAG_FRAMES; frame < spectrogram.frameCount; frame++) {
    computeFluxRow(spectrogram, frame, fluxRow);
    accumulateFrame(curves, spectrogram, bandVoice, bandPitch, fluxRow, frame);
  }

  finishCurves(curves);

  return curves;
}

function allocateCurves(frameCount: number, frameRate: number): VoiceCurves {
  const perVoice = () => VOICES.map(() => new Float32Array(frameCount));

  return {
    flux: perVoice(),
    centroid: perVoice(),
    energy: perVoice(),
    frameCount,
    frameRate,
  };
}

function mapBandsToVoices(spectrogram: Spectrogram): Int8Array {
  const bandVoice = new Int8Array(spectrogram.bandCount);

  for (let band = 0; band < spectrogram.bandCount; band++) {
    bandVoice[band] = voiceIndexForHz(spectrogram.bandCenterHz[band]);
  }

  return bandVoice;
}

function voiceIndexForHz(hz: number): number {
  for (let index = 0; index < VOICES.length; index++) {
    if (hz < VOICE_UPPER_HZ[VOICES[index]]) return index;
  }

  return VOICES.length - 1;
}

/** Position of each band inside its own voice's range, 0..1 on a log axis. */
function mapBandsToVoicePitch(spectrogram: Spectrogram, bandVoice: Int8Array): Float32Array {
  const lowest = new Float32Array(VOICES.length).fill(Infinity);
  const highest = new Float32Array(VOICES.length).fill(-Infinity);

  for (let band = 0; band < spectrogram.bandCount; band++) {
    const voice = bandVoice[band];
    const logHz = Math.log2(spectrogram.bandCenterHz[band]);

    lowest[voice] = Math.min(lowest[voice], logHz);
    highest[voice] = Math.max(highest[voice], logHz);
  }

  return normalizeBandPitch(spectrogram, bandVoice, lowest, highest);
}

function normalizeBandPitch(
  spectrogram: Spectrogram,
  bandVoice: Int8Array,
  lowest: Float32Array,
  highest: Float32Array,
): Float32Array {
  const pitch = new Float32Array(spectrogram.bandCount);

  for (let band = 0; band < spectrogram.bandCount; band++) {
    const voice = bandVoice[band];
    const span = highest[voice] - lowest[voice];
    const logHz = Math.log2(spectrogram.bandCenterHz[band]);

    if (span <= 0) continue;

    pitch[band] = (logHz - lowest[voice]) / span;
  }

  return pitch;
}

/**
 * Half-wave rectified spectral difference against the maximum-filtered frame
 * FLUX_LAG_FRAMES back. The maximum filter is what stops vibrato and pitch
 * slides from registering as new hits.
 */
function computeFluxRow(spectrogram: Spectrogram, frame: number, into: Float32Array): void {
  const previous = frame - FLUX_LAG_FRAMES;

  for (let band = 0; band < spectrogram.bandCount; band++) {
    const reference = maxFilteredBand(spectrogram, previous, band);

    into[band] = Math.max(0, bandValue(spectrogram, frame, band) - reference);
  }
}

function maxFilteredBand(spectrogram: Spectrogram, frame: number, band: number): number {
  const from = Math.max(0, band - MAX_FILTER_RADIUS);
  const to = Math.min(spectrogram.bandCount - 1, band + MAX_FILTER_RADIUS);
  let peak = 0;

  for (let neighbour = from; neighbour <= to; neighbour++) {
    peak = Math.max(peak, bandValue(spectrogram, frame, neighbour));
  }

  return peak;
}

function accumulateFrame(
  curves: VoiceCurves,
  spectrogram: Spectrogram,
  bandVoice: Int8Array,
  bandPitch: Float32Array,
  fluxRow: Float32Array,
  frame: number,
): void {
  for (let band = 0; band < spectrogram.bandCount; band++) {
    const voice = bandVoice[band];

    curves.flux[voice][frame] += fluxRow[band];
    curves.centroid[voice][frame] += fluxRow[band] * bandPitch[band];
    curves.energy[voice][frame] += bandValue(spectrogram, frame, band);
  }
}

/** Turns the accumulated centroid sums into means and scales the flux to 0..1. */
function finishCurves(curves: VoiceCurves): void {
  for (let voice = 0; voice < VOICES.length; voice++) {
    divideCentroidByFlux(curves.centroid[voice], curves.flux[voice]);
    normalizeByPercentile(curves.flux[voice], NORMALIZATION_PERCENTILE);
  }
}

function divideCentroidByFlux(centroid: Float32Array, flux: Float32Array): void {
  for (let frame = 0; frame < centroid.length; frame++) {
    if (flux[frame] <= 0) continue;

    centroid[frame] /= flux[frame];
  }
}

function normalizeByPercentile(values: Float32Array, fraction: number): void {
  const reference = percentileOf(values, fraction);

  if (reference <= 0) {
    return;
  }

  for (let index = 0; index < values.length; index++) {
    values[index] = Math.min(1, values[index] / reference);
  }
}

function percentileOf(values: Float32Array, fraction: number): number {
  const sorted = Float32Array.from(values).sort();
  const index = Math.floor(fraction * (sorted.length - 1));

  return sorted[Math.max(0, index)];
}

function combineNovelty(curves: VoiceCurves): Float32Array {
  const novelty = new Float32Array(curves.frameCount);

  for (let frame = 0; frame < curves.frameCount; frame++) {
    novelty[frame] =
      curves.flux[0][frame] * 1.2 + curves.flux[1][frame] + curves.flux[2][frame] * 0.8;
  }

  return novelty;
}

// ── Peak picking ────────────────────────────────────────────────────────────

function collectVoiceOnsets(curves: VoiceCurves, voiceIndex: number): Onset[] {
  const flux = curves.flux[voiceIndex];
  const peaks = pickPeaks(flux, curves.frameRate);

  return peaks.map((frame) => ({
    timeSec: frame / curves.frameRate,
    voice: VOICES[voiceIndex],
    strength: flux[frame],
    pitchNorm: curves.centroid[voiceIndex][frame],
    sustainSec: measureSustain(curves.energy[voiceIndex], frame, curves.frameRate),
  }));
}

export function pickPeaks(curve: Float32Array, frameRate: number): number[] {
  const medianRadius = Math.max(1, Math.round(MEDIAN_WINDOW_SEC * frameRate));
  const localRadius = Math.max(1, Math.round(LOCAL_MAX_RADIUS_SEC * frameRate));
  const minimumGap = Math.max(1, Math.round(MIN_ONSET_GAP_SEC * frameRate));
  const peaks: number[] = [];

  for (let frame = 0; frame < curve.length; frame++) {
    if (!isPeakAt(curve, frame, medianRadius, localRadius)) continue;
    if (peaks.length > 0 && frame - peaks[peaks.length - 1] < minimumGap) continue;

    peaks.push(frame);
  }

  return peaks;
}

function isPeakAt(
  curve: Float32Array,
  frame: number,
  medianRadius: number,
  localRadius: number,
): boolean {
  if (curve[frame] <= STATIC_THRESHOLD) return false;
  if (!isLocalMaximum(curve, frame, localRadius)) return false;

  return curve[frame] > medianAround(curve, frame, medianRadius) * MEDIAN_FACTOR + STATIC_THRESHOLD;
}

function isLocalMaximum(curve: Float32Array, frame: number, radius: number): boolean {
  const from = Math.max(0, frame - radius);
  const to = Math.min(curve.length - 1, frame + radius);

  for (let neighbour = from; neighbour <= to; neighbour++) {
    if (curve[neighbour] > curve[frame]) return false;
  }

  return true;
}

function medianAround(curve: Float32Array, frame: number, radius: number): number {
  const from = Math.max(0, frame - radius);
  const to = Math.min(curve.length - 1, frame + radius);
  const window = curve.slice(from, to + 1).sort();

  return window[Math.floor(window.length / 2)];
}

/** How long the voice keeps ringing after the hit, which decides hold length. */
function measureSustain(energy: Float32Array, frame: number, frameRate: number): number {
  const floor = energy[frame] * SUSTAIN_DECAY_FRACTION;
  const limit = Math.min(energy.length - 1, frame + Math.round(MAX_SUSTAIN_SEC * frameRate));

  for (let ahead = frame + 1; ahead <= limit; ahead++) {
    if (energy[ahead] >= floor) continue;

    return (ahead - frame) / frameRate;
  }

  return (limit - frame) / frameRate;
}
