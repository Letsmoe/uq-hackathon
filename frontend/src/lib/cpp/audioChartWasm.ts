import createModule from "./main.js";

let modulePromise = null;

async function getModule() {
  if (!modulePromise) {
    modulePromise = createModule();
  }

  return modulePromise;
}

function writeString(Module, text) {
  const size = Module.lengthBytesUTF8(text) + 1;
  const ptr = Module._malloc(size);

  if (!ptr) {
    throw new Error("Failed to allocate string in Wasm memory");
  }

  Module.stringToUTF8(text, ptr, size);
  return ptr;
}

async function decodeAudioFileToMono(file: ArrayBuffer) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();

  const audioBuffer = await audioContext.decodeAudioData(file);

  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channelCount = audioBuffer.numberOfChannels;

  const mono = new Float32Array(length);

  for (let channel = 0; channel < channelCount; channel++) {
    const channelData = audioBuffer.getChannelData(channel);

    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i] / channelCount;
    }
  }

  await audioContext.close();

  return { mono, sampleRate };
}

export async function analyzeAudioFile(
  file: ArrayBuffer,
  patternsJson,
  options = {},
) {
  const Module = await getModule();

  console.log("Loaded Wasm module:", Module);
  console.log("HEAPU8:", Module.HEAPU8);
  console.log("HEAPF32:", Module.HEAPF32);

  if (!Module.HEAPU8 || !Module.HEAPF32) {
    throw new Error(
      "Emscripten heap views are missing. The module was not initialized correctly.",
    );
  }

  const { mono, sampleRate } = await decodeAudioFileToMono(file);

  const timeBase = options.timeBase ?? 480;
  const beatsPerPage = options.beatsPerPage ?? 4;

  const patternsString =
    typeof patternsJson === "string"
      ? patternsJson
      : JSON.stringify(patternsJson);

  const audioByteLength = mono.length * mono.BYTES_PER_ELEMENT;
  const audioPtr = Module._malloc(audioByteLength);

  if (!audioPtr) {
    throw new Error("Failed to allocate audio buffer in Wasm memory");
  }

  const patternsPtr = writeString(Module, patternsString);

  Module.HEAPF32.set(mono, audioPtr / mono.BYTES_PER_ELEMENT);

  const resultPtr = Module._analyze_audio_json(
    audioPtr,
    mono.length,
    sampleRate,
    patternsPtr,
    timeBase,
    beatsPerPage,
  );

  const resultText = Module.UTF8ToString(resultPtr);

  Module._free(audioPtr);
  Module._free(patternsPtr);
  Module._free_result(resultPtr);

  const result = JSON.parse(resultText);

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}
