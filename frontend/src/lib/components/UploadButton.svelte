<script lang="ts">
  import { Upload } from "svelte-radix";
  import { analyzeAudioFile } from "../cpp/audioChartWasm.js";
  import patterns from "../../assets/patterns.json";

  const {
    onupload = (
      chart: any,
      buffer: ArrayBuffer,
      file: File,
      coverUrl: string | null,
    ) => {},
  } = $props();

  function extractCover(buffer: ArrayBuffer): string | null {
    const b = new Uint8Array(buffer);
    if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;
    const version = b[3];
    const tagSize =
      ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) |
      ((b[8] & 0x7f) << 7)  |  (b[9] & 0x7f);
    let pos = 10;
    const end = Math.min(10 + tagSize, b.length);
    while (pos + 10 < end) {
      const frameId = String.fromCharCode(b[pos], b[pos+1], b[pos+2], b[pos+3]);
      const frameSize = version === 4
        ? ((b[pos+4] & 0x7f) << 21) | ((b[pos+5] & 0x7f) << 14) |
          ((b[pos+6] & 0x7f) << 7)  |  (b[pos+7] & 0x7f)
        : (b[pos+4] << 24) | (b[pos+5] << 16) | (b[pos+6] << 8) | b[pos+7];
      if (frameSize <= 0 || frameSize > tagSize) break;
      if (frameId === "APIC") {
        let i = pos + 10 + 1;
        while (i < end && b[i] !== 0) i++;
        const mime = new TextDecoder().decode(b.slice(pos + 11, i)) || "image/jpeg";
        i++; i++;
        while (i < end && b[i] !== 0) i++;
        i++;
        const imgData = b.slice(i, pos + 10 + frameSize);
        const blob = new Blob([imgData], { type: mime });
        return URL.createObjectURL(blob);
      }
      pos += 10 + frameSize;
    }
    return null;
  }

  async function handleFileSelect(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const arrayBuffer = await file.arrayBuffer();
    const copy = arrayBuffer.slice(0);
    const coverUrl = extractCover(arrayBuffer);
    const chart = await analyzeAudioFile(arrayBuffer, patterns, {
      timeBase: 480,
      beatsPerPage: 4,
    });
    onupload(chart, copy, file, coverUrl);
    input.value = "";
  }
</script>

<label
  class="ml-1 h-full aspect-square flex items-center justify-center border border-on-surface-light/20 hover:bg-on-surface-light/[0.07] bg-on-surface-light/[0.03] text-on-surface-light/40 hover:text-on-surface-light/80 hover:border-on-surface-light/40 transition-all duration-200 cursor-pointer text-lg leading-none"
  title="Upload"
>
  <input
    type="file"
    accept=".mp3,.m4a,.aac,.wav,.ogg,.flac,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/flac,audio/*"
    class="sr-only"
    onchange={handleFileSelect}
  />
  <Upload size="24" />
</label>