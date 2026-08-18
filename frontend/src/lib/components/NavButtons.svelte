<script module lang="ts">
  export type NavId = "solo" | "course" | "event" | "random";
</script>

<script lang="ts">
  import DiamondIcon from "phosphor-svelte/lib/DiamondIcon";
  import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
  import ShuffleIcon from "phosphor-svelte/lib/ShuffleIcon";
  import SparkleIcon from "phosphor-svelte/lib/SparkleIcon";
  import StackSimpleIcon from "phosphor-svelte/lib/StackSimpleIcon";
  import type { Component } from "svelte";

  interface Props {
    active?: NavId;
    onrandom?: () => void;
  }

  let { active = $bindable("solo"), onrandom = () => {} }: Props = $props();

  type NavButton = {
    id: NavId;
    label: string;
    sub: string;
    icon: Component;
    clip: string;
    locked: boolean;
  };

  const buttons: NavButton[] = [
    {
      id: "solo",
      label: "Solo",
      sub: "Play",
      icon: DiamondIcon,
      clip: "clip-slant-right",
      locked: false,
    },
    {
      id: "course",
      label: "Course",
      sub: "Challenge",
      icon: StackSimpleIcon,
      clip: "clip-slant-both",
      locked: true,
    },
    {
      id: "event",
      label: "Event",
      sub: "Limited",
      icon: SparkleIcon,
      clip: "clip-slant-both",
      locked: true,
    },
    {
      id: "random",
      label: "Random",
      sub: "Surprise",
      icon: ShuffleIcon,
      clip: "clip-slant-left",
      locked: false,
    },
  ];

  // RANDOM is an action rather than a destination: it rerolls the selection and
  // leaves the player on the tab they were already on.
  function select(button: NavButton) {
    if (button.locked) {
      return;
    }
    if (button.id === "random") {
      onrandom();
      return;
    }
    active = button.id;
  }

  function iconWeight(id: NavId) {
    if (active === id) {
      return "fill";
    }
    return "regular";
  }
</script>

<nav class="flex flex-row items-stretch">
  {#each buttons as button (button.id)}
    <button
      onclick={() => select(button)}
      disabled={button.locked}
      aria-current={active === button.id}
      class="nav-tab {button.clip} {active === button.id ? 'is-active' : ''}"
    >
      <span class="icon-slot flex h-6 w-6 shrink-0 items-center justify-center">
        <button.icon size={22} weight={iconWeight(button.id)} />
      </span>

      <span class="flex flex-col items-start gap-1.5">
        <span class="text-lg leading-none font-semibold tracking-ui uppercase">
          {button.label}
        </span>
        <span class="sub-label">
          {#if button.locked}
            <LockSimpleIcon size={10} weight="fill" />
          {/if}
          {button.sub}
        </span>
      </span>
    </button>
  {/each}
</nav>

<style>
  @reference "tailwindcss";
  @reference "../../style/global.css";

  /* The slanted clips overlap by the width of the cut, so the four tabs read as
     one continuous strip rather than as separate pills. */
  .nav-tab {
    @apply -mr-[24px] flex cursor-pointer flex-row items-center gap-4 border-none bg-raised py-4 pr-12 pl-14 text-fg-muted transition-colors duration-150;
  }

  .nav-tab:not(:disabled):hover {
    @apply bg-hover text-fg;
  }

  .nav-tab:disabled {
    @apply cursor-not-allowed text-fg-dim;
  }

  /* Later tabs paint over the slanted edge of earlier ones, so the active tab
     has to be lifted for its cut to stay visible. */
  .nav-tab.is-active {
    @apply relative z-10 bg-ink text-ink-fg;
  }

  .nav-tab.is-active .icon-slot {
    @apply text-accent;
  }

  .sub-label {
    @apply flex flex-row items-center gap-1.5 text-2xs leading-none tracking-loose uppercase opacity-70;
  }
</style>
