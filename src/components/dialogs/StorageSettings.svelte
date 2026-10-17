<script lang="ts">
  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import AppModal from "$/components/basic/AppModal.svelte";
  import { tr } from "$/utils/i18n";
  import {
    createLabelStorage,
    normalizeStorageConfig,
    storageConfig,
    StorageError,
    type StorageConfig,
  } from "$/utils/label_storage";

  let { onApply, onClose }: { onApply: (config: StorageConfig) => void; onClose: () => void } = $props();
  let config = $state<StorageConfig>({ ...get(storageConfig) });
  let active = true;
  onDestroy(() => {
    active = false;
  });
  let busy = $state(false);
  let error = $state("");
  let tested = $state(false);
  let modal: AppModal;

  const check = async (apply: boolean) => {
    if (busy) return;
    busy = true;
    error = "";
    tested = false;
    try {
      const normalized = normalizeStorageConfig(config);
      const userId = await createLabelStorage(normalized).test();
      if (!active) return;
      tested = true;
      if (apply) {
        onApply({ ...normalized, userId });
        modal.hide();
      }
    } catch (e) {
      error = e instanceof StorageError ? $tr(`storage.error.${e.code}`) : String(e);
    } finally {
      busy = false;
    }
  };
</script>

<AppModal title={$tr("storage.title")} {onClose} bind:this={modal}>
  <form
    id="storage-settings"
    onsubmit={(e) => {
      e.preventDefault();
      check(true);
    }}
    oninput={() => {
      tested = false;
      error = "";
    }}>
    <fieldset disabled={busy}>
      <label class="form-label" for="storage-mode">{$tr("storage.mode")}</label>
      <select id="storage-mode" class="form-select mb-3" bind:value={config.mode}>
        <option value="local">{$tr("storage.local")}</option>
        <option value="remote">{$tr("storage.remote")}</option>
      </select>
      {#if config.mode === "remote"}
        <label class="form-label" for="storage-url">{$tr("storage.url")}</label>
        <input
          id="storage-url"
          class="form-control mb-3"
          type="url"
          bind:value={config.url}
          placeholder="https://labels.example.com"
          required
          autocomplete="url" />
        <label class="form-label" for="storage-token">{$tr("storage.token")}</label>
        <input
          id="storage-token"
          class="form-control"
          type="password"
          bind:value={config.token}
          required
          autocomplete="off" />
        <p class="form-text">{$tr("storage.remote.hint")}</p>
      {/if}
      <p class="form-text">{$tr("storage.switch.hint")}</p>
      <p class="form-text">{$tr("storage.scope.hint")}</p>
    </fieldset>
    {#if error}<div class="alert alert-danger" role="alert">{error}</div>{/if}
    {#if tested}<div class="alert alert-success" role="status">{$tr("storage.test.success")}</div>{/if}
  </form>
  {#snippet footer()}
    {#if config.mode === "remote"}
      <button class="btn btn-outline-secondary" disabled={busy} onclick={() => check(false)}
        >{$tr("storage.test")}</button>
    {/if}
    <button class="btn btn-primary" type="submit" form="storage-settings" disabled={busy}
      >{$tr(busy ? "storage.connecting" : "storage.apply")}</button>
  {/snippet}
</AppModal>
