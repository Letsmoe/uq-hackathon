import type { Onset } from "./onsets";

const MIN_BPM = 60;
const MAX_BPM = 200;

// Log-normal tempo preference, the standard remedy for autocorrelation locking
// onto half or double the tempo a listener would tap.
const PREFERRED_BPM = 130;
const TEMPO_PRIOR_OCTAVES = 0.9;

// A candidate lag is scored together with the metrical levels above it. Only
// powers of two are summed: including the third multiple lets a lag of one and
// a half beats score well off the real beat, which reads a drum and bass track
// at two thirds of its tempo.
const COMB_LEVELS = [
  { multiple: 1, weight: 1 },
  { multiple: 2, weight: 0.5 },
  { multiple: 4, weight: 0.25 },
];
const MAX_COMB_MULTIPLE = 4;

// Metrical levels the chosen lag is compared against, how much periodicity a
// level may give up before it stops being a candidate, and the fastest pulse
// still worth reading as the beat.
const METRICAL_FACTORS = [1 / 3, 1 / 2, 2 / 3, 3 / 2, 2, 3];
const METRICAL_TOLERANCE = 0.8;
const MAX_TACTUS_BPM = 185;

// Weight of the spacing penalty in the beat tracker relative to onset strength.
const BEAT_TIGHTNESS = 120;

// How far off the fitted line a tracked beat may sit before it is treated as a
// tracking mistake rather than as evidence about the tempo.
const OUTLIER_FRACTION = 0.25;

const BEATS_PER_BAR = 4;
const DOWNBEAT_MATCH_SEC = 0.07;

export interface BeatGrid {
  bpm: number;
  beatPeriodSec: number;
  firstBeatSec: number;
  beatCount: number;
  /** Beat index modulo four that carries the downbeat. */
  downbeatPhase: number;
}

export function trackBeats(
  novelty: Float32Array,
  frameRate: number,
  durationSec: number,
  onsets: Onset[],
): BeatGrid | null {
  const periodFrames = estimateBeatPeriod(novelty, frameRate);

  if (periodFrames <= 0) {
    return null;
  }

  const beatFrames = traceBeats(novelty, periodFrames);

  if (beatFrames.length < 8) {
    return null;
  }

  const line = fitLine(beatFrames);
  const grid = gridFromLine(line, frameRate, durationSec);

  if (!grid) {
    return null;
  }

  grid.downbeatPhase = findDownbeatPhase(grid, onsets);

  return grid;
}

// ── Tempo estimation ────────────────────────────────────────────────────────

/**
 * Comb-filtered autocorrelation of the novelty curve. Summing a lag with its
 * own multiples rewards the metrical level the whole track agrees on, rather
 * than whichever single lag happens to correlate best.
 */
function estimateBeatPeriod(novelty: Float32Array, frameRate: number): number {
  const range = lagRange(novelty, frameRate);

  if (!range) {
    return 0;
  }

  const correlation = autocorrelate(novelty, range.maxLag * MAX_COMB_MULTIPLE);
  const strongest = strongestLag(correlation, range, frameRate);

  if (strongest === 0) {
    return 0;
  }

  return fastestViableLevel(correlation, strongest, range, frameRate);
}

interface LagRange {
  minLag: number;
  maxLag: number;
}

function lagRange(novelty: Float32Array, frameRate: number): LagRange | null {
  const minLag = Math.max(2, Math.round((frameRate * 60) / MAX_BPM));
  const maxLag = Math.min(novelty.length - 1, Math.round((frameRate * 60) / MIN_BPM));

  if (maxLag <= minLag) {
    return null;
  }

  return { minLag, maxLag };
}

function strongestLag(correlation: Float32Array, range: LagRange, frameRate: number): number {
  let bestLag = 0;
  let bestScore = 0;

  for (let lag = range.minLag; lag <= range.maxLag; lag++) {
    const score = combScore(correlation, lag) * tempoPrior(bpmForLag(lag, frameRate));

    if (score <= bestScore) continue;

    bestScore = score;
    bestLag = lag;
  }

  return bestLag;
}

/**
 * The strongest periodicity is usually not the pulse a chart wants. Drum and
 * bass correlates hardest at its half-time backbeat, and the beat one and a
 * half times too slow correlates nearly as well as the real one. Among the
 * metrical levels that are almost as periodic, the fastest readable pulse is
 * the one notes should be written against.
 */
function fastestViableLevel(
  correlation: Float32Array,
  strongest: number,
  range: LagRange,
  frameRate: number,
): number {
  const floorScore = combScore(correlation, strongest) * METRICAL_TOLERANCE;
  let chosen = strongest;

  for (const factor of METRICAL_FACTORS) {
    const lag = refineLag(correlation, Math.round(strongest * factor), range);

    if (lag >= chosen) continue;
    if (bpmForLag(lag, frameRate) > MAX_TACTUS_BPM) continue;
    if (combScore(correlation, lag) < floorScore) continue;

    chosen = lag;
  }

  return chosen;
}

