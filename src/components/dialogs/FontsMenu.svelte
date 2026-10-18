<script lang="ts">
  import AppModal from "$/components/basic/AppModal.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { fontLibrary, fontState, localUserFonts, userFonts } from "$/stores/fonts";
  import { storageConfig, StorageError } from "$/utils/label_storage";
  import { FileUtils } from "$/utils/file_utils";
  import { tr } from "$/utils/i18n";
  import { databaseUsedSpace } from "$/utils/browser_database";

  let show = $state(false);
  let usedSpace = $state(0);
  let selectExt = $state<"ttf" | "woff2">("ttf");
  let overrideFamily = $state("");
  let busy = $state(false);
  let error = $state("");
  const disabled = $derived(busy || $fontState.loading);
  const localFontsToUpload = $derived(
    $localUserFonts.filter((font) => !$userFonts.some((f) => f.family === font.family)),
  );

  const errorMessage = (e: unknown) => {
    if (e instanceof StorageError) {
      if (e.code === "conflict") return $tr("fonts.error.conflict");
      if (e.code === "missing") return $tr("fonts.error.missing");
      if (e.code === "invalid") return $tr("fonts.error.invalid");
      return $tr(`storage.error.${e.code}`);
    }
    return String(e);
  };

  const run = async (action: () => Promise<void>) => {
    if (disabled) return;
    busy = true;
    error = "";
    try {
      await action();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
      try {
        usedSpace = await databaseUsedSpace();
      } catch (e) {
        error ||= errorMessage(e);
      }
    }
  };

  const browseFont = () =>
    run(async () => {
      const destination = $storageConfig;
      const result = await FileUtils.pickAndReadBinaryFile(selectExt);
      if (result.data.byteLength > 32 * 1024 * 1024) throw new Error($tr("fonts.error.size"));
      const fontName = overrideFamily.trim() || result.name.replace(/\.[^.]+$/, "");
      const compressed = await FileUtils.compressData(result.data);
      const b64data = await FileUtils.base64buf(compressed);
      if ($storageConfig !== destination) return;
      await fontLibrary.add({ gzippedDataB64: b64data, family: fontName, mimeType: `text/${selectExt}` });
      overrideFamily = "";
    });

  const removeFont = (family: string) => run(() => fontLibrary.remove(family));

  $effect(() => {
    if (show) {
      error = "";
      void (async () => {
        try {
          await localUserFonts.ready();
          await fontLibrary.refresh();
          usedSpace = await databaseUsedSpace();
        } catch (e) {
          error = errorMessage(e);
        }
      })();
    }
  });
</script>

<button class="btn btn-outline-secondary" title={$tr("fonts.title")} onclick={() => (show = true)}>
  <MdIcon icon="settings" />
</button>

{#if show}
  <AppModal title={$tr("fonts.title")} bind:show>
    {#if $storageConfig.mode === "remote"}
      <p class="form-text">{$tr("fonts.remote.hint")}</p>
      <div class="d-flex gap-2 mb-3 flex-wrap">
        <button class="btn btn-sm btn-outline-secondary" {disabled} onclick={() => run(fontLibrary.refresh)}>
          {$tr("storage.refresh")}
        </button>
        {#if localFontsToUpload.length}
          <button class="btn btn-sm btn-outline-primary" {disabled} onclick={() => run(fontLibrary.uploadLocal)}>
            {$tr("fonts.upload.local")} ({localFontsToUpload.length})
          </button>
        {/if}
      </div>
    {/if}
    {#if disabled}<p role="status">{$tr("storage.loading")}</p>{/if}
    {#if error || $fontState.error}
      <div class="alert alert-danger" role="alert">{error || errorMessage($fontState.error)}</div>
    {/if}
    <div class="mb-1">
      {#each $userFonts as font (font.family)}
        <div class="input-group input-group-sm mb-1">
          <span class="input-group-text fs-5 font-name" style:font-family={font.family}>{font.family}</span>
          <button
            class="btn btn-sm btn-danger"
            {disabled}
            title={$tr("fonts.delete")}
            onclick={() => removeFont(font.family)}>
            <MdIcon icon="delete" />
          </button>
        </div>
      {:else}
        👀
      {/each}
    </div>
    <hr />
    <fieldset {disabled}>
      <div class="input-group input-group-sm">
        <span class="input-group-text">{$tr("fonts.add")}</span>
        <select class="form-select" bind:value={selectExt}>
          <option value="ttf">ttf</option>
          <option value="woff2">woff2</option>
        </select>
        <input
          type="text"
          class="form-control w-25"
          placeholder={$tr("fonts.title_override")}
          bind:value={overrideFamily} />
        <button class="btn btn-sm btn-secondary" onclick={browseFont}>{$tr("fonts.browse")}</button>
      </div>
    </fieldset>
    {#snippet footer()}
      <div class="text-secondary">
        {#if $storageConfig.mode === "local"}
          {usedSpace} {$tr("params.saved_labels.kb_used")} |
        {/if}
        <a class="text-secondary" href="https://fonts.google.com">{$tr("fonts.gfonts")}</a>
      </div>
    {/snippet}
  </AppModal>
{/if}

<style>
  .font-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
