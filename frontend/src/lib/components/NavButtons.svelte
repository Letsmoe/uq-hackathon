<script module lang="ts">
  export type NavId = "solo" | "course" | "event";
</script>

<script lang="ts">
  import DiamondIcon from "phosphor-svelte/lib/DiamondIcon";
  import LockSimpleIcon from "phosphor-svelte/lib/LockSimpleIcon";
  import SparkleIcon from "phosphor-svelte/lib/SparkleIcon";
  import StackSimpleIcon from "phosphor-svelte/lib/StackSimpleIcon";
  import type { Component } from "svelte";

  interface Props {
    active?: NavId;
  }

  let { active = $bindable("solo") }: Props = $props();

  type NavButton = {
    id: NavId;
    label: string;
    sub: string;
    icon: Component;
    locked: boolean;
  };

  const buttons: NavButton[] = [
    {
      id: "solo",
      label: "Solo",
      sub: "Play",
      icon: DiamondIcon,
      locked: false,
    },
    {
      id: "course",
      label: "Course",
      sub: "Challenge",
      icon: StackSimpleIcon,
      locked: true,
    },
    {
      id: "event",
      label: "Event",
      sub: "Limited",
      icon: SparkleIcon,
      locked: true,
    },
  ];

  function select(button: NavButton) {
    if (button.locked) {
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

  function tabClass(button: NavButton) {
    if (active === button.id) {
      return "is-active";
    }
    return "";
  }
</script>

<nav class="flex w-60 flex-col gap-5">
  {#each buttons as button (button.id)}
    <button
      onclick={() => select(button)}
      disabled={button.locked}
      aria-current={active === button.id}
      class="nav-tab hard-press border-hard cut {tabClass(button)}"
    >
      <span class="icon-slot flex h-7 w-7 shrink-0 items-center justify-center">
        <button.icon size={26} weight={iconWeight(button.id)} />
      </span>

      <span class="flex flex-col items-start gap-1">
        <span class="text-lg leading-none font-black tracking-ui uppercase">
          {button.label}
        </span>
        <span class="sub-label">
          {#if button.locked}
            <LockSimpleIcon size={12} weight="fill" />
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

  .nav-tab {
    @apply flex w-full cursor-pointer flex-row items-center gap-4 bg-raised px-5 py-4 text-left text-fg transition-colors duration-150;
  }

  .nav-tab:not(:disabled):hover {
    @apply bg-hover;
  }

  .nav-tab:disabled {
    @apply cursor-not-allowed bg-canvas text-fg-dim;
  }

  .nav-tab.is-active {
    @apply bg-accent text-ink-fg;
  }

  .sub-label {
    @apply flex flex-row items-center gap-1.5 text-2xs leading-none font-bold tracking-loose uppercase opacity-75;
  }
</style>
