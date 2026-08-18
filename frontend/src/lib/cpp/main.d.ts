/**
 * Hand-written declarations for the Emscripten-generated main.js.
 * Must stay in sync with EXPORTED_FUNCTIONS and EXPORTED_RUNTIME_METHODS
 * in the top-level Makefile.
 */

export interface AudioChartModule {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;

  _malloc(byteLength: number): number;
  _free(pointer: number): void;

  /** Returns a pointer to a NUL-terminated JSON string owned by the module. */
  _analyze_audio_json(
    monoSamplesPointer: number,
    sampleCount: number,
    sampleRate: number,
    patternsJsonPointer: number,
    timeBase: number,
    beatsPerPage: number,
    difficultyPointer: number,
  ): number;
  _free_result(pointer: number): void;

  UTF8ToString(pointer: number): string;
  stringToUTF8(text: string, pointer: number, maxBytes: number): void;
  lengthBytesUTF8(text: string): number;
}

export default function createModule(): Promise<AudioChartModule>;
