<script lang="ts">
  import { Upload } from "svelte-radix";
  import { analyzeAudioFile } from "../cpp/audioChartWasm.js";
  import { onMount } from "svelte";
  import patterns from "../../assets/patterns.json";

  const {
    onupload = (
      chart: any,
      buffer: ArrayBuffer,
      file: File,
      coverUrl: string | null,
    ) => {},
  } = $props();

  let input: HTMLInputElement;

  onMount(() => {
    input = document.createElement("input");
    input.style.display = "none";
    input.type = "file";
    input.accept = "audio/*";
    document.body.appendChild(input);
  });

  let button: HTMLButtonElement;

  async function onclick() {
    input.addEventListener("change", handleFileSelect, { once: true });
    input.click();
  }

  /**
   * Pure browser ID3v2 APIC extractor — no npm deps.
   * Returns a blob URL for the first embedded cover picture, or null.
   */
  function extractCover(buffer: ArrayBuffer): string | null {
    const b = new Uint8Array(buffer);

    // Must start with "ID3"
    if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;

    const version = b[3]; // 3 = ID3v2.3, 4 = ID3v2.4

    // Synchsafe tag size
    const tagSize =
      ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) |
      ((b[8] & 0x7f) << 7)  |  (b[9] & 0x7f);

    let pos = 10;
    const end = Math.min(10 + tagSize, b.length);

    while (pos + 10 < end) {
      const frameId = String.fromCharCode(b[pos], b[pos+1], b[pos+2], b[pos+3]);

      // Frame size: synchsafe in v2.4, plain big-endian in v2.3
      const frameSize = version === 4
        ? ((b[pos+4] & 0x7f) << 21) | ((b[pos+5] & 0x7f) << 14) |
          ((b[pos+6] & 0x7f) << 7)  |  (b[pos+7] & 0x7f)
        : (b[pos+4] << 24) | (b[pos+5] << 16) | (b[pos+6] << 8) | b[pos+7];

      if (frameSize <= 0 || frameSize > tagSize) break;

      if (frameId === "APIC") {
        // APIC layout: [encoding(1)] [mime\0] [pictype(1)] [desc\0] [imagedata]
        let i = pos + 10 + 1; // skip encoding byte
        while (i < end && b[i] !== 0) i++; // skip mime type
        const mime = new TextDecoder().decode(b.slice(pos + 11, i)) || "image/jpeg";
        i++; // skip null
        i++; // skip picture type
        while (i < end && b[i] !== 0) i++; // skip description
        i++; // skip null

        const imgData = b.slice(i, pos + 10 + frameSize);
        const blob = new Blob([imgData], { type: mime });
        return URL.createObjectURL(blob);
      }

      pos += 10 + frameSize;
    }

    return null;
  }

  async function handleFileSelect(_event: Event) {
    const file = input.files?.[0];
    if (!file) { console.error("No audio file selected"); return; }

    const arrayBuffer = await file.arrayBuffer();
    const copy = arrayBuffer.slice(0);

    const coverUrl = extractCover(arrayBuffer);

    const chart = await analyzeAudioFile(arrayBuffer, patterns, {
      timeBase: 480,
      beatsPerPage: 4,
    });

    onupload(chart, copy, file, coverUrl);
  }
</script>

<button
  {onclick}
  bind:this={button}
  class="ml-1 h-full aspect-square flex items-center justify-center border border-on-surface-light/20 hover:bg-on-surface-light/[0.07] bg-on-surface-light/[0.03] text-on-surface-light/40 hover:text-on-surface-light/80 hover:border-on-surface-light/40 transition-all duration-200 cursor-pointer bg-transparent text-lg leading-none"
  title="Upload"
>
  <Upload size="24"></Upload>
</button>