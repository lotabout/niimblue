<script lang="ts">
  import { tr } from "$/utils/i18n";
  import { onDestroy, onMount } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import SavedLabelsBrowser from "$/components/designer-controls/SavedLabelsBrowser.svelte";
  import { ExportedLabelTemplateSchema, type ExportedLabelTemplate } from "$/types";
  import { createLabelStorage, storageConfig, StorageError, type StoredLabel } from "$/utils/label_storage";
  import { LocalDocumentStorage } from "$/utils/local_document_storage";
  import { databaseUsedSpace } from "$/utils/browser_database";
  import { Toasts } from "$/utils/toasts";
  import { FileUtils } from "$/utils/file_utils";
  import * as fabric from "fabric";
  import { Utils } from "@mmote/niimbluelib";
  import { z } from "zod";
  import AppModal from "$/components/basic/AppModal.svelte";

  interface Props {
    onRequestLabelTemplate: () => ExportedLabelTemplate;
    onLoadRequested: (label: StoredLabel) => Promise<boolean>;
    onClose?: () => void;
    onDelete: (id: string) => void;
    canvas: fabric.Canvas;
    csvEnabled: boolean;
    hasUnsavedChanges: boolean;
  }

  let { onRequestLabelTemplate, onLoadRequested, canvas, csvEnabled, onClose, onDelete, hasUnsavedChanges }: Props =
    $props();

  let savedLabels = $state<StoredLabel[]>([]);
  let selectedIndex = $state<number>(-1);
  let active = true;
  onDestroy(() => {
    active = false;
  });
  let loading = $state(false);
  let error = $state("");
  const storage = createLabelStorage();
  const reportError = (e: unknown) => {
    error = e instanceof StorageError ? $tr(`storage.error.${e.code}`) : String(e);
    Toasts.error(error);
  };
  const refresh = async () => {
    if (loading) return;
    loading = true;
    error = "";
    try {
      savedLabels = await storage.list();
      selectedIndex = -1;
      customDefaultTemplate = (await LocalDocumentStorage.loadDefaultTemplate()) !== null;
      await calcUsedSpace();
    } catch (e) {
      reportError(e);
    } finally {
      loading = false;
    }
  };
  let usedSpace = $state<number>(0);
  let customDefaultTemplate = $state(false);
  let isStandalone = Utils.getAvailableTransports().capacitorBle;
  let modalRef: AppModal;

  const calcUsedSpace = async () => {
    usedSpace = await databaseUsedSpace();
  };

  const onLabelSelected = (index: number) => {
    if (!loading) selectedIndex = index;
  };

  const onLabelExport = (idx: number) => {
    try {
      FileUtils.saveLabelAsJson(savedLabels[idx]);
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onLabelDelete = async (idx: number) => {
    if (loading) return;
    loading = true;
    try {
      const id = savedLabels[idx].id!;
      await storage.delete(id, savedLabels[idx].storageRevision);
      savedLabels = savedLabels.filter((_, index) => index !== idx);
      selectedIndex = -1;
      onDelete(id);
      await calcUsedSpace();
    } catch (e) {
      reportError(e);
    } finally {
      loading = false;
    }
  };

  const onMakeDefaultClicked = async () => {
    if (loading) return;
    loading = true;
    try {
      const label = onRequestLabelTemplate();
      label.thumbnailBase64 = undefined;
      await LocalDocumentStorage.saveDefaultTemplate(label);
      customDefaultTemplate = true;
      await calcUsedSpace();
    } catch (e) {
      Toasts.error(e);
    } finally {
      loading = false;
    }
  };

  const onRemoveDefaultClicked = async () => {
    if (loading) return;
    loading = true;
    try {
      await LocalDocumentStorage.saveDefaultTemplate(undefined);
      customDefaultTemplate = false;
      await calcUsedSpace();
    } catch (e) {
      Toasts.error(e);
    } finally {
      loading = false;
    }
  };

  const onLoadClicked = async () => {
    if (selectedIndex === -1 || loading) return;
    loading = true;
    try {
      // Fetch again so opening a label includes changes saved by another device.
      const label = await storage.load(savedLabels[selectedIndex].id!);
      if (!active) return;
      if (!label) throw new StorageError("missing");
      let message = hasUnsavedChanges ? $tr("editor.warning.load") : "";
      if (label.csv) message += "\n" + $tr("editor.warning.load.csv");
      if (message && !confirm(message)) return;
      if (await onLoadRequested(label)) modalRef.hide();
    } catch (e) {
      reportError(e);
    } finally {
      loading = false;
    }
  };

  const onImportClicked = async () => {
    if (loading) return;
    loading = true;
    try {
      const contents = await FileUtils.pickAndReadSingleTextFile("json");
      const rawData = JSON.parse(contents);
      const imported = FileUtils.parseSingleOrList(rawData, ExportedLabelTemplateSchema);
      const items = imported.kind === "single" ? [imported.item] : imported.items;

      if (items.length === 0) {
        return;
      }

      await storage.import(items);
      savedLabels = await storage.list();
      selectedIndex = -1;
      await calcUsedSpace();

      Toasts.message(
        items.length === 1
          ? $tr("params.saved_labels.import.added_one")
          : $tr("params.saved_labels.import.added_many").replace("{count}", String(items.length)),
      );
    } catch (e) {
      if (e instanceof z.ZodError) {
        Toasts.zodErrors(e, "Label import error:");
      } else {
        reportError(e);
      }
    } finally {
      loading = false;
    }
  };

  const onExportClicked = () => {
    try {
      const label = onRequestLabelTemplate();
      if (label.title) {
        label.title = label.title.replaceAll(/[\\/:*?"<>|]/g, "_");
      }
      FileUtils.saveLabelAsJson(label);
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onExportAllClicked = () => {
    try {
      FileUtils.saveLabelsAsJson(savedLabels);
    } catch (e) {
      if (e instanceof z.ZodError) {
        Toasts.zodErrors(e, "Labels export error:");
      } else {
        Toasts.error(e);
      }
    }
  };

  const onExportPngClicked = () => {
    try {
      FileUtils.saveCanvasAsPng(canvas);
    } catch (e) {
      Toasts.zodErrors(e, "Canvas save error:");
    }
  };

  const onExportUrlClicked = async () => {
    try {
      const label = onRequestLabelTemplate();
      const url = await FileUtils.makeLabelUrl(label);

      if (url.length > 2000 && !confirm($tr("params.saved_labels.save.url.warn"))) {
        return;
      }

      navigator.clipboard.writeText(url);
      Toasts.message($tr("params.saved_labels.save.url.copied"));
    } catch (e) {
      Toasts.error(e);
    }
  };

  onMount(() => {
    void refresh();
  });
</script>

<AppModal title={$tr("workspace.library")} variant="library" {onClose} bind:this={modalRef}>
  <div class="library-toolbar">
    <div class="library-summary">
      <span class="label-count">{$tr("workspace.library.count").replace("{count}", String(savedLabels.length))}</span>
      <span class="storage-status">
        <MdIcon icon={$storageConfig.mode === "remote" ? "cloud_done" : "computer"} />
        {$tr($storageConfig.mode === "remote" ? "storage.remote" : "storage.local")}
        {#if $storageConfig.mode === "local"}
          <span class="storage-usage">· {usedSpace} {$tr("params.saved_labels.kb_used")}</span>
        {/if}
      </span>
    </div>

    <div class="library-tools">
      <button
        class="btn library-refresh"
        disabled={loading}
        onclick={refresh}
        title={$tr(loading ? "storage.loading" : "storage.refresh")}
        aria-label={$tr(loading ? "storage.loading" : "storage.refresh")}>
        <MdIcon icon="refresh" />
      </button>
      <button
        type="button"
        class="btn library-import"
        title={$tr("params.saved_labels.load.json")}
        disabled={loading}
        onclick={onImportClicked}>
        <MdIcon icon="file_upload" />
        <span>{$tr("workspace.library.import")}</span>
      </button>
      <div class="btn-group">
        <button
          type="button"
          class="btn library-more"
          title={$tr("workspace.more")}
          aria-label={$tr("workspace.more")}
          disabled={loading}
          data-bs-toggle="dropdown"
          aria-expanded="false">
          <MdIcon icon="more_horiz" />
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><h6 class="dropdown-header">{$tr("params.saved_labels.export.current")}</h6></li>
          <li>
            <button class="dropdown-item" onclick={onExportClicked}>
              {$tr("params.saved_labels.export.json")}
            </button>
          </li>
          <li>
            <button class="dropdown-item" onclick={onExportPngClicked}>
              {$tr("params.saved_labels.export.png")}
            </button>
          </li>
          {#if !isStandalone}
            <li>
              <button class="dropdown-item" onclick={onExportUrlClicked}>
                {$tr("params.saved_labels.save.url")}
              </button>
            </li>
          {/if}
          <li><hr class="dropdown-divider" /></li>
          <li><h6 class="dropdown-header">{$tr("params.saved_labels.export.all")}</h6></li>
          <li>
            <button class="dropdown-item" onclick={onExportAllClicked}>
              {$tr("params.saved_labels.export.json")}
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>

  {#if error}<div class="library-notice alert alert-danger" role="alert">{error}</div>{/if}
  {#if csvEnabled}
    <div class="library-notice text-warning">{$tr("params.saved_labels.save.withcsv")}</div>
  {/if}

  <SavedLabelsBrowser
    {selectedIndex}
    disabled={loading}
    labels={savedLabels}
    onItemClicked={onLabelSelected}
    onItemDelete={onLabelDelete}
    onItemExport={onLabelExport} />

  {#snippet footer()}
    <div class="btn-group btn-group-sm make-default">
      <button class="btn default-button" disabled={loading} onclick={onMakeDefaultClicked}>
        {$tr("params.saved_labels.make_default")}
      </button>
      {#if customDefaultTemplate}
        <button
          class="btn default-button"
          disabled={loading}
          onclick={onRemoveDefaultClicked}
          aria-label={$tr("params.label.delete.cancel")}>
          <MdIcon icon="close" />
        </button>
      {/if}
    </div>

    <button class="btn open-button" onclick={onLoadClicked} disabled={loading || selectedIndex === -1}>
      <MdIcon icon="folder_open" />
      {$tr("storage.open")}
    </button>
  {/snippet}
</AppModal>

<style>
  .library-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 16px;
    padding: 20px 28px;
    flex-shrink: 0;
  }
  .library-summary {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .label-count {
    color: #d8e0ee;
    font-size: 14px;
    font-weight: 500;
  }
  .storage-status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #95a4bb;
    font-size: 12px;
  }
  .storage-status :global(.mdi) {
    color: #8dbaab;
    font-size: 15px;
  }
  .library-tools {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .library-tools .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 36px;
    border-radius: 7px;
    color: #c9d5e8;
    font-size: 13px;
  }
  .library-refresh,
  .library-more {
    width: 36px;
    padding: 0;
    border: 1px solid transparent;
  }
  .library-refresh:hover,
  .library-more:hover {
    background: #303b4e;
    color: #fff;
  }
  .library-import {
    padding: 7px 12px;
    background: transparent;
    border: 1px solid #414b5c;
    font-weight: 500;
    line-height: 20px;
    white-space: nowrap;
  }
  .library-import :global(.mdi) {
    display: flex;
    align-items: center;
    font-size: 18px;
    vertical-align: 0;
  }
  .library-import:hover {
    background: #2c3441;
    border-color: #65738a;
    color: #edf3ff;
  }
  .library-import:focus-visible {
    outline: 2px solid #97bdff;
    outline-offset: 3px;
    box-shadow: none;
  }
  .library-import:active {
    background: #354157;
    border-color: #8093b0;
  }
  .library-tools .dropdown-menu {
    --bs-dropdown-bg: #242b36;
    --bs-dropdown-color: #d8e2f2;
    --bs-dropdown-border-color: #4c586c;
    --bs-dropdown-link-color: #d8e2f2;
    --bs-dropdown-link-hover-bg: #354157;
    --bs-dropdown-link-hover-color: #fff;
    --bs-dropdown-header-color: #9daabd;
    --bs-dropdown-divider-bg: #3a4454;
    font-size: 13px;
  }
  .library-notice {
    margin: 0 28px 16px;
    font-size: 13px;
    flex-shrink: 0;
  }
  .make-default {
    margin-right: auto;
  }
  .default-button {
    color: #9daabd;
    font-size: 12px;
  }
  .default-button:hover {
    color: #d8e2f2;
    background: #2b3545;
  }
  .open-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 18px;
    border: 1px solid #6597f4;
    border-radius: 7px;
    color: #fff;
    background: #4a83ed;
    font-size: 13px;
  }
  .open-button:hover {
    color: #fff;
    background: #6197fa;
  }
  .open-button:disabled {
    opacity: 0.4;
  }
  @media (max-width: 600px) {
    .library-toolbar {
      padding: 16px 16px 20px;
      gap: 12px;
    }
    .library-summary {
      width: 100%;
    }
    .library-tools {
      width: 100%;
      justify-content: flex-end;
    }
    .library-tools .btn {
      min-height: 40px;
    }
    .library-refresh {
      margin-right: auto;
    }
    .library-notice {
      margin-inline: 16px;
    }
    .storage-status {
      flex-wrap: wrap;
    }
  }
</style>
