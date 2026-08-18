import type { Chart } from "../game/chart";
import type { Difficulty } from "./generator/difficulty";

export type WorkerRequest =
  | {
      kind: "analyze";
      requestId: number;
      audioId: number;
      mono: Float32Array;
      sampleRate: number;
    }
  | { kind: "build"; requestId: number; audioId: number; difficulty: Difficulty };

export type WorkerResponse =
  | { kind: "analyzed"; requestId: number }
  | { kind: "chart"; requestId: number; chart: Chart }
  | { kind: "error"; requestId: number; message: string };
