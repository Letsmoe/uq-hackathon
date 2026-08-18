import { decodeTrack, getAudioContext } from "../audioDecoding";

const CALIBRATION_STORAGE_KEY = "synapse.calibrationSeconds";

/**
 * Sample-accurate playback clock for the rhythm engine.
 *
 * HTMLAudioElement.currentTime only advances around frame boundaries and
 * reports the position of the decode cursor, not of the sample currently
 * leaving the speakers. Both errors land in the same 50-150ms range as the
 * judgment windows themselves. AudioContext.currentTime runs against the
 * audio hardware clock and exposes the output latency, so the engine can ask
 * "what is the player hearing right now" rather than "what have we decoded".
 */
export class AudioPlayer {
  private context: AudioContext;
  private gainNode: GainNode;
  private buffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;

  /** context.currentTime at which the active source node started. */
  private contextStartTime = 0;
  /** Position within the buffer that the active source node started from. */
  private bufferStartOffset = 0;
  private playing = false;

  constructor() {
    this.context = getAudioContext();
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);
  }

  /**
   * Must be called from inside a user-gesture handler. Browsers start an
   * AudioContext suspended, and on iOS it can only be resumed from a gesture.
   */
  async unlock(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  /**
   * Reuses the decode the chart analyzer already paid for when the same track
   * was charted, which is the normal path into a song.
   */
  async load(data: ArrayBuffer): Promise<void> {
    this.buffer = await decodeTrack(data);
  }

  play(fromSeconds = 0): void {
    if (!this.buffer) {
      throw new Error("play() called before load()");
    }
    this.stopSourceNode();

    const sourceNode = this.context.createBufferSource();
    sourceNode.buffer = this.buffer;
    sourceNode.connect(this.gainNode);
    sourceNode.start(0, fromSeconds);

    this.sourceNode = sourceNode;
    this.contextStartTime = this.context.currentTime;
    this.bufferStartOffset = fromSeconds;
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) {
      return;
    }
    this.bufferStartOffset = this.rawPositionSeconds();
    this.stopSourceNode();
    this.playing = false;
  }

  resume(): void {
    if (this.playing) {
      return;
    }
    this.play(this.bufferStartOffset);
  }

  stop(): void {
    this.stopSourceNode();
    this.bufferStartOffset = 0;
    this.playing = false;
  }

  /**
   * Position of the audio the player is hearing right now, in seconds.
   * This is the clock the judgment system must use.
   */
  get positionSeconds(): number {
    return (
      this.rawPositionSeconds() -
      this.outputLatencySeconds +
      AudioPlayer.calibrationSeconds
    );
  }

  get durationSeconds(): number {
    if (!this.buffer) {
      return 0;
    }
    return this.buffer.duration;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Player-tuned offset applied on top of the measured hardware latency.
   * Positive values advance the clock, which makes the engine judge notes
   * earlier — the correction when a player consistently hits late.
   */
  static get calibrationSeconds(): number {
    const stored = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (stored === null) {
      return 0;
    }
    const parsed = Number.parseFloat(stored);
    if (Number.isNaN(parsed)) {
      return 0;
    }
    return parsed;
  }

  static set calibrationSeconds(seconds: number) {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, String(seconds));
  }

  /** The AudioContext is shared and outlives the player, so it is not closed. */
  destroy(): void {
    this.stopSourceNode();
    this.gainNode.disconnect();
    this.buffer = null;
  }

  /** True position within the buffer, ignoring latency and calibration. */
  private rawPositionSeconds(): number {
    if (!this.playing) {
      return this.bufferStartOffset;
    }
    const elapsed = this.context.currentTime - this.contextStartTime;
    return this.bufferStartOffset + elapsed;
  }

  /**
   * How far ahead of the speakers the context clock runs. outputLatency
   * covers the full device pipeline but is not implemented everywhere;
   * baseLatency covers only the graph and is the conservative fallback.
   */
  private get outputLatencySeconds(): number {
    const outputLatency = this.context.outputLatency;
    if (typeof outputLatency === "number" && Number.isFinite(outputLatency)) {
      return outputLatency;
    }
    return this.context.baseLatency;
  }

  private stopSourceNode(): void {
    if (!this.sourceNode) {
      return;
    }
    this.sourceNode.stop();
    this.sourceNode.disconnect();
    this.sourceNode = null;
  }
}
