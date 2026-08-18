/**
 * One AudioContext and one decode per track, shared by the chart analyzer and
 * the playback clock.
 *
 * decodeAudioData allocates the entire track as float PCM — around 110 MB for
 * a five-minute stereo file — so decoding the same bytes once for analysis and
 * again for playback is by far the most expensive thing the app does.
 */

let sharedContext: AudioContext | null = null;

// Only the most recently decoded track is kept. Holding every decoded buffer
// would cost ~110 MB per song, which a tablet will not survive.
let cachedSource: ArrayBuffer | null = null;
let cachedDecode: Promise<AudioBuffer> | null = null;

export function getAudioContext(): AudioContext {
  if (sharedContext) {
    return sharedContext;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio is not supported in this browser");
  }

  sharedContext = new AudioContextClass();
  return sharedContext;
}

/**
 * `encoded` is copied before decoding because decodeAudioData detaches the
 * ArrayBuffer it is handed, and callers keep the encoded bytes for replay.
 * Callers must pass the same ArrayBuffer instance to share a decode.
 */
export function decodeTrack(encoded: ArrayBuffer): Promise<AudioBuffer> {
  if (cachedSource === encoded && cachedDecode) {
    return cachedDecode;
  }

  const decode = getAudioContext().decodeAudioData(encoded.slice(0));
  cachedSource = encoded;
  cachedDecode = decode;
  // A failed decode must not be cached, or the track can never be retried.
  decode.catch(() => forget(encoded));

  return decode;
}

function forget(encoded: ArrayBuffer): void {
  if (cachedSource !== encoded) {
    return;
  }
  cachedSource = null;
  cachedDecode = null;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
