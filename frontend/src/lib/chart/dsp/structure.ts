import { bandValue, type Spectrogram } from "./spectrogram";
import type { BeatGrid } from "./tempo";

const COARSE_BAND_COUNT = 16;

// Half width of the checkerboard kernel that turns the self-similarity matrix
// into a boundary novelty curve.
const KERNEL_BEATS = 8;

const BEATS_PER_BAR = 4;
const MIN_SECTION_BARS = 4;
const REPEAT_SIMILARITY = 0.93;

/**
 * One musically homogeneous stretch of the track. Sections are what let the
 * generator reuse a chunk of chart when the music itself repeats, which is the
 * difference between a chart that reads as authored and one that reads as noise.
 */
export interface Section {
  startBeat: number;
  endBeat: number;
  /** Mean loudness relative to the loudest section, 0..1. */
  intensity: number;
  /** Index of the earlier section this one repeats, or -1. */
  repeatOfIndex: number;
}

interface BeatFeatures {
  /** COARSE_BAND_COUNT values per beat, L2 normalised for cosine similarity. */
  shape: Float32Array;
  loudness: Float32Array;
  beatCount: number;
}

export function findSections(spectrogram: Spectrogram, grid: BeatGrid): Section[] {
  const features = computeBeatFeatures(spectrogram, grid);

  if (features.beatCount < MIN_SECTION_BARS * BEATS_PER_BAR * 2) {
    return [wholeTrackSection(features)];
  }

  const boundaries = findBoundaries(features, grid);
  const sections = buildSections(boundaries, features);

  markRepeats(sections, features);

  return sections;
}

function wholeTrackSection(features: BeatFeatures): Section {
  return {
    startBeat: 0,
    endBeat: features.beatCount,
    intensity: 1,
    repeatOfIndex: -1,
  };
}

// ── Beat-synchronous features ───────────────────────────────────────────────

function computeBeatFeatures(spectrogram: Spectrogram, grid: BeatGrid): BeatFeatures {
  const beatCount = grid.beatCount;
  const features: BeatFeatures = {
    shape: new Float32Array(beatCount * COARSE_BAND_COUNT),
    loudness: new Float32Array(beatCount),
    beatCount,
  };

  for (let beat = 0; beat < beatCount; beat++) {
    const from = beatStartFrame(spectrogram, grid, beat);
    const to = beatStartFrame(spectrogram, grid, beat + 1);

    averageFramesIntoBeat(spectrogram, from, to, features, beat);
  }

  normalizeLoudness(features.loudness);

  return features;
}

function beatStartFrame(spectrogram: Spectrogram, grid: BeatGrid, beat: number): number {
  const timeSec = grid.firstBeatSec + beat * grid.beatPeriodSec;
  const frame = Math.round(timeSec * spectrogram.frameRate);

  return Math.max(0, Math.min(spectrogram.frameCount, frame));
}

function averageFramesIntoBeat(
  spectrogram: Spectrogram,
  from: number,
  to: number,
  features: BeatFeatures,
  beat: number,
): void {
  const offset = beat * COARSE_BAND_COUNT;
  const frameCount = Math.max(1, to - from);

  for (let frame = from; frame < to; frame++) {
    addFrameToCoarseBands(spectrogram, frame, features.shape, offset);
  }

  scaleRange(features.shape, offset, COARSE_BAND_COUNT, 1 / frameCount);
  features.loudness[beat] = sumRange(features.shape, offset, COARSE_BAND_COUNT);
  normalizeRangeToUnitLength(features.shape, offset, COARSE_BAND_COUNT);
}

function addFrameToCoarseBands(
  spectrogram: Spectrogram,
  frame: number,
  shape: Float32Array,
  offset: number,
): void {
  const bandsPerGroup = spectrogram.bandCount / COARSE_BAND_COUNT;

  for (let band = 0; band < spectrogram.bandCount; band++) {
    const group = Math.min(COARSE_BAND_COUNT - 1, Math.floor(band / bandsPerGroup));

    shape[offset + group] += bandValue(spectrogram, frame, band);
  }
}

function scaleRange(values: Float32Array, offset: number, length: number, factor: number): void {
  for (let index = 0; index < length; index++) {
    values[offset + index] *= factor;
  }
}

function sumRange(values: Float32Array, offset: number, length: number): number {
  let total = 0;

  for (let index = 0; index < length; index++) {
    total += values[offset + index];
  }

  return total;
}

function normalizeRangeToUnitLength(values: Float32Array, offset: number, length: number): void {
  const magnitude = Math.sqrt(sumOfSquares(values, offset, length));

  if (magnitude <= 0) {
    return;
  }

  scaleRange(values, offset, length, 1 / magnitude);
}

function sumOfSquares(values: Float32Array, offset: number, length: number): number {
  let total = 0;

  for (let index = 0; index < length; index++) {
    total += values[offset + index] * values[offset + index];
  }

  return total;
}

function normalizeLoudness(loudness: Float32Array): void {
  let peak = 0;

  for (const value of loudness) {
    peak = Math.max(peak, value);
  }

  if (peak <= 0) {
    return;
  }

  for (let index = 0; index < loudness.length; index++) {
    loudness[index] /= peak;
  }
}

function beatSimilarity(features: BeatFeatures, first: number, second: number): number {
  const firstOffset = first * COARSE_BAND_COUNT;
  const secondOffset = second * COARSE_BAND_COUNT;
  let dot = 0;

  for (let index = 0; index < COARSE_BAND_COUNT; index++) {
    dot += features.shape[firstOffset + index] * features.shape[secondOffset + index];
  }

  return dot;
}

// ── Boundaries ──────────────────────────────────────────────────────────────

