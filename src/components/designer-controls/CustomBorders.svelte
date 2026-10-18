<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { LabelBorder } from "$/fabric-object/border";
  import { createBorderStorage, type BorderSummary, type BorderUpload } from "$/utils/border_storage";
  import { storageConfig, StorageError, type StorageConfig } from "$/utils/label_storage";
  import { createImageBorderArchive, prepareBorderUpload } from "$/utils/image_border";
  import { tr, type TranslationKey } from "$/utils/i18n";

  let { selectedBorder, valueUpdated }: { selectedBorder: LabelBorder; valueUpdated: () => void } = $props();
  let summaries = $state<BorderSummary[]>([]);
  let staged = $state<Awaited<ReturnType<typeof prepareBorderUpload>>>();
  let name = $state("");
  let loading = $state(false);
  let busy = $state(false);
  let error = $state("");
  let active = true;
  let generation = 0;
  let listRevision = 0;
  const current = (scope: number) => active && scope === generation;
  const errorText = (value: unknown) => {
    if (value instanceof StorageError) {
      if (value.code === "conflict" || value.code === "missing" || value.code === "invalid")
        return $tr(`borders.error.${value.code}`);
      return $tr(`storage.error.${value.code}`);
    }
    if (value instanceof Error && value.message.startsWith("borders.error."))
      return $tr(value.message as TranslationKey);
    return String(value);
  };
  const refresh = async (config: StorageConfig, scope: number) => {
    const revision = ++listRevision;
    loading = true;
    error = "";
    try {
      const items = await createBorderStorage(config).list();
      if (current(scope) && revision === listRevision) summaries = items;
    } catch (e) {
      if (current(scope) && revision === listRevision) error = errorText(e);
    } finally {
      if (current(scope) && revision === listRevision) loading = false;
    }
  };
  $effect(() => {
    const config = $storageConfig;
    const scope = ++generation;
    summaries = [];
    staged = undefined;
    busy = false;
    void refresh(config, scope);
  });
  onDestroy(() => {
    active = false;
  });
  onMount(() => {
    const check = () => {
      if (document.visibilityState === "visible" && !busy && !loading) void refresh($storageConfig, generation);
    };
    const interval = setInterval(check, 30000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  });
  const run = async (action: (config: StorageConfig, scope: number) => Promise<void>) => {
    if (busy || loading) return;
    const config = $storageConfig;
    const scope = generation;
    busy = true;
    error = "";
    try {
      await action(config, scope);
    } catch (e) {
      if (current(scope)) error = errorText(e);
    } finally {
      if (current(scope)) busy = false;
    }
  };
  const chooseFile = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    void run(async (_config, scope) => {
      const upload = await prepareBorderUpload(file);
      if (!current(scope)) return;
      staged = upload;
      name = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
    });
  };
  const use = (summary: BorderSummary) =>
    run(async (config, scope) => {
      const archive = await createBorderStorage(config).load(summary);
      if (!current(scope)) return;
      await selectedBorder.useImageBorder(archive, () => current(scope));
      if (current(scope)) {
        selectedBorder.canvas?.sendObjectToBack(selectedBorder);
        valueUpdated();
      }
    });
  const save = () => {
    if (!staged || !name.trim()) return;
    const upload: BorderUpload = { ...staged, name: name.trim() };
    void run(async (config, scope) => {
      const summary = await createBorderStorage(config).add(upload);
      if (!current(scope)) return;
      staged = undefined;
      await refresh(config, scope);
      await selectedBorder.useImageBorder(createImageBorderArchive(summary.id, summary.name, upload.png), () =>
        current(scope),
      );
      if (current(scope)) {
        selectedBorder.canvas?.sendObjectToBack(selectedBorder);
        valueUpdated();
      }
    });
  };
  const remove = (summary: BorderSummary) => {
    if (!confirm($tr("borders.delete.confirm").replace("{name}", summary.name))) return;
    void run(async (config, scope) => {
      await createBorderStorage(config).delete(summary.id);
      if (current(scope)) await refresh(config, scope);
    });
  };
</script>

<div class="custom-borders">
  <p class="form-text">{$tr($storageConfig.mode === "local" ? "borders.local.hint" : "borders.remote.hint")}</p>
  <button
    class="btn btn-sm btn-outline-secondary mb-2"
    disabled={busy || loading}
    onclick={() => refresh($storageConfig, generation)}>{$tr("storage.refresh")}</button>
  {#if error}<div class="alert alert-danger" role="alert">{error}</div>{/if}
  {#if loading || busy}<p role="status">{$tr("storage.loading")}</p>{/if}
  <div class="custom-grid" aria-label={$tr("borders.mine")}>
    {#each summaries as summary (summary.id)}
      <div class="custom-card">
        <button class="custom-use" disabled={busy || loading} onclick={() => use(summary)} title={summary.name}>
          <img src={summary.thumbnail} alt="" loading="lazy" />
          <span>{summary.name}</span>
        </button>
        <button
          class="custom-delete"
          disabled={busy || loading}
          onclick={() => remove(summary)}
          aria-label={$tr("borders.delete").replace("{name}", summary.name)}>×</button>
      </div>
    {:else}
      {#if !loading}<p class="form-text">{$tr("borders.empty")}</p>{/if}
    {/each}
  </div>
  <fieldset disabled={busy || loading} class="upload-border">
    <label for="border-upload">{$tr("borders.upload")}</label>
    <input
      id="border-upload"
      class="form-control form-control-sm"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      onchange={chooseFile} />
    <p class="form-text">{$tr("borders.upload.hint")}</p>
    {#if staged}
      <img class="upload-preview" src={staged.thumbnail} alt={$tr("borders.preview")} />
      <label for="border-name">{$tr("borders.name")}</label>
      <input id="border-name" class="form-control form-control-sm" maxlength="100" bind:value={name} />
      <button class="btn btn-sm btn-primary mt-2 w-100" disabled={!name.trim()} onclick={save}
        >{$tr("borders.save.use")}</button>
    {/if}
  </fieldset>
</div>

<style>
  .custom-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    max-height: 240px;
    overflow: auto;
    margin-bottom: 12px;
  }
  .custom-card {
    position: relative;
    min-width: 0;
    border: 1px solid #454f61;
    border-radius: 6px;
  }
  .custom-use {
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 6px;
    font-size: 11px;
  }
  .custom-use span {
    display: block;
    overflow-wrap: anywhere;
    padding-right: 10px;
  }
  .custom-use img,
  .upload-preview {
    display: block;
    width: 100%;
    height: 64px;
    object-fit: contain;
    background: #fff;
    border-radius: 3px;
    margin-bottom: 6px;
  }
  .custom-delete {
    position: absolute;
    right: 2px;
    bottom: 1px;
    border: 0;
    background: #222;
    color: #ffb7b7;
    border-radius: 3px;
  }
  .upload-border label {
    display: block;
    margin-bottom: 5px;
    font-size: 12px;
  }
  .form-text {
    font-size: 12px;
  }
  .alert {
    padding: 8px;
    overflow-wrap: anywhere;
    font-size: 12px;
  }
</style>
