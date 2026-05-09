<script lang="ts">
  let { onclick = () => {} } = $props();
</script>

<button {onclick} class="start-btn">
  <span
    class="tracking-[0.75em] text-xl font-light text-on-surface-dark uppercase pl-4"
    >Start</span
  >
  <svg
    class="arrow"
    viewBox="0 0 8 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1 1L7 6L1 11"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</button>

<style>
  @reference "tailwindcss";
  @reference "../../src/style/global.css";

  .start-btn {
    @apply relative flex flex-row items-center justify-center gap-8
           bg-surface-dark border-none cursor-pointer
           px-24 py-7 w-full
           transition-all duration-200;

    /* Left purple accent bar */
    border-left: 4px solid theme("colors.accent-purple");

    /* Arrow-right shape: flat left, chevron point on right */
    clip-path: polygon(
      0 0,
      calc(100% - 44px) 0,
      100% 50%,
      calc(100% - 44px) 100%,
      0 100%
    );

    &:hover {
      @apply brightness-125;
    }

    &:active {
      @apply brightness-90;
    }
  }

  .arrow {
    @apply w-3 h-3 text-on-surface-dark/40;
  }
</style>
