<script lang="ts">
  import AppModal from "$/components/basic/AppModal.svelte";
  import { tr } from "$/utils/i18n";
  import BleTimingLogs from "$/components/basic/BleTimingLogs.svelte";

  let { show = $bindable() } = $props();
</script>

<AppModal title={$tr("debug.title")} bind:show>
  <BleTimingLogs />
</AppModal>
