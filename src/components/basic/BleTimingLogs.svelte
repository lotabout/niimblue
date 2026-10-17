<script lang="ts">
  import { appConfig, printerClient } from "$/stores/app";
  import { tr } from "$/utils/i18n";
  import { BluetoothClient, IOS_DEFAULT_WRITE_INTERVAL_MS } from "$/utils/bluetooth_client";
  import { NIIMBOT_CLIENT_DEFAULTS } from "@mmote/niimbluelib";
  import { browserInfo } from "$/utils/browser.svelte";

  const id = $props.id();

  $effect(() => {
    $printerClient?.setDebug($appConfig.debugLogs ?? false);
    if ($printerClient instanceof BluetoothClient) {
      $printerClient.setTimingLogsEnabled($appConfig.bleTimingLogs ?? false);
      if ($appConfig.packetIntervalMs === undefined) $printerClient.resetPacketInterval();
      else $printerClient.setPacketInterval($appConfig.packetIntervalMs);
    } else if ($printerClient) {
      $printerClient.setPacketInterval($appConfig.packetIntervalMs ?? NIIMBOT_CLIENT_DEFAULTS.packetIntervalMs);
    }
  });
</script>

<label class="form-label mb-1" for={`${id}-interval`}>{$tr("debug.packet_interval")}</label>
<div class="input-group input-group-sm">
  <input
    id={`${id}-interval`}
    class="form-control"
    type="number"
    min="0"
    step="1"
    placeholder={`${browserInfo.isIOSSafari ? IOS_DEFAULT_WRITE_INTERVAL_MS : NIIMBOT_CLIENT_DEFAULTS.packetIntervalMs}`}
    value={$appConfig.packetIntervalMs ?? ""}
    oninput={(event) => {
      const input = event.currentTarget;
      if (input.validity.valid) {
        $appConfig.packetIntervalMs = input.value === "" ? undefined : input.valueAsNumber;
      }
    }} />
  <span class="input-group-text">ms</span>
  <button class="btn btn-outline-secondary" onclick={() => ($appConfig.packetIntervalMs = undefined)}
    >{$tr("debug.reset")}</button>
</div>
<div class="d-flex gap-1 mt-2">
  {#each [100, 20, 0] as interval (interval)}
    <button
      class="btn btn-sm btn-outline-secondary"
      class:active={$appConfig.packetIntervalMs === interval}
      aria-pressed={$appConfig.packetIntervalMs === interval}
      onclick={() => ($appConfig.packetIntervalMs = interval)}>{interval} ms</button>
  {/each}
</div>
<div class="form-text mb-3">{$tr("debug.packet_interval.help")}</div>

<div class="form-check">
  <input id={`${id}-debug`} class="form-check-input" type="checkbox" bind:checked={$appConfig.debugLogs} />
  <label class="form-check-label" for={`${id}-debug`}>{$tr("debug.logs")}</label>
</div>
<div class="form-text mb-2">{$tr("debug.logs.help")}</div>

<div class="form-check">
  <input {id} class="form-check-input" type="checkbox" bind:checked={$appConfig.bleTimingLogs} />
  <label class="form-check-label" for={id}>{$tr("debug.ble_timing_logs")}</label>
</div>
<div class="form-text">{$tr("debug.ble_timing_logs.help")}</div>
