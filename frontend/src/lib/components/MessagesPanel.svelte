<script lang="ts">
  import { markRead, messages } from "../messages.svelte";

  let openId = $state(-1);

  function toggle(id: number) {
    markRead(id);
    if (openId === id) {
      openId = -1;
      return;
    }
    openId = id;
  }
</script>

<div class="flex flex-col gap-3">
  {#each messages as message (message.id)}
    <button
      onclick={() => toggle(message.id)}
      class="flex cursor-pointer flex-col gap-2 border-hard cut-sm bg-raised px-4 py-3 text-left transition-colors duration-150 hover:bg-hover"
    >
      <div class="flex flex-row items-center gap-3">
        <span
          class="h-1.5 w-1.5 shrink-0 rounded-full {message.read
            ? 'bg-fg-dim'
            : 'bg-accent'}"
        ></span>
        <span class="label-caps">{message.from}</span>
      </div>

      <span class="text-base leading-none font-semibold tracking-ui text-fg">
        {message.subject}
      </span>

      {#if openId === message.id}
        <p class="text-sm leading-relaxed text-fg-muted">{message.body}</p>
      {/if}
    </button>
  {/each}
</div>
