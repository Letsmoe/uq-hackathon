<script lang="ts">
  interface Props {
    /** Labels the target, so the marks stay readable to a screen reader. */
    titles: string[];
    selected?: number;
  }

  let { titles, selected = $bindable(0) }: Props = $props();

  function markClass(index: number) {
    if (index === selected) {
      return "w-10 bg-accent";
    }
    return "w-3 bg-raised";
  }
</script>

<!-- The mark is small, the target around it is not. -->
<div class="flex flex-row gap-2">
  {#each titles as title, index (index)}
    <button
      onclick={() => (selected = index)}
      aria-label="Go to {title}"
      class="flex h-8 w-8 cursor-pointer items-center justify-center border-none bg-transparent p-0"
    >
      <span
        class="border-hard h-3 transition-all duration-300 {markClass(index)}"
      ></span>
    </button>
  {/each}
</div>
