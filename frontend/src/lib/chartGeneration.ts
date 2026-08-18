import { DIFFICULTIES, type Difficulty } from "./chart";
import type { Chart } from "./game/chart";
import type { WorkerRequest, WorkerResponse } from "./chart/workerProtocol";

export { DIFFICULTIES };
export type { Difficulty };

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
}

const pending = new Map<number, PendingRequest>();

// One analysis per track, shared by every difficulty built from it.
const audioIds = new WeakMap<ArrayBuffer, number>();
const analysisReady = new Map<number, Promise<void>>();

let worker: Worker | null = null;
let nextRequestId = 1;
let nextAudioId = 1;

/**
 * Generates the chart for one difficulty. The track is analysed once and the
 * analysis is kept in the worker, so switching difficulty afterwards only costs
 * the note selection.
 */
export async function generateChart(
  audio: ArrayBuffer,
  difficulty: Difficulty,
): Promise<Chart> {
  const audioId = await ensureAnalyzed(audio);
  const response = await send({ kind: "build", requestId: nextRequestId++, audioId, difficulty });

  if (response.kind !== "chart") {
    throw new Error("Worker returned no chart");
  }

  return response.chart;
}

async function ensureAnalyzed(audio: ArrayBuffer): Promise<number> {
  const audioId = idFor(audio);
  const existing = analysisReady.get(audioId);

  if (existing) {
    await existing;
    return audioId;
  }

  const started = analyze(audio, audioId);

  analysisReady.set(audioId, started);
  await started;

  return audioId;
}

function idFor(audio: ArrayBuffer): number {
  const existing = audioIds.get(audio);

  if (existing !== undefined) {
    return existing;
  }

  const audioId = nextAudioId++;

  audioIds.set(audio, audioId);

  return audioId;
}

async function analyze(audio: ArrayBuffer, audioId: number): Promise<void> {
  const decoded = await decodeToMono(audio.slice(0));

  await send(
    {
      kind: "analyze",
      requestId: nextRequestId++,
      audioId,
      mono: decoded.mono,
      sampleRate: decoded.sampleRate,
    },
    [decoded.mono.buffer],
  );
}

// ── Worker plumbing ─────────────────────────────────────────────────────────

function send(request: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    pending.set(request.requestId, { resolve, reject });
    getWorker().postMessage(request, transfer);
  });
}

function getWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL("./chart/worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => settle(event.data);

  return worker;
}

function settle(response: WorkerResponse): void {
  const request = pending.get(response.requestId);

  if (!request) {
    return;
  }

  pending.delete(response.requestId);

  if (response.kind === "error") {
    request.reject(new Error(response.message));
    return;
  }

  request.resolve(response);
}

// ── Decoding ────────────────────────────────────────────────────────────────

interface DecodedAudio {
  mono: Float32Array;
  sampleRate: number;
}

/**
 * Downmixes to mono for analysis. decodeAudioData detaches the buffer it is
 * handed, so callers that still need the encoded bytes must pass a copy.
 */
async function decodeToMono(file: ArrayBuffer): Promise<DecodedAudio> {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio is not supported in this browser");
  }

  const audioContext = new AudioContextClass();
  const audioBuffer = await audioContext.decodeAudioData(file);
  const mono = downmix(audioBuffer);

  await audioContext.close();

  return { mono, sampleRate: audioBuffer.sampleRate };
}

function downmix(audioBuffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(audioBuffer.length);

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    addChannel(mono, audioBuffer.getChannelData(channel), audioBuffer.numberOfChannels);
  }

  return mono;
}

function addChannel(mono: Float32Array, channel: Float32Array, channelCount: number): void {
  for (let index = 0; index < mono.length; index++) {
    mono[index] += channel[index] / channelCount;
  }
}
