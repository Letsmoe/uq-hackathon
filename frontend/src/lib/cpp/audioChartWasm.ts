import createModule from "./main.js";
import type { AudioChartModule } from "./main.js";
import type { Chart } from "../game/chart";

const DEFAULT_TIME_BASE = 480;
const DEFAULT_BEATS_PER_PAGE = 4;
const DEFAULT_DIFFICULTY: Difficulty = "normal";

/** Selects the note generation ruleset in main.cpp. */
export type Difficulty = "easy" | "normal" | "hard" | "expert" | "chaos";

export interface AnalyzeOptions {
  timeBase?: number;
  beatsPerPage?: number;
  difficulty?: Difficulty;
}

export interface DecodedAudio {
  mono: Float32Array;
  sampleRate: number;
}

let modulePromise: Promise<AudioChartModule> | null = null;

function getModule(): Promise<AudioChartModule> {
  if (!modulePromise) {
    modulePromise = createModule();
  }
  return modulePromise;
}

function writeString(module: AudioChartModule, text: string): number {
  const byteLength = module.lengthBytesUTF8(text) + 1;
  const pointer = module._malloc(byteLength);
  if (!pointer) {
    throw new Error("Failed to allocate string in Wasm memory");
  }
  module.stringToUTF8(text, pointer, byteLength);
  return pointer;
}

/**
 * Downmixes to mono for analysis. decodeAudioData detaches the ArrayBuffer it
 * is handed, so callers that still need the encoded bytes must pass a copy.
 */
async function decodeAudioFileToMono(file: ArrayBuffer): Promise<DecodedAudio> {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio is not supported in this browser");
  }

  const audioContext = new AudioContextClass();
  const audioBuffer = await audioContext.decodeAudioData(file);
  const channelCount = audioBuffer.numberOfChannels;
  const mono = new Float32Array(audioBuffer.length);

  for (let channel = 0; channel < channelCount; channel++) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let i = 0; i < audioBuffer.length; i++) {
      mono[i] += channelData[i] / channelCount;
    }
  }

  const sampleRate = audioBuffer.sampleRate;
  await audioContext.close();
  return { mono, sampleRate };
}

function serializePatterns(patterns: unknown): string {
  if (typeof patterns === "string") {
    return patterns;
  }
  return JSON.stringify(patterns);
}

function resolveOptions(options: AnalyzeOptions) {
  let timeBase = DEFAULT_TIME_BASE;
  if (options.timeBase !== undefined) {
    timeBase = options.timeBase;
  }

  let beatsPerPage = DEFAULT_BEATS_PER_PAGE;
  if (options.beatsPerPage !== undefined) {
    beatsPerPage = options.beatsPerPage;
  }

  let difficulty = DEFAULT_DIFFICULTY;
  if (options.difficulty !== undefined) {
    difficulty = options.difficulty;
  }

  return { timeBase, beatsPerPage, difficulty };
}

function generateChart(
  module: AudioChartModule,
  audio: DecodedAudio,
  patternsString: string,
  options: AnalyzeOptions,
): Chart {
  const { timeBase, beatsPerPage, difficulty } = resolveOptions(options);
  const audioByteLength = audio.mono.length * audio.mono.BYTES_PER_ELEMENT;

  const audioPointer = module._malloc(audioByteLength);
  if (!audioPointer) {
    throw new Error("Failed to allocate audio buffer in Wasm memory");
  }
  const patternsPointer = writeString(module, patternsString);
  const difficultyPointer = writeString(module, difficulty);

  // HEAPF32 is read only after both allocations: growing the heap detaches
  // and replaces the module's typed-array views.
  module.HEAPF32.set(audio.mono, audioPointer / audio.mono.BYTES_PER_ELEMENT);

  const resultPointer = module._analyze_audio_json(
    audioPointer,
    audio.mono.length,
    audio.sampleRate,
    patternsPointer,
    timeBase,
    beatsPerPage,
    difficultyPointer,
  );
  const resultText = module.UTF8ToString(resultPointer);

  module._free(audioPointer);
  module._free(patternsPointer);
  module._free(difficultyPointer);
  module._free_result(resultPointer);

  const result = JSON.parse(resultText);
  if (result.error) {
    throw new Error(result.error);
  }
  return result as Chart;
}

export async function analyzeAudioFile(
  file: ArrayBuffer,
  patterns: unknown,
  options: AnalyzeOptions = {},
): Promise<Chart> {
  const module = await getModule();
  if (!module.HEAPU8 || !module.HEAPF32) {
    throw new Error(
      "Emscripten heap views are missing. The module was not initialized correctly.",
    );
  }

  const audio = await decodeAudioFileToMono(file);
  return generateChart(module, audio, serializePatterns(patterns), options);
}
