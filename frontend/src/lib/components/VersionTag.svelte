<script lang="ts">
  interface Props {
    version?: string;
  }

  let { version = "0.0.0" }: Props = $props();
</script>

<!-- Build stamp. It has to be readable when looked for and invisible when
     not, so it sits in the corner at the dimmest step of the ramp. -->
<span
  class="pointer-events-none absolute bottom-4 left-6 text-2xs leading-none font-bold tracking-loose text-fg-dim uppercase opacity-50 select-none"
>
  v{version}
</span>
