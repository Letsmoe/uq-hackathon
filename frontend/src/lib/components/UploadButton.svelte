<script lang="ts">
  import { Upload } from "svelte-radix";
  import { analyzeAudioFile } from "../cpp/audioChartWasm.js";
  import { onMount } from "svelte";
  import patterns from "../../assets/patterns.json";

  const { onupload = (chart: any, buffer: ArrayBuffer, file: File) => {} } =
    $props();
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

  async function handleFileSelect(event: Event) {
    const file = input.files?.[0];

    if (!file) {
      console.error("No audio file selected");
      return;
    }

    const arrayBuffer = await file.arrayBuffer();
    const copy = arrayBuffer.slice(0); // Create a copy of the ArrayBuffer for the chart data

    const chart = await analyzeAudioFile(arrayBuffer, patterns, {
      timeBase: 480,
      beatsPerPage: 4,
    });

    onupload(chart, copy, file);
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
