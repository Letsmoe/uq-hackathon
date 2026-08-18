import { detectOnsets } from "./dsp/onsets";
import { computeSpectrogram } from "./dsp/spectrogram";
import { findSections, type Section } from "./dsp/structure";
import { trackBeats, type BeatGrid } from "./dsp/tempo";
import { quantizeOnsets, type GridOnset } from "./generator/quantize";

/**
 * Everything about the track that does not depend on the difficulty. It is
 * derived once and reused for every difficulty, which is what makes switching
 * difficulty instant.
 */
export interface AudioAnalysis {
  durationSec: number;
  grid: BeatGrid | null;
  onsetsOnGrid: GridOnset[];
  sections: Section[];
}

export function analyzeAudio(mono: Float32Array, sampleRate: number): AudioAnalysis {
  const durationSec = mono.length / sampleRate;
  const spectrogram = computeSpectrogram(mono, sampleRate);

  if (spectrogram.frameCount === 0) {
    return emptyAnalysis(durationSec);
  }

  const detection = detectOnsets(spectrogram);
  const grid = trackBeats(detection.novelty, detection.frameRate, durationSec, detection.onsets);

  if (!grid) {
    return emptyAnalysis(durationSec);
  }

  return {
    durationSec,
    grid,
    onsetsOnGrid: quantizeOnsets(detection.onsets, grid),
    sections: findSections(spectrogram, grid),
  };
}

function emptyAnalysis(durationSec: number): AudioAnalysis {
  return { durationSec, grid: null, onsetsOnGrid: [], sections: [] };
}
