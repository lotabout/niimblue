<script lang="ts">
  import { tr } from "$/utils/i18n";
  import { onMount } from "svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import SavedLabelsBrowser from "$/components/designer-controls/SavedLabelsBrowser.svelte";
  import { ExportedLabelTemplateSchema, type ExportedLabelTemplate } from "$/types";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { Toasts } from "$/utils/toasts";
  import { FileUtils } from "$/utils/file_utils";
  import * as fabric from "fabric";
  import { Utils } from "@mmote/niimbluelib";
  import { z } from "zod";
  import AppModal from "$/components/basic/AppModal.svelte";

  interface Props {
    onRequestLabelTemplate: () => ExportedLabelTemplate;
    onLoadRequested: (label: ExportedLabelTemplate) => Promise<boolean>;
    onClose?: () => void;
    onDelete: (id: string) => void;
    canvas: fabric.Canvas;
    csvEnabled: boolean;
    hasUnsavedChanges: boolean;
  }

  let { onRequestLabelTemplate, onLoadRequested, canvas, csvEnabled, onClose, onDelete, hasUnsavedChanges }: Props =
    $props();

  let savedLabels = $state<ExportedLabelTemplate[]>([]);
  let selectedIndex = $state<number>(-1);
  let loading = $state(false);
  let usedSpace = $state<number>(0);
  let customDefaultTemplate = $state<boolean>(LocalStoragePersistence.hasCustomDefaultTemplate());
  let isStandalone = Utils.getAvailableTransports().capacitorBle;
  let modalRef: AppModal;

  const calcUsedSpace = () => {
    usedSpace = LocalStoragePersistence.usedSpace();
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

  const onLabelDelete = (idx: number) => {
    try {
      const id = savedLabels[idx].id!;
      LocalStoragePersistence.deleteLabel(id);
      savedLabels = savedLabels.filter((_, index) => index !== idx);
      selectedIndex = -1;
      onDelete(id);
      calcUsedSpace();
    } catch (e) {
      Toasts.error(e);
    }
  };

  const onMakeDefaultClicked = () => {
    try {
      const label = onRequestLabelTemplate();
      label.thumbnailBase64 = undefined;
      LocalStoragePersistence.saveDefaultTemplate(label);
      customDefaultTemplate = true;
      calcUsedSpace();
    } catch (e) {
      Toasts.error(e);
    }
  };

  const onRemoveDefaultClicked = () => {
    try {
      LocalStoragePersistence.saveDefaultTemplate(undefined);
      customDefaultTemplate = false;
      calcUsedSpace();
    } catch (e) {
      Toasts.error(e);
    }
  };

  const onLoadClicked = async () => {
    if (selectedIndex === -1 || loading) return;
    const label = savedLabels[selectedIndex];
    let message = hasUnsavedChanges ? $tr("editor.warning.load") : "";
    if (label.csv) message += "\n" + $tr("editor.warning.load.csv");
    if (message && !confirm(message)) return;
    loading = true;
    try {
      if (await onLoadRequested(label)) modalRef.hide();
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

      const { zodErrors, otherErrors } = LocalStoragePersistence.appendLabels(items);
      zodErrors.forEach((e) => Toasts.zodErrors(e, "Label import error:"));
      otherErrors.forEach((e) => Toasts.error(e));
      if (zodErrors.length !== 0 || otherErrors.length !== 0) return;
      savedLabels = LocalStoragePersistence.loadLabels();
      selectedIndex = -1;
      calcUsedSpace();

      Toasts.message(
        items.length === 1
          ? $tr("params.saved_labels.import.added_one")
          : $tr("params.saved_labels.import.added_many").replace("{count}", String(items.length)),
      );
    } catch (e) {
      if (e instanceof z.ZodError) {
        Toasts.zodErrors(e, "Label import error:");
      } else {
        Toasts.error(e);
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
    savedLabels = LocalStoragePersistence.loadLabels();
    calcUsedSpace();
  });
</script>

<AppModal title={$tr("workspace.library")} {onClose} bind:this={modalRef}>
  <div class="mb-1">
    {usedSpace}
    {$tr("params.saved_labels.kb_used")}

    {#if csvEnabled}
      <div class="pt-1 text-warning">
        {$tr("params.saved_labels.save.withcsv")}
      </div>
    {/if}
  </div>

  <div class="mb-1">
    <button class="btn btn-sm btn-outline-secondary" disabled={loading} onclick={onImportClicked}>
      <MdIcon icon="data_object" />
      {$tr("params.saved_labels.load.json")}
    </button>
    <div class="btn-group btn-group-sm">
      <button
        type="button"
        class="btn btn-outline-secondary dropdown-toggle"
        disabled={loading}
        data-bs-toggle="dropdown"
        aria-expanded="false">
        <MdIcon icon="data_object" />
        {$tr("params.saved_labels.save.json")}
      </button>
      <ul class="dropdown-menu">
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

  <SavedLabelsBrowser
    class="mb-1"
    {selectedIndex}
    labels={savedLabels}
    onItemClicked={onLabelSelected}
    onItemDelete={onLabelDelete}
    onItemExport={onLabelExport} />

  {#snippet footer()}
    <div class="btn-group btn-group-sm make-default">
      <button class="btn text-secondary" onclick={onMakeDefaultClicked}>
        {$tr("params.saved_labels.make_default")}
      </button>
      {#if customDefaultTemplate}
        <button class="btn text-secondary" onclick={onRemoveDefaultClicked}>
          <MdIcon icon="close" />
        </button>
      {/if}
    </div>

    {#if selectedIndex !== -1}
      <button class="btn btn-sm btn-primary" onclick={onLoadClicked} disabled={loading}>
        <MdIcon icon="folder" />
        {$tr("params.saved_labels.load.browser")}
      </button>
    {/if}
  {/snippet}
</AppModal>

<style>
  .make-default {
    margin-right: auto;
  }
</style>