/**
 * Foote's checkerboard novelty: a boundary is a beat where everything before it
 * resembles itself, everything after resembles itself, and the two halves do
 * not resemble each other.
 */
function findBoundaries(features: BeatFeatures, grid: BeatGrid): number[] {
  const novelty = computeBoundaryNovelty(features);
  const minimumGap = MIN_SECTION_BARS * BEATS_PER_BAR;
  const peaks = pickNoveltyPeaks(novelty, minimumGap);
  const snapped = peaks.map((beat) => snapToBarStart(beat, grid));

  return dedupeBoundaries([0, ...snapped, features.beatCount], minimumGap);
}

function computeBoundaryNovelty(features: BeatFeatures): Float32Array {
  const novelty = new Float32Array(features.beatCount);

  for (let beat = KERNEL_BEATS; beat < features.beatCount - KERNEL_BEATS; beat++) {
    novelty[beat] = checkerboardAt(features, beat);
  }

  return novelty;
}

function checkerboardAt(features: BeatFeatures, beat: number): number {
  const before = beat - KERNEL_BEATS;
  const sameSide = blockSimilarity(features, before, before) + blockSimilarity(features, beat, beat);
  const acrossSides = blockSimilarity(features, before, beat);

  return Math.max(0, sameSide / 2 - acrossSides);
}

/** Mean similarity between every beat of one KERNEL_BEATS block and every beat of another. */
function blockSimilarity(features: BeatFeatures, startFirst: number, startSecond: number): number {
  let total = 0;

  for (let offset = 0; offset < KERNEL_BEATS; offset++) {
    total += rowSimilarity(features, startFirst + offset, startSecond);
  }

  return total / (KERNEL_BEATS * KERNEL_BEATS);
}

function rowSimilarity(features: BeatFeatures, beat: number, startSecond: number): number {
  let total = 0;

  for (let offset = 0; offset < KERNEL_BEATS; offset++) {
    total += beatSimilarity(features, beat, startSecond + offset);
  }

  return total;
}

function pickNoveltyPeaks(novelty: Float32Array, minimumGap: number): number[] {
  const threshold = meanOf(novelty) * 1.4;
  const peaks: number[] = [];

  for (let beat = 1; beat < novelty.length - 1; beat++) {
    if (novelty[beat] < threshold) continue;
    if (novelty[beat] < novelty[beat - 1] || novelty[beat] < novelty[beat + 1]) continue;
    if (peaks.length > 0 && beat - peaks[peaks.length - 1] < minimumGap) continue;

    peaks.push(beat);
  }

  return peaks;
}

function meanOf(values: Float32Array): number {
  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / Math.max(1, values.length);
}

/** Sections that start mid-bar read as mistakes, so boundaries move to a downbeat. */
function snapToBarStart(beat: number, grid: BeatGrid): number {
  const sinceDownbeat = beat - grid.downbeatPhase;
  const bars = Math.round(sinceDownbeat / BEATS_PER_BAR);

  return Math.max(0, grid.downbeatPhase + bars * BEATS_PER_BAR);
}

function dedupeBoundaries(boundaries: number[], minimumGap: number): number[] {
  const sorted = [...new Set(boundaries)].sort((first, second) => first - second);
  const kept = [sorted[0]];

  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index] - kept[kept.length - 1] < minimumGap) continue;

    kept.push(sorted[index]);
  }

  kept[kept.length - 1] = sorted[sorted.length - 1];

  return kept;
}

// ── Sections and repeats ────────────────────────────────────────────────────

function buildSections(boundaries: number[], features: BeatFeatures): Section[] {
  const sections: Section[] = [];

  for (let index = 0; index + 1 < boundaries.length; index++) {
    sections.push({
      startBeat: boundaries[index],
      endBeat: boundaries[index + 1],
      intensity: meanLoudness(features, boundaries[index], boundaries[index + 1]),
      repeatOfIndex: -1,
    });
  }

  return sections;
}

function meanLoudness(features: BeatFeatures, startBeat: number, endBeat: number): number {
  let total = 0;

  for (let beat = startBeat; beat < endBeat; beat++) {
    total += features.loudness[beat];
  }

  return total / Math.max(1, endBeat - startBeat);
}

/**
 * A section that sounds like an earlier one of the same length gets that
 * section's chart copied onto it, so a returning chorus plays the same notes.
 */
function markRepeats(sections: Section[], features: BeatFeatures): void {
  for (let index = 1; index < sections.length; index++) {
    sections[index].repeatOfIndex = findEarlierMatch(sections, index, features);
  }
}

function findEarlierMatch(sections: Section[], index: number, features: BeatFeatures): number {
  const section = sections[index];

  for (let earlier = 0; earlier < index; earlier++) {
    if (sections[earlier].repeatOfIndex >= 0) continue;
    if (!lengthsAreComparable(sections[earlier], section)) continue;
    if (sectionSimilarity(features, sections[earlier], section) < REPEAT_SIMILARITY) continue;

    return earlier;
  }

  return -1;
}

/**
 * The last section of a track runs to wherever the audio ends, so an exact
 * length match would rule out the very repeats that matter most.
 */
function lengthsAreComparable(first: Section, second: Section): boolean {
  return Math.abs(sectionLength(first) - sectionLength(second)) <= BEATS_PER_BAR;
}

function sectionLength(section: Section): number {
  return section.endBeat - section.startBeat;
}

function sectionSimilarity(features: BeatFeatures, first: Section, second: Section): number {
  const length = Math.min(sectionLength(first), sectionLength(second));
  let total = 0;

  for (let offset = 0; offset < length; offset++) {
    total += beatSimilarity(features, first.startBeat + offset, second.startBeat + offset);
  }

  return total / Math.max(1, length);
}