/** Scaling an integer lag lands between two frames, so the neighbours are checked too. */
function refineLag(correlation: Float32Array, lag: number, range: LagRange): number {
  let bestLag = lag;
  let bestScore = -1;

  for (let candidate = lag - 1; candidate <= lag + 1; candidate++) {
    if (candidate < range.minLag || candidate > range.maxLag) continue;
    if (combScore(correlation, candidate) <= bestScore) continue;

    bestScore = combScore(correlation, candidate);
    bestLag = candidate;
  }

  return bestLag;
}

function bpmForLag(lag: number, frameRate: number): number {
  return (frameRate * 60) / lag;
}

function autocorrelate(values: Float32Array, maxLag: number): Float32Array {
  const correlation = new Float32Array(maxLag + 1);

  for (let lag = 1; lag <= maxLag; lag++) {
    correlation[lag] = correlationAtLag(values, lag);
  }

  return correlation;
}

function correlationAtLag(values: Float32Array, lag: number): number {
  let sum = 0;

  for (let index = 0; index + lag < values.length; index++) {
    sum += values[index] * values[index + lag];
  }

  return sum / values.length;
}

function combScore(correlation: Float32Array, lag: number): number {
  let score = 0;

  for (const level of COMB_LEVELS) {
    const index = lag * level.multiple;

    if (index >= correlation.length) break;

    score += correlation[index] * level.weight;
  }

  return score;
}

function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / PREFERRED_BPM) / TEMPO_PRIOR_OCTAVES;

  return Math.exp(-0.5 * octaves * octaves);
}

// ── Beat tracking ───────────────────────────────────────────────────────────

/**
 * Dynamic programming beat tracker. Picks the sequence of frames that both
 * lands on strong onsets and keeps a near-constant spacing, which is far more
 * robust than scoring a fixed grid at every candidate phase.
 */
function traceBeats(novelty: Float32Array, periodFrames: number): number[] {
  const cumulative = new Float32Array(novelty.length);
  const predecessor = new Int32Array(novelty.length).fill(-1);

  for (let frame = 0; frame < novelty.length; frame++) {
    const best = bestPredecessor(cumulative, frame, periodFrames);

    cumulative[frame] = novelty[frame] + best.score;
    predecessor[frame] = best.frame;
  }

  return backtrace(cumulative, predecessor, periodFrames);
}

function bestPredecessor(
  cumulative: Float32Array,
  frame: number,
  periodFrames: number,
): { frame: number; score: number } {
  const earliest = Math.max(0, frame - Math.round(periodFrames * 2));
  const latest = frame - Math.round(periodFrames * 0.5);
  let bestFrame = -1;
  let bestScore = 0;

  for (let candidate = earliest; candidate <= latest; candidate++) {
    const score = cumulative[candidate] + spacingPenalty(frame - candidate, periodFrames);

    if (bestFrame >= 0 && score <= bestScore) continue;

    bestScore = score;
    bestFrame = candidate;
  }

  return { frame: bestFrame, score: Math.max(0, bestScore) };
}

function spacingPenalty(gapFrames: number, periodFrames: number): number {
  const deviation = Math.log(gapFrames / periodFrames);

  return -BEAT_TIGHTNESS * deviation * deviation;
}

function backtrace(
  cumulative: Float32Array,
  predecessor: Int32Array,
  periodFrames: number,
): number[] {
  let frame = lastStrongFrame(cumulative, periodFrames);
  const beats: number[] = [];

  while (frame >= 0) {
    beats.push(frame);
    frame = predecessor[frame];
  }

  return beats.reverse();
}

/** Starts the backtrace from the best score in the final stretch of the track. */
function lastStrongFrame(cumulative: Float32Array, periodFrames: number): number {
  const from = Math.max(0, cumulative.length - Math.round(periodFrames * 2));
  let bestFrame = -1;
  let bestScore = -Infinity;

  for (let frame = from; frame < cumulative.length; frame++) {
    if (cumulative[frame] <= bestScore) continue;

    bestScore = cumulative[frame];
    bestFrame = frame;
  }

  return bestFrame;
}

// ── Constant-tempo fit ──────────────────────────────────────────────────────

interface FittedLine {
  slope: number;
  intercept: number;
}

/**
 * The chart format carries one tempo, so the tracked beats are reduced to a
 * period and a phase. Both are taken robustly: a least squares fit would let a
 * breakdown where the tracker loses the pulse skew the tempo for the whole
 * track, and a few per cent of tempo error drifts seconds by the last chorus.
 */
function fitLine(beatFrames: number[]): FittedLine {
  const seed = { slope: robustMeanGap(beatFrames), intercept: beatFrames[0] };

  return refineFit(refineFit(seed, beatFrames), beatFrames);
}

