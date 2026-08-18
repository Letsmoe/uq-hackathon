import { analyzeAudio, buildChart } from "./index";
import type { AudioAnalysis } from "./analyze";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

// Analysis is the expensive half and does not depend on the difficulty, so it
// stays here and every difficulty of the same track is built from it.
const analyses = new Map<number, AudioAnalysis>();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    respond(handle(request));
  } catch (error) {
    respond({ kind: "error", requestId: request.requestId, message: messageOf(error) });
  }
};

function handle(request: WorkerRequest): WorkerResponse {
  if (request.kind === "analyze") {
    analyses.set(request.audioId, analyzeAudio(request.mono, request.sampleRate));

    return { kind: "analyzed", requestId: request.requestId };
  }

  const analysis = analyses.get(request.audioId);

  if (!analysis) {
    throw new Error(`No analysis for audio ${request.audioId}`);
  }

  return {
    kind: "chart",
    requestId: request.requestId,
    chart: buildChart(analysis, request.difficulty),
  };
}

function respond(response: WorkerResponse): void {
  self.postMessage(response);
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