/**
 * Numbers each surviving beat by which beat of the line it is, drops the ones
 * the line cannot explain, and refits. Numbering rather than counting is what
 * lets the fit survive a breakdown where the tracker skipped beats entirely.
 */
function refineFit(line: FittedLine, beatFrames: number[]): FittedLine {
  const kept = beatFrames.filter(
    (frame) => Math.abs(residualOf(frame, line)) <= line.slope * OUTLIER_FRACTION,
  );

  if (kept.length < 4) {
    return line;
  }

  return leastSquares(kept, line);
}

function residualOf(frame: number, line: FittedLine): number {
  return frame - (line.intercept + beatIndexOf(frame, line) * line.slope);
}

function beatIndexOf(frame: number, line: FittedLine): number {
  return Math.round((frame - line.intercept) / line.slope);
}

function leastSquares(frames: number[], line: FittedLine): FittedLine {
  const indices = frames.map((frame) => beatIndexOf(frame, line));
  const meanIndex = average(indices);
  const meanFrame = average(frames);
  let covariance = 0;
  let variance = 0;

  for (let index = 0; index < frames.length; index++) {
    covariance += (indices[index] - meanIndex) * (frames[index] - meanFrame);
    variance += (indices[index] - meanIndex) * (indices[index] - meanIndex);
  }

  if (variance <= 0) {
    return line;
  }

  return fittedFrom(covariance / variance, meanIndex, meanFrame);
}

function fittedFrom(slope: number, meanIndex: number, meanFrame: number): FittedLine {
  return { slope, intercept: meanFrame - slope * meanIndex };
}

/**
 * Tracked beats sit on whole frames, so a true period of 34.4 frames shows up
 * as a mix of 34s and 35s. Averaging the plausible gaps recovers the fraction,
 * which the least squares passes then need only polish; seeding them with a
 * whole number instead locks the tempo onto the frame grid.
 */
function robustMeanGap(beatFrames: number[]): number {
  const gaps = gapsBetween(beatFrames);
  const median = medianOf(gaps);
  const plausible = gaps.filter((gap) => gap >= median * 0.7 && gap <= median * 1.3);

  if (plausible.length === 0) {
    return median;
  }

  return average(plausible);
}

function gapsBetween(beatFrames: number[]): number[] {
  const gaps: number[] = [];

  for (let index = 1; index < beatFrames.length; index++) {
    gaps.push(beatFrames[index] - beatFrames[index - 1]);
  }

  return gaps;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);

  return sorted[Math.floor(sorted.length / 2)];
}

function average(values: number[]): number {
  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total / values.length;
}

function gridFromLine(line: FittedLine, frameRate: number, durationSec: number): BeatGrid | null {
  const beatPeriodSec = line.slope / frameRate;

  if (!Number.isFinite(beatPeriodSec) || beatPeriodSec <= 0) {
    return null;
  }

  const firstBeatSec = wrapIntoFirstPeriod(line.intercept / frameRate, beatPeriodSec);

  return {
    bpm: 60 / beatPeriodSec,
    beatPeriodSec,
    firstBeatSec,
    beatCount: Math.max(0, Math.floor((durationSec - firstBeatSec) / beatPeriodSec)),
    downbeatPhase: 0,
  };
}

/** The tracker may start mid-track, so the grid is walked back to its first beat. */
function wrapIntoFirstPeriod(offsetSec: number, beatPeriodSec: number): number {
  let firstBeatSec = offsetSec % beatPeriodSec;

  if (firstBeatSec < 0) {
    firstBeatSec += beatPeriodSec;
  }

  return firstBeatSec;
}

// ── Downbeat ────────────────────────────────────────────────────────────────

/** The bar starts where the low register hits hardest, which is the kick. */
function findDownbeatPhase(grid: BeatGrid, onsets: Onset[]): number {
  const lowOnsets = onsets.filter((onset) => onset.voice === "low");
  let bestPhase = 0;
  let bestScore = -1;

  for (let phase = 0; phase < BEATS_PER_BAR; phase++) {
    const score = phaseScore(grid, lowOnsets, phase);

    if (score <= bestScore) continue;

    bestScore = score;
    bestPhase = phase;
  }

  return bestPhase;
}

function phaseScore(grid: BeatGrid, lowOnsets: Onset[], phase: number): number {
  let score = 0;

  for (const onset of lowOnsets) {
    const beatPosition = (onset.timeSec - grid.firstBeatSec) / grid.beatPeriodSec;
    const nearestBeat = Math.round(beatPosition);
    const errorSec = Math.abs(beatPosition - nearestBeat) * grid.beatPeriodSec;

    if (errorSec > DOWNBEAT_MATCH_SEC) continue;
    if (modulo(nearestBeat, BEATS_PER_BAR) !== phase) continue;

    score += onset.strength;
  }

  return score;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
