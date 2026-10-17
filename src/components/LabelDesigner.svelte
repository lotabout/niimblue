<script lang="ts">
  import Dropdown from "bootstrap/js/dist/dropdown";
  import * as fabric from "fabric";
  import { onDestroy, onMount, tick, type Snippet } from "svelte";
  import { ArUcoMarker } from "$/fabric-object/aruco";
  import { LabelBorder } from "$/fabric-object/border";
  import BorderParamsControls from "$/components/designer-controls/BorderParamsControls.svelte";
  import { Barcode } from "$/fabric-object/barcode";
  import { QRCode } from "$/fabric-object/qrcode";
  import { iconCodepoints, type MaterialIcon } from "$/styles/mdi_icons";
  import { appConfig, automation, connectionState, csvData, loadedFonts, printerMeta } from "$/stores/app";
  import {
    ExportedLabelTemplateSchema,
    type ExportedLabelTemplate,
    type FabricJson,
    type LabelProps,
    type MoveDirection,
    type OjectType,
  } from "$/types";
  import { FileUtils } from "$/utils/file_utils";
  import { tr, type TranslationKey } from "$/utils/i18n";
  import { LabelDesignerObjectHelper } from "$/utils/label_designer_object_helper";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { Toasts } from "$/utils/toasts";
  import { UndoRedo, type UndoState } from "$/utils/undo_redo";
  import BarcodeParamsPanel from "$/components/designer-controls/BarcodeParamsControls.svelte";
  import CsvControl from "$/components/dialogs/CsvControl.svelte";
  import GenericObjectParamsControls from "$/components/designer-controls/GenericObjectParamsControls.svelte";
  import IconPicker from "$/components/dialogs/IconPicker.svelte";
  import LabelPropsEditor from "$/components/dialogs/LabelPropsEditor.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import ObjectPicker from "$/components/dialogs/ObjectPicker.svelte";
  import PrintPreview from "$/components/dialogs/PrintPreview.svelte";
  import ArUcoParamsPanel from "$/components/designer-controls/ArUcoParamsControls.svelte";
  import QrCodeParamsPanel from "$/components/designer-controls/QRCodeParamsControls.svelte";
  import TextParamsControls from "$/components/designer-controls/TextParamsControls.svelte";
  import VariableInsertControl from "$/components/designer-controls/VariableInsertControl.svelte";
  import { DEFAULT_LABEL_PROPS, GRID_SIZE, OBJECT_DEFAULTS } from "$/defaults";
  import { LabelDesignerUtils } from "$/utils/label_designer_utils";
  import SavedLabelsMenu from "$/components/dialogs/SavedLabelsMenu.svelte";
  import SaveLabelDialog from "$/components/dialogs/SaveLabelDialog.svelte";
  import StorageSettings from "$/components/dialogs/StorageSettings.svelte";
  import {
    createLabelStorage,
    setStorageConfig,
    storageConfig,
    storageKey,
    StorageError,
    type StorageConfig,
    type StoredLabel,
  } from "$/utils/label_storage";
  import {
    createLabelDocument,
    hasLabelChanges,
    restoreLabelDocument,
    type LabelDocumentState,
  } from "$/utils/label_document";
  import { CustomCanvas } from "$/fabric-object/custom_canvas";
  import VectorParamsControls from "$/components/designer-controls/VectorParamsControls.svelte";
  import { CanvasUtils } from "$/utils/canvas_utils";

  type DialogName =
    | "none"
    | "preview"
    | "label_props"
    | "saved_labels"
    | "save_label"
    | "storage_settings"
    | "csv_props"
    | "icon_picker"
    | "object_picker";

  interface Props {
    brand: Snippet;
    device: Snippet;
    status: Snippet;
    workspaceSettings: Snippet;
  }

  let { brand, device, status, workspaceSettings }: Props = $props();
  let mobilePanel = $state<"tools" | "properties" | null>("tools");
  const toggleMobilePanel = (panel: "tools" | "properties") => {
    mobilePanel = mobilePanel === panel ? null : panel;
  };
  let htmlCanvas: HTMLCanvasElement;
  let currentDialog = $state<DialogName>("none");

  let fabricCanvas = $state<CustomCanvas>();
  let labelProps = $state<LabelProps>(DEFAULT_LABEL_PROPS);
  let selectedObject = $state<fabric.FabricObject | undefined>(undefined);
  let selectedCount = $state<number>(0);
  let editRevision = $state<number>(0);
  let printNow = $state<boolean>(false);
  let csvEnabled = $state<boolean>(false);
  let undoState = $state<UndoState>({ undoDisabled: false, redoDisabled: false });
  let zoomText = $state<string>("100%");
  let hasUnsavedChanges = $state<boolean>(false);
  let documentState = $state<LabelDocumentState>({ title: "", baseline: "" });
  let documentReady = $state(false);
  let loadingDocument = $state(false);
  let contentRevision = $state(0);
  let saveAs = $state(false);
  let savingDocument = $state(false);
  let draftSaveFailed = $state(false);
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let autoFit = $state(false);
  const dpmm = $derived(labelProps.dpmm ?? ($printerMeta?.dpi === 300 ? 11.81 : 8));
  const labelWidth = $derived(Number((labelProps.size.width / dpmm).toFixed(1)));
  const labelHeight = $derived(Number((labelProps.size.height / dpmm).toFixed(1)));
  const textContent = $derived.by(() => {
    void editRevision;
    return selectedObject instanceof fabric.IText ? selectedObject.text : "";
  });
  const saveStatusText = $derived(
    draftSaveFailed
      ? $tr("workspace.draft.failed")
      : !documentState.id
        ? $tr("workspace.never_saved")
        : hasUnsavedChanges
          ? $tr("workspace.unsaved")
          : $tr(
              savingDocument
                ? "storage.saving"
                : $storageConfig.mode === "remote"
                  ? "storage.saved.remote"
                  : "workspace.saved",
            ),
  );
  const insertTools: { type: OjectType; icon: MaterialIcon }[] = [
    { type: "text", icon: "title" },
    { type: "image", icon: "image" },
    { type: "border", icon: "filter_frames" },
    { type: "qrcode", icon: "qr_code_2" },
    { type: "barcode", icon: "view_week" },
  ];

  const fitToWindow = () => {
    autoFit = true;
  };
  const changeZoom = (direction: "in" | "out" | "reset") => {
    autoFit = false;
    if (direction === "reset") fabricCanvas?.resetVirtualZoom();
    else if (direction === "in") fabricCanvas?.virtualZoomIn();
    else fabricCanvas?.virtualZoomOut();
  };

  $effect(() => {
    if (autoFit && fabricCanvas && stageWidth > 0 && stageHeight > 0) {
      const padding = stageWidth < 500 ? 64 : 120;
      fabricCanvas.virtualZoom(
        Math.min((stageWidth - padding) / labelProps.size.width, (stageHeight - 140) / labelProps.size.height, 4),
      );
    }
  });

  const undo = new UndoRedo();

  const discardSelection = () => {
    fabricCanvas!.discardActiveObject();
    fabricCanvas!.requestRenderAll();
    selectedObject = undefined;
    selectedCount = 0;
    editRevision = 0;
  };

  const onCanvasBackgroundPointerDown = (event: PointerEvent) => {
    if (
      !fabricCanvas ||
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      event.target.closest(".canvas-wrapper")
    ) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    discardSelection();
  };

  const snapshotCurrentLabel = (): ExportedLabelTemplate =>
    ExportedLabelTemplateSchema.parse(
      JSON.parse(
        JSON.stringify({
          title: documentState.title,
          label: labelProps,
          canvas: fabricCanvas!.toJSON(),
          csv: csvEnabled ? $csvData : undefined,
        }),
      ),
    );

  const markDocumentChanged = () => {
    if (!loadingDocument) contentRevision++;
  };

  const pushUndo = () => {
    undo.push(fabricCanvas!, labelProps, csvEnabled ? $csvData : undefined);
  };

  const flushDraft = () => {
    clearTimeout(draftTimer);
    if (!documentReady || loadingDocument) return;
    try {
      LocalStoragePersistence.saveLabelDraft({
        version: 1,
        label: snapshotCurrentLabel(),
        document: documentState,
        csvData: $csvData,
      });
      draftSaveFailed = false;
    } catch (error) {
      console.error("Recovery draft save failed:", error);
      if (!draftSaveFailed) Toasts.error($tr("workspace.draft.failed"));
      draftSaveFailed = true;
    }
  };

  const loadLabelData = async (data: ExportedLabelTemplate) => {
    loadingDocument = true;
    undo.paused = true;
    try {
      onUpdateLabelProps(JSON.parse(JSON.stringify(data.label)));
      csvEnabled = !!data.csv;
      $csvData = data.csv ? { ...data.csv } : { data: "" };
      await FileUtils.loadCanvasState(fabricCanvas!, JSON.parse(JSON.stringify(data.canvas)));
      discardSelection();
    } finally {
      undo.paused = false;
      loadingDocument = false;
    }
  };

  undo.onLabelUpdate = async (data) => {
    await loadLabelData(data);
    markDocumentChanged();
  };

  undo.onStateUpdate = (state: UndoState) => {
    undoState = state;
  };

  const deleteSelected = () => {
    LabelDesignerUtils.deleteSelection(fabricCanvas!);
    discardSelection();
  };

  const cloneSelected = () => {
    LabelDesignerUtils.cloneSelection(fabricCanvas!).then(() => pushUndo());
  };

  const moveSelected = (direction: MoveDirection, ctrl?: boolean) => {
    LabelDesignerUtils.moveSelection(fabricCanvas!, direction, ctrl);
    pushUndo();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const key: string = e.key.toLowerCase();
    // windows and linux users are used to ctrl, mac users use cmd
    const cmdOrCtrl = e.metaKey || e.ctrlKey;

    if (cmdOrCtrl && key === "s") {
      e.preventDefault();
      if (!e.repeat) requestSave(e.shiftKey);
      return;
    }
    if (!documentReady || loadingDocument || currentDialog !== "none") return;

    // Esc
    if (key === "escape") {
      if (mobilePanel && window.matchMedia("(max-width: 850px)").matches) {
        mobilePanel = null;
        return;
      }
      discardSelection();
      return;
    }

    if (LabelDesignerUtils.isAnyInputFocused(fabricCanvas!)) {
      return;
    }

    // Arrows
    if (key.startsWith("arrow")) {
      moveSelected(key.slice("arrow".length) as MoveDirection, cmdOrCtrl);
      return;
    }

    if (e.repeat) {
      return;
    }

    // Ctrl + D
    if (cmdOrCtrl && key === "d") {
      e.preventDefault();
      cloneSelected();
      return;
    }

    // Ctrl + Y, Ctrl + Shift + Z
    if ((cmdOrCtrl && key === "y") || (cmdOrCtrl && e.shiftKey && key === "z")) {
      e.preventDefault();
      if (!undoState.redoDisabled) {
        undo.redo();
      }
      return;
    }

    // Ctrl + Z
    if (cmdOrCtrl && key === "z") {
      e.preventDefault();
      if (!undoState.undoDisabled) {
        undo.undo();
      }
      return;
    }

    // Del
    if (key === "delete" || key === "backspace") {
      deleteSelected();
      return;
    }
  };

  const onUpdateLabelProps = (newProps: LabelProps) => {
    labelProps = newProps;
    markDocumentChanged();
    fabricCanvas!.setDimensions(labelProps.size);
    fabricCanvas!.virtualZoom(fabricCanvas!.getVirtualZoom());
    try {
      LocalStoragePersistence.saveLastLabelProps(labelProps);
      pushUndo();
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters save error:");
    }
  };

  const exportCurrentLabel = (): ExportedLabelTemplate => ({
    ...FileUtils.makeExportedLabel(fabricCanvas!, labelProps, csvEnabled),
    title: documentState.title,
  });

  const onLoadRequested = async (label: StoredLabel): Promise<boolean> => {
    if (loadingDocument || savingDocument) return false;
    const previous = documentReady ? snapshotCurrentLabel() : undefined;
    try {
      await loadLabelData(label);
      const normalized = { ...snapshotCurrentLabel(), title: label.title ?? "" };
      documentState = {
        ...createLabelDocument(normalized, label.id),
        storageKey: storageKey(),
        storageRevision: label.storageRevision,
      };
      undo.reset();
      pushUndo();
      hasUnsavedChanges = false;
      markDocumentChanged();
      return true;
    } catch (e) {
      Toasts.error(e);
      if (previous) {
        try {
          await loadLabelData(previous);
        } catch (restoreError) {
          Toasts.error(restoreError);
        }
      }
      return false;
    }
  };

  const storageFailure = (error: unknown) => {
    Toasts.error(error instanceof StorageError ? $tr(`storage.error.${error.code}`) : error);
  };

  const saveCurrentLabel = async (title: string, asCopy: boolean): Promise<boolean> => {
    if (savingDocument || loadingDocument) return false;
    savingDocument = true;
    try {
      const label = { ...exportCurrentLabel(), title };
      const scope = storageKey();
      const sameStorage = (documentState.storageKey ?? "local") === scope;
      const id = asCopy || !sameStorage ? undefined : documentState.id;
      const saved = await createLabelStorage().save(label, id, id ? documentState.storageRevision : undefined);
      documentState = {
        ...createLabelDocument(saved, saved.id),
        storageKey: scope,
        storageRevision: saved.storageRevision,
      };
      pushUndo();
      hasUnsavedChanges = hasLabelChanges(snapshotCurrentLabel(), documentState.baseline);
      flushDraft();
      Toasts.message($tr("workspace.save.success"));
      return true;
    } catch (e) {
      storageFailure(e);
      return false;
    } finally {
      savingDocument = false;
    }
  };

  const requestSave = (asCopy = false) => {
    if (!documentReady || loadingDocument || savingDocument || currentDialog !== "none") return;
    if (asCopy || !documentState.id || !documentState.title.trim()) {
      saveAs = asCopy;
      currentDialog = "save_label";
    } else {
      void saveCurrentLabel(documentState.title, false);
    }
  };

  const applyStorage = (config: StorageConfig) => {
    const previousKey = storageKey();
    setStorageConfig(config);
    if (previousKey !== storageKey() && documentReady) {
      documentState = { title: documentState.title, baseline: "", storageKey: storageKey() };
      markDocumentChanged();
      flushDraft();
    }
  };

  const onLabelDeleted = (id: string) => {
    if (id !== documentState.id) return;
    documentState = { title: documentState.title, baseline: "" };
    markDocumentChanged();
    flushDraft();
  };

  const newDocument = async () => {
    if (!documentReady || loadingDocument || savingDocument) return;
    if (hasUnsavedChanges && !confirm($tr("workspace.new.confirm"))) return;
    try {
      const template = LocalStoragePersistence.loadDefaultTemplate();
      const label: ExportedLabelTemplate = template
        ? { ...template, id: undefined }
        : { label: DEFAULT_LABEL_PROPS, canvas: { version: fabric.version, objects: [] } };
      if (await onLoadRequested(label)) flushDraft();
    } catch (e) {
      Toasts.error(e);
    }
  };

  const zplImageReady = async (img: Blob) => {
    await LabelDesignerObjectHelper.addImageBlob(fabricCanvas!, img);
    pushUndo();
  };

  const pdfImageReady = async (el: HTMLCanvasElement) => {
    const img = new fabric.FabricImage(el, {
      ...OBJECT_DEFAULTS,
      left: 0,
      top: 0,
    });

    fabricCanvas!.add(img);
    fabricCanvas!.setActiveObject(img);
    pushUndo();
  };

  const onObjectPicked = async (objectType: OjectType) => {
    let obj: fabric.FabricObject | undefined;
    try {
      obj =
        objectType === "image"
          ? await LabelDesignerObjectHelper.addImageWithFilePicker(fabricCanvas!)
          : LabelDesignerObjectHelper.addObject(fabricCanvas!, objectType);
    } catch {
      return; // The image picker reports import errors.
    }
    if (obj !== undefined) {
      fabricCanvas!.setActiveObject(obj);
      mobilePanel = "properties";
      pushUndo();
    }
  };

  const onIconPicked = (i: MaterialIcon) => {
    // todo: icon is not vertically centered
    LabelDesignerObjectHelper.addStaticText(fabricCanvas!, String.fromCodePoint(iconCodepoints[i]), {
      fontFamily: "Material Icons",
      fontSize: 100,
    });
    pushUndo();
  };

  const onSvgIconPicked = (i: string) => {
    LabelDesignerObjectHelper.addSvg(fabricCanvas!, i);
    pushUndo();
  };

  const openPreview = () => {
    printNow = false;
    currentDialog = "preview";
  };

  const openPreviewAndPrint = () => {
    printNow = true;
    currentDialog = "preview";
  };

  const controlValueUpdated = () => {
    markDocumentChanged();
    if (selectedObject) {
      selectedObject.setCoords();
      selectedObject.dirty = true;
      pushUndo();
    }
    fabricCanvas!.requestRenderAll();

    // trigger reactivity for controls
    editRevision++;
  };

  const getCanvasForPreview = (): FabricJson => {
    return fabricCanvas!.toJSON();
  };

  const onCsvPlaceholderPicked = (name: string) => {
    const obj = LabelDesignerObjectHelper.addText(fabricCanvas!, `{${name}}`, {
      textAlign: "left",
      originX: "left",
      originY: "top",
    });
    fabricCanvas!.setActiveObject(obj);
    pushUndo();
  };

  const onPaste = async (event: ClipboardEvent) => {
    if (LabelDesignerUtils.isAnyInputFocused(fabricCanvas!)) {
      return;
    }

    const openedDropdowns = document.querySelectorAll(".dropdown-menu.show");
    if (openedDropdowns.length > 0) {
      return;
    }

    if (event.clipboardData != null) {
      event.preventDefault();
      const obj = await LabelDesignerObjectHelper.addObjectFromClipboard(fabricCanvas!, event.clipboardData);

      if (obj !== undefined) {
        fabricCanvas!.setActiveObject(obj);
        pushUndo();
      }
    }
  };

  const clearCanvas = () => {
    if (!confirm($tr("editor.clear.confirm"))) {
      return;
    }
    pushUndo();
    fabricCanvas!.clear();
  };

  const toggleGrid = () => {
    const newVal = !$appConfig.gridEnabled;
    appConfig.update((cfg) => ({ ...cfg, gridEnabled: newVal }));
    fabricCanvas?.setGridEnabled(newVal);
  };

  const loadLabelFromUrl = async () => {
    try {
      const urlTemplate = await FileUtils.readLabelFromUrl();

      if (urlTemplate !== null && confirm($tr("params.saved_labels.load.url.warn"))) {
        if (documentReady && hasUnsavedChanges && !confirm($tr("editor.warning.load"))) return false;
        if (await onLoadRequested({ ...urlTemplate, id: undefined })) {
          Toasts.message($tr("params.saved_labels.load.url.loaded"));
          return true;
        }
      }
    } catch (e) {
      Toasts.error(e);
    }
    return false;
  };

  const loadDefaultLabel = async () => {
    const urlLoaded = await loadLabelFromUrl();

    if (urlLoaded) {
      return;
    }

    try {
      const draft = LocalStoragePersistence.loadLabelDraft();
      if (draft) {
        await loadLabelData(draft.label);
        if (draft.csvData) $csvData = draft.csvData;
        let original: ExportedLabelTemplate | null = null;
        try {
          if ($storageConfig.mode === "local" && (draft.document.storageKey ?? "local") === "local") {
            original = draft.document.id ? LocalStoragePersistence.loadLabel(draft.document.id) : null;
          }
        } catch (e) {
          // The working copy is still recoverable even if the original is damaged.
          Toasts.error(e);
        }
        documentState = restoreLabelDocument(draft, original, storageKey());
        hasUnsavedChanges = hasLabelChanges(snapshotCurrentLabel(), documentState.baseline);
        if (hasUnsavedChanges || !documentState.id) Toasts.message($tr("workspace.draft.restored"));
        return;
      }
    } catch (e) {
      Toasts.error(e);
    }

    try {
      const defaultTemplate = LocalStoragePersistence.loadDefaultTemplate();

      if (defaultTemplate !== null) {
        if (await onLoadRequested({ ...defaultTemplate, id: undefined })) return;
      }
    } catch (e) {
      Toasts.error(e);
    }

    LabelDesignerObjectHelper.addText(fabricCanvas!, $tr("editor.default_text"));
    documentState = { ...createLabelDocument(snapshotCurrentLabel()), storageKey: storageKey() };
  };

  const renderOnFontsChanged = () => {
    fabricCanvas?.forEachObject((o) => {
      if (o instanceof fabric.Textbox) {
        o.initDimensions();
        o.setCoords();
        o.dirty = true;
      }
    });
    fabricCanvas?.requestRenderAll();
  };

  onMount(async () => {
    try {
      const savedLabelProps = LocalStoragePersistence.loadLastLabelProps();
      if (savedLabelProps !== null) {
        labelProps = savedLabelProps;
      }
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters load error:");
    }

    fabricCanvas = new CustomCanvas(htmlCanvas, {
      width: labelProps.size.width,
      height: labelProps.size.height,
    });
    fabricCanvas.setLabelProps(labelProps);
    fabricCanvas.onZoomChange = (z) => {
      zoomText = Math.round(z * 100) + "%";
    };
    fabricCanvas.setGridEnabled(!!$appConfig.gridEnabled);

    await loadDefaultLabel();

    window.addEventListener("hashchange", loadLabelFromUrl);
    window.addEventListener("beforeunload", warnBeforeUnload);
    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", flushHiddenDraft);

    pushUndo();
    documentReady = true;

    // force close dropdowns on touch devices
    fabricCanvas.on("mouse:down", (): void => {
      const dropdowns = document.querySelectorAll("[data-bs-toggle='dropdown']");
      dropdowns.forEach((el) => new Dropdown(el).hide());
    });

    fabricCanvas.on("object:moving", (e): void => {
      if (e.target && e.target.left !== undefined && e.target.top !== undefined) {
        e.target.set({
          left: Math.round(e.target.left / GRID_SIZE) * GRID_SIZE,
          top: Math.round(e.target.top / GRID_SIZE) * GRID_SIZE,
        });
      }
    });

    fabricCanvas.on("object:modified", (): void => {
      markDocumentChanged();
      editRevision++;
      pushUndo();
    });

    fabricCanvas.on("object:resizing", (): void => {
      editRevision++;
    });

    fabricCanvas.on("object:added", (): void => {
      markDocumentChanged();
    });

    fabricCanvas.on("text:changed", () => {
      markDocumentChanged();
      editRevision++;
    });

    fabricCanvas.on("text:editing:exited", pushUndo);

    fabricCanvas.on("object:removed", (): void => {
      markDocumentChanged();
      pushUndo();
    });

    fabricCanvas.on("selection:created", (e): void => {
      selectedCount = e.selected?.length ?? 0;
      selectedObject = e.selected?.length === 1 ? e.selected[0] : undefined;
      editRevision++;
    });

    fabricCanvas.on("selection:updated", (e): void => {
      selectedCount = e.selected?.length ?? 0;
      selectedObject = e.selected?.length === 1 ? e.selected[0] : undefined;
      editRevision++;
    });

    fabricCanvas.on("selection:cleared", (): void => {
      selectedObject = undefined;
      selectedCount = 0;
      editRevision++;
    });

    fabricCanvas.on("dragover", (e): void => {
      e.e.preventDefault();
    });

    fabricCanvas.on("drop:after", async (e): Promise<void> => {
      const dragEvt = e.e as DragEvent;
      dragEvt.preventDefault();

      let dropped = false;

      if (dragEvt.dataTransfer?.files) {
        for (const file of dragEvt.dataTransfer.files) {
          try {
            await LabelDesignerObjectHelper.addImageFile(fabricCanvas!, file);
            dropped = true;
          } catch (e) {
            Toasts.error(e);
          }
        }

        if (dropped) {
          pushUndo();
        }
      }
    });

    fabricCanvas.on("object:scaling", (e): void => {
      if (!e.target) {
        return;
      }

      CanvasUtils.fixFabricObjectScale(e.target);
    });

    if ($automation !== undefined) {
      if ($automation.startPrint !== undefined) {
        if ($automation.startPrint === "immediately") {
          openPreview();
        } else if ($automation.startPrint === "after_connect") {
          const unsubscribe = connectionState.subscribe((st) => {
            if (st === "connected") {
              tick().then(() => unsubscribe());
              openPreviewAndPrint();
            }
          });
        }
      }
    }
  });

  const flushHiddenDraft = () => {
    if (document.visibilityState === "hidden") flushDraft();
  };

  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    flushDraft();
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  };

  onDestroy(() => {
    flushDraft();
    clearTimeout(draftTimer);
    fabricCanvas?.dispose();
    window.removeEventListener("hashchange", loadLabelFromUrl);
    window.removeEventListener("beforeunload", warnBeforeUnload);
    window.removeEventListener("pagehide", flushDraft);
    document.removeEventListener("visibilitychange", flushHiddenDraft);
  });

  $effect(() => {
    void contentRevision;
    void csvEnabled;
    void $csvData;
    void documentState;
    if (!documentReady || loadingDocument) return;
    hasUnsavedChanges = hasLabelChanges(snapshotCurrentLabel(), documentState.baseline);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 400);
  });

  $effect(() => {
    fabricCanvas?.setLabelProps(labelProps);
  });

  $effect(() => {
    if (currentDialog !== "preview") {
      printNow = false;
    }
  });

  $effect(() => {
    if ($loadedFonts) {
      renderOnFontsChanged();
    }
  });
</script>

<svelte:window onkeydown={onKeyDown} onpaste={onPaste} />

<div class="image-editor">
  <div class="document-bar">
    <div class="document-info">
      {@render brand()}
      <span class="document-name" title={documentState.title || $tr("workspace.document.untitled")}>
        {documentState.title || $tr("workspace.document.untitled")}
      </span>
      <span
        class="save-status"
        class:has-changes={hasUnsavedChanges || !documentState.id}
        class:text-danger={draftSaveFailed}
        title={saveStatusText}
        aria-label={saveStatusText}
        role="status">
        <span></span>
        <span class="save-status-label">{saveStatusText}</span>
      </span>
    </div>
    <div class="document-actions">
      <button
        class="btn studio-quiet library-button"
        aria-label={$tr("workspace.library")}
        title={$tr("workspace.library")}
        disabled={savingDocument || loadingDocument}
        onclick={() => (currentDialog = "saved_labels")}>
        <MdIcon icon="folder_open" />
        <span class="document-action-label">{$tr("workspace.library")}</span>
      </button>
      <div class="btn-group document-save">
        <button
          class="btn studio-secondary"
          aria-label={$tr("workspace.save")}
          title={$tr("workspace.save")}
          onclick={() => requestSave()}
          disabled={!documentReady || loadingDocument || savingDocument}>
          <MdIcon icon="save" />
          <span class="document-action-label">{$tr("workspace.save")}</span>
        </button>
        <button
          class="btn studio-secondary dropdown-toggle dropdown-toggle-split"
          data-bs-toggle="dropdown"
          aria-expanded="false"
          aria-label={$tr("workspace.document.actions")}
          disabled={!documentReady || loadingDocument || savingDocument}></button>
        <ul class="dropdown-menu">
          <li><button class="dropdown-item" onclick={() => requestSave(true)}>{$tr("workspace.save_as")}</button></li>
          <li><button class="dropdown-item" onclick={newDocument}>{$tr("workspace.new")}</button></li>
        </ul>
      </div>
      <span class="action-divider"></span>
      <button
        class="btn studio-secondary"
        onclick={openPreview}
        aria-label={$tr("editor.preview")}
        title={$tr("editor.preview")}>
        <MdIcon icon="visibility" />
        <span class="document-action-label">{$tr("editor.preview")}</span>
      </button>
      <button
        class="btn studio-primary"
        aria-label={$tr("editor.print")}
        onclick={$connectionState === "connected" ? openPreviewAndPrint : openPreview}
        title={$connectionState === "connected" ? $tr("workspace.quickprint") : $tr("workspace.preview.connect")}>
        <MdIcon icon="print" />
        <span class="document-action-label">{$tr("editor.print")}</span>
      </button>
    </div>
    <div class="device-controls">{@render device()}</div>
  </div>

  <div
    class="workspace-layout"
    class:show-tools={mobilePanel === "tools"}
    class:show-properties={mobilePanel === "properties"}>
    <nav id="workspace-tools" class="insert-rail" aria-label={$tr("workspace.insert")}>
      <div class="rail-heading">{$tr("workspace.insert")}</div>
      {#each insertTools as tool (tool.type)}
        <button
          class="insert-tool"
          onclick={() => onObjectPicked(tool.type)}
          title={$tr(`editor.objectpicker.${tool.type}` as TranslationKey)}>
          <MdIcon icon={tool.icon} />
          <span>{$tr(`editor.objectpicker.${tool.type}` as TranslationKey)}</span>
        </button>
      {/each}
      <button class="insert-tool" onclick={() => (currentDialog = "icon_picker")}>
        <MdIcon icon="emoji_emotions" /> <span>{$tr("editor.iconpicker.title")}</span>
      </button>
      <button class="insert-tool" onclick={() => (currentDialog = "object_picker")}>
        <MdIcon icon="category" /> <span>{$tr("workspace.more")}</span>
      </button>
      <div class="rail-divider"></div>
      <button
        class="insert-tool"
        class:active={csvEnabled}
        onclick={() => (currentDialog = "csv_props")}
        title={$tr("params.csv.title")}>
        <MdIcon icon="dataset" /> <span>CSV</span>
      </button>
    </nav>

    <section class="canvas-panel" aria-label={$tr("workspace.subtitle")}>
      <div class="canvas-toolbar">
        <button class="size-button" onclick={() => (currentDialog = "label_props")} title={$tr("workspace.size.edit")}>
          <MdIcon icon="crop_free" /> <span>{labelWidth} × {labelHeight} <small>mm</small></span>
          <MdIcon icon="expand_more" />
        </button>
        <div class="canvas-actions">
          <button
            class="btn studio-quiet"
            disabled={undoState.undoDisabled}
            onclick={() => undo.undo()}
            title={$tr("editor.undo")}
            aria-label={$tr("editor.undo")}><MdIcon icon="undo" /></button>
          <button
            class="btn studio-quiet"
            disabled={undoState.redoDisabled}
            onclick={() => undo.redo()}
            title={$tr("editor.redo")}
            aria-label={$tr("editor.redo")}><MdIcon icon="redo" /></button>
          <span class="action-divider"></span>
          <button
            class="btn studio-quiet"
            class:active={$appConfig.gridEnabled}
            onclick={toggleGrid}
            title={$tr("editor.grid")}
            aria-label={$tr("editor.grid")}
            aria-pressed={!!$appConfig.gridEnabled}><MdIcon icon="grid_on" /></button>
          <div class="dropdown">
            <button
              class="btn studio-quiet"
              data-bs-toggle="dropdown"
              aria-expanded="false"
              title={$tr("workspace.more")}
              aria-label={$tr("workspace.more")}><MdIcon icon="more_horiz" /></button>
            <div class="dropdown-menu dropdown-menu-end">
              <button class="dropdown-item" onclick={clearCanvas}
                ><MdIcon icon="cancel_presentation" /> {$tr("editor.clear")}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="canvas-viewport" bind:clientWidth={stageWidth} bind:clientHeight={stageHeight}>
        <div class="canvas-scroll" onpointerdown={onCanvasBackgroundPointerDown} role="presentation">
          <div class="label-on-stage">
            <div class="feed-caption">
              <MdIcon icon={labelProps.printDirection === "left" ? "west" : "north"} />
              {$tr("workspace.feed")}
            </div>
            <div
              class="canvas-wrapper"
              onwheel={(event) => {
                if (event.ctrlKey) autoFit = false;
              }}
              ontouchstart={(event) => {
                if (event.touches.length > 1) autoFit = false;
              }}
              role="presentation">
              <canvas bind:this={htmlCanvas}></canvas>
            </div>
            <div class="dimension-caption">{labelWidth} × {labelHeight} mm</div>
          </div>
        </div>
      </div>
    </section>

    <div class="dock-tabs" role="group" aria-label={$tr("workspace.panels")}>
      <button
        class:active={mobilePanel === "tools"}
        onclick={() => toggleMobilePanel("tools")}
        aria-controls="workspace-tools"
        aria-expanded={mobilePanel === "tools"}>
        <MdIcon icon="add_circle_outline" />
        {$tr("workspace.tools")}
        <MdIcon icon={mobilePanel === "tools" ? "expand_less" : "expand_more"} />
      </button>
      <button
        class:active={mobilePanel === "properties"}
        onclick={() => toggleMobilePanel("properties")}
        aria-controls="workspace-inspector"
        aria-expanded={mobilePanel === "properties"}>
        <MdIcon icon="tune" />
        {$tr("workspace.properties")}
        <MdIcon icon={mobilePanel === "properties" ? "expand_less" : "expand_more"} />
      </button>
    </div>

    <aside id="workspace-inspector" class="inspector" aria-label={$tr("workspace.properties")}>
      <div class="inspector-heading">
        <h3>{selectedCount ? $tr("workspace.properties") : $tr("workspace.label")}</h3>
        <span class="inspector-badge">{selectedCount ? selectedCount : "mm"}</span>
      </div>
      <div class="inspector-content">
        {#if selectedCount === 0}
          <div class="inspector-section">
            <span class="field-caption">{$tr("workspace.size")}</span>
            <div class="size-value">{labelWidth} <span>×</span> {labelHeight}<small>mm</small></div>
            <button class="btn studio-secondary w-100" onclick={() => (currentDialog = "label_props")}
              ><MdIcon icon="tune" /> {$tr("workspace.size.edit")}</button>
            <div class="label-facts">
              <span>{$tr("params.label.shape")}</span><strong
                >{$tr(`workspace.paper.${labelProps.shape ?? "rect"}`)}</strong>
              <span>{$tr("params.label.direction")}</span><strong
                >{$tr(
                  labelProps.printDirection === "left" ? "params.label.direction.left" : "params.label.direction.top",
                )}</strong>
              <span>{$tr("params.label.head_density")}</span><strong>{Math.round(dpmm * 25.4)} dpi</strong>
            </div>
          </div>
          <div class="inspector-empty">
            <div class="empty-illustration"><MdIcon icon="touch_app" /></div>
            <h4>{$tr("workspace.select.title")}</h4>
            <p>{$tr("workspace.select.hint")}</p>
            <button class="btn studio-quiet" onclick={() => onObjectPicked("text")}
              ><MdIcon icon="add" /> {$tr("editor.objectpicker.text")}</button>
          </div>
        {:else}
          {#if selectedObject && selectedCount === 1}
            <div class="inspector-section">
              <span class="field-caption">{$tr("workspace.position")}</span>
              <div class="property-controls">
                <GenericObjectParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
              </div>
            </div>
          {/if}
          {#if selectedObject instanceof fabric.IText}
            <div class="inspector-section">
              <label class="field-caption" for="label-text-content">{$tr("workspace.text.content")}</label>
              <textarea
                id="label-text-content"
                class="form-control text-content"
                rows="3"
                value={textContent}
                oninput={(event) => {
                  if (selectedObject instanceof fabric.IText) {
                    selectedObject.set({ text: event.currentTarget.value });
                    controlValueUpdated();
                  }
                }}></textarea>
            </div>
          {/if}
          <div class="inspector-section">
            <span class="field-caption">{$tr("workspace.appearance")}</span>
            <div class="property-controls">
              {#if selectedObject instanceof LabelBorder}
                <BorderParamsControls
                  selectedBorder={selectedObject}
                  {editRevision}
                  valueUpdated={controlValueUpdated} />
              {/if}
              {#if selectedObject instanceof fabric.IText}
                <TextParamsControls selectedText={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
              {/if}
              {#if selectedObject instanceof QRCode}
                <QrCodeParamsPanel selectedQRCode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
              {/if}
              {#if selectedObject instanceof ArUcoMarker}
                <ArUcoParamsPanel selectedArUco={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
              {/if}
              {#if selectedObject instanceof Barcode}
                <BarcodeParamsPanel
                  selectedBarcode={selectedObject}
                  {editRevision}
                  valueUpdated={controlValueUpdated} />
              {/if}
              {#if selectedObject}
                <VectorParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
              {/if}
              {#if selectedObject instanceof fabric.IText || selectedObject instanceof QRCode || (selectedObject instanceof Barcode && selectedObject.encoding === "CODE128B")}
                <VariableInsertControl {selectedObject} valueUpdated={controlValueUpdated} />
              {/if}
            </div>
          </div>
          <div class="selection-actions">
            <button class="btn studio-secondary" onclick={cloneSelected}
              ><MdIcon icon="content_copy" /> {$tr("editor.clone")}</button>
            <button class="btn studio-danger" onclick={deleteSelected}
              ><MdIcon icon="delete_outline" /> {$tr("editor.delete")}</button>
          </div>
        {/if}
      </div>
      <div class="storage-note">
        <MdIcon icon="info" /><span
          >{$tr($storageConfig.mode === "remote" ? "storage.save.hint" : "workspace.storage")}</span>
      </div>
    </aside>
  </div>

  <footer class="workspace-statusbar">
    <div class="workspace-status">{@render status()}</div>
    <span class="canvas-hint">{$tr("workspace.canvas.hint")}</span>
    <div class="workspace-zoom">
      <div class="zoom-controls">
        <button
          class="btn studio-quiet"
          onclick={() => changeZoom("out")}
          title={$tr("workspace.zoom.out")}
          aria-label={$tr("workspace.zoom.out")}><MdIcon icon="remove" /></button>
        <button
          class="btn studio-quiet zoom-value"
          onclick={() => changeZoom("reset")}
          title={$tr("workspace.zoom.reset")}>{zoomText}</button>
        <button
          class="btn studio-quiet"
          onclick={() => changeZoom("in")}
          title={$tr("workspace.zoom.in")}
          aria-label={$tr("workspace.zoom.in")}><MdIcon icon="add" /></button>
        <button
          class="btn studio-quiet fit-button"
          class:active={autoFit}
          onclick={fitToWindow}
          title={$tr("workspace.fit")}
          aria-label={$tr("workspace.fit")}><MdIcon icon="fit_screen" /></button>
      </div>
    </div>
    <div class="workspace-settings">
      <button
        class="btn btn-sm text-secondary"
        disabled={savingDocument || loadingDocument}
        onclick={() => (currentDialog = "storage_settings")}
        title={$tr("storage.title")}>
        <MdIcon icon="storage" />
        {$tr("storage.title")}
      </button>
      {@render workspaceSettings()}
    </div>
  </footer>

  {#if currentDialog === "preview"}
    <PrintPreview
      onClose={() => (currentDialog = "none")}
      canvasCallback={getCanvasForPreview}
      {labelProps}
      {printNow}
      {csvEnabled}
      csvData={$csvData.data} />
  {:else if currentDialog === "label_props"}
    <LabelPropsEditor onClose={() => (currentDialog = "none")} onChange={onUpdateLabelProps} {labelProps} />
  {:else if currentDialog === "saved_labels"}
    <SavedLabelsMenu
      onClose={() => (currentDialog = "none")}
      onDelete={onLabelDeleted}
      canvas={fabricCanvas!}
      onRequestLabelTemplate={exportCurrentLabel}
      {onLoadRequested}
      {csvEnabled}
      {hasUnsavedChanges} />
  {:else if currentDialog === "storage_settings"}
    <StorageSettings onApply={applyStorage} onClose={() => (currentDialog = "none")} />
  {:else if currentDialog === "save_label"}
    <SaveLabelDialog
      initialTitle={documentState.title}
      {saveAs}
      onSave={(title) => saveCurrentLabel(title, saveAs)}
      onClose={() => (currentDialog = "none")} />
  {:else if currentDialog === "csv_props"}
    <CsvControl
      onClose={() => (currentDialog = "none")}
      bind:enabled={csvEnabled}
      onChange={pushUndo}
      onPlaceholderPicked={onCsvPlaceholderPicked} />
  {:else if currentDialog === "icon_picker"}
    <IconPicker onSubmit={onIconPicked} onSubmitSvg={onSvgIconPicked} onClose={() => (currentDialog = "none")} />
  {:else if currentDialog === "object_picker"}
    <ObjectPicker
      onSubmit={onObjectPicked}
      onClose={() => (currentDialog = "none")}
      {labelProps}
      {zplImageReady}
      {pdfImageReady} />
  {/if}
</div>

<style>
  .image-editor {
    --studio-border: #30343e;
    --studio-muted: #9aa3b4;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: 54px minmax(0, 1fr) 32px;
    overflow: hidden;
  }
  .document-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 18px;
    padding: 0 16px;
    border-bottom: 1px solid var(--studio-border);
    background: #20232a;
    z-index: 30;
  }
  .document-info {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .document-name {
    min-width: 0;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #c3cddd;
    font-size: 12px;
  }
  .save-status {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--studio-muted);
    font-size: 10px;
    white-space: nowrap;
  }
  .save-status > span:first-child {
    width: 5px;
    height: 5px;
    background: #8896ac;
    border-radius: 50%;
  }
  .save-status.has-changes > span:first-child {
    background: #e2bb77;
  }
  .document-actions,
  .canvas-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .device-controls {
    padding-left: 18px;
    border-left: 1px solid var(--studio-border);
  }
  .image-editor :global(.btn) {
    border-radius: 5px;
    font-size: 12px;
  }
  .document-actions > .btn,
  .document-save > .btn {
    padding: 6px 11px;
    white-space: nowrap;
  }
  .studio-quiet {
    color: #adb6c7;
    background: transparent;
    border: 1px solid transparent;
  }
  .studio-quiet:hover {
    color: #e0e9fa;
    background: #303642;
  }
  .studio-quiet.active {
    color: #a1c4ff;
    background: #2a3b56;
  }
  .studio-secondary {
    color: #c9d2e1;
    background: #262b35;
    border: 1px solid #3b4351;
  }
  .studio-secondary:hover {
    color: #fff;
    background: #333c4b;
    border-color: #55657c;
  }
  .studio-primary {
    color: #fff;
    background: #4a83ed;
    border: 1px solid #6597f4;
  }
  .studio-primary:hover {
    color: #fff;
    background: #6197fa;
  }
  .studio-danger {
    color: #e0a3a7;
    border: 1px solid #613d46;
    background: #3a282f;
  }
  .action-divider {
    height: 18px;
    width: 1px;
    background: var(--studio-border);
    margin: 0 3px;
    flex-shrink: 0;
  }
  .workspace-layout {
    position: relative;
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr) 282px;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background: #1e2128;
  }
  .dock-tabs {
    display: none;
  }
  .insert-rail {
    min-height: 0;
    padding: 14px 8px;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-right: 1px solid var(--studio-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rail-heading {
    font-size: 10px;
    text-align: center;
    color: #8f99ab;
    margin: 0 0 8px;
  }
  .insert-tool {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 5px;
    padding: 9px 2px;
    flex-shrink: 0;
    border: 1px solid transparent;
    border-radius: 7px;
    color: #b4bfd1;
    background: transparent;
    font-size: 10px;
    line-height: 1.3;
  }
  .insert-tool :global(.mdi) {
    font-size: 23px;
  }
  .insert-tool:hover,
  .insert-tool.active {
    color: #bdd5ff;
    background: #2b3a53;
    border-color: #405575;
  }
  .insert-tool:focus-visible,
  .size-button:focus-visible {
    outline: 2px solid #8eb8ff;
    outline-offset: 2px;
  }
  .rail-divider {
    height: 1px;
    background: var(--studio-border);
    margin: 5px 8px;
    flex-shrink: 0;
  }
  .canvas-panel {
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: #191c22;
  }
  .canvas-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 46px;
    flex: 0 0 46px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--studio-border);
    background: #22262e;
  }
  .size-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 5px;
    border: 1px solid #3a414e;
    color: #d3dceb;
    background: #292f39;
    font-size: 11px;
    white-space: nowrap;
  }
  .size-button small {
    color: #97a3b7;
    font-size: 10px;
  }
  .canvas-actions {
    gap: 2px;
  }
  .canvas-actions .btn {
    padding: 4px 7px;
  }
  .canvas-viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    background-image: radial-gradient(#41495888 0.8px, transparent 0.8px);
    background-size: 18px 18px;
  }
  .canvas-scroll {
    position: absolute;
    inset: 0;
    display: flex;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 60px 30px;
  }
  .label-on-stage {
    flex-shrink: 0;
    width: fit-content;
    margin: auto;
    position: relative;
  }
  .canvas-wrapper {
    background: #95989d;
    width: fit-content;
    box-shadow:
      0 12px 34px #0005,
      0 1px 3px #0004;
    outline: 1px solid #fff3;
  }
  .canvas-wrapper :global(canvas) {
    display: block;
  }
  .feed-caption {
    position: absolute;
    left: 0;
    top: -32px;
    color: #9ba6b8;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    white-space: nowrap;
  }
  .feed-caption :global(.mdi) {
    color: #90b3ed;
  }
  .dimension-caption {
    position: absolute;
    bottom: -32px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    letter-spacing: 1px;
    color: #95a0b4;
    white-space: nowrap;
  }
  .workspace-statusbar {
    display: flex;
    align-items: center;
    gap: 20px;
    min-width: 0;
    padding: 0 12px;
    border-top: 1px solid var(--studio-border);
    background: #20232a;
    color: #98a4b9;
    font-size: 10px;
  }
  .workspace-status {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
  }
  .canvas-hint {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    color: #98a2b6;
  }
  .workspace-zoom {
    margin-left: auto;
    flex-shrink: 0;
  }
  .workspace-settings {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }
  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .zoom-controls .btn {
    padding: 2px 5px;
    font-size: 10px;
  }
  .zoom-controls .zoom-value {
    min-width: 44px;
  }
  .fit-button {
    margin-left: 5px;
  }
  .inspector {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    border-left: 1px solid var(--studio-border);
    background: #20232b;
  }
  .inspector-heading {
    height: 46px;
    flex: 0 0 46px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--studio-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .inspector-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
  h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 650;
  }
  .inspector-badge {
    font-size: 10px;
    color: #9ca9bd;
    padding: 2px 6px;
    background: #2e3440;
    border-radius: 4px;
  }
  .inspector-section {
    padding: 18px;
    border-bottom: 1px solid var(--studio-border);
  }
  .field-caption {
    display: block;
    color: #9da8ba;
    font-size: 11px;
    margin-bottom: 12px;
  }
  .size-value {
    font-size: 27px;
    font-weight: 550;
    letter-spacing: -0.7px;
    margin: 4px 0 18px;
  }
  .size-value > span {
    color: #748095;
    margin: 0 6px;
    font-size: 21px;
    font-weight: 400;
  }
  .size-value > small {
    color: #9ca7ba;
    font-size: 12px;
    margin-left: 8px;
    font-weight: 400;
    letter-spacing: 0;
  }
  .label-facts {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 13px;
    margin-top: 24px;
    font-size: 11px;
  }
  .label-facts span {
    color: #96a2b6;
  }
  .label-facts strong {
    font-weight: 450;
    color: #d0d8e6;
  }
  .inspector-empty {
    padding: 28px 20px;
    text-align: center;
  }
  .empty-illustration {
    display: grid;
    place-items: center;
    margin: 0 auto 16px;
    width: 48px;
    height: 48px;
    border: 1px dashed #52617b;
    border-radius: 14px;
    color: #88a4cf;
    background: #293242;
  }
  .empty-illustration :global(.mdi) {
    font-size: 27px;
  }
  h4 {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 9px;
  }
  .inspector-empty p {
    font-size: 11px;
    color: #9ca6b8;
    line-height: 1.9;
    margin-bottom: 10px;
  }
  .storage-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex-shrink: 0;
    border-top: 1px solid var(--studio-border);
    padding: 12px 16px;
    color: #929eb2;
    font-size: 10px;
    line-height: 1.8;
  }
  .storage-note :global(.mdi) {
    margin-top: 3px;
    font-size: 15px;
  }
  .property-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .property-controls :global(.input-group) {
    max-width: 100%;
    flex-basis: 100%;
    margin: 2px 0 !important;
  }
  .property-controls :global(.btn-secondary) {
    background: #343d4c;
    border-color: #454f61;
  }
  .property-controls :global(.form-control),
  .property-controls :global(.form-select),
  .text-content {
    font-size: 12px;
    background-color: #191e27;
    border-color: #414b5b;
  }
  .selection-actions {
    display: flex;
    padding: 18px;
    gap: 8px;
  }
  .selection-actions .btn {
    flex: 1;
  }

  @media (max-width: 1100px) {
    .image-editor {
      grid-template-rows: 88px minmax(0, 1fr) 32px;
    }
    .document-bar {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: 40px 40px;
      padding: 4px 12px;
      gap: 0 10px;
    }
    .document-info {
      gap: 10px;
      grid-column: 1;
      grid-row: 1;
    }
    .document-actions {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .document-name {
      max-width: 100px;
    }
    .document-actions .library-button {
      display: inline-block;
    }
    .document-actions > .btn {
      padding: 6px 9px;
    }
    .device-controls {
      grid-column: 2;
      grid-row: 1;
      padding-left: 10px;
    }
    .workspace-layout {
      grid-template-columns: 68px minmax(0, 1fr) 260px;
    }
    .workspace-statusbar {
      gap: 12px;
    }
    .workspace-status {
      gap: 10px;
    }
    .canvas-hint {
      display: none;
    }
  }
  @media (max-width: 850px) {
    .image-editor {
      grid-template-rows: 64px minmax(0, 1fr) 32px;
    }
    .document-bar {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: 28px 28px;
      padding: 4px 8px;
      gap: 0 8px;
    }
    .document-info {
      grid-column: 1;
      grid-row: 1;
      gap: 6px;
    }
    .document-name {
      max-width: 140px;
      font-size: 11px;
    }
    .save-status {
      display: flex;
    }
    .save-status-label {
      display: none;
    }
    .document-actions {
      grid-column: 1 / -1;
      grid-row: 2;
      gap: 6px;
    }
    .document-actions > .btn,
    .document-save > .btn {
      padding: 3px 8px;
      font-size: 11px;
      line-height: 1.4;
    }
    .document-actions .action-divider {
      display: none;
    }
    .device-controls {
      grid-column: 2;
      grid-row: 1;
      padding-left: 0;
      border: 0;
      min-width: 0;
    }
    .workspace-layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) 40px 0;
    }
    .workspace-layout.show-tools {
      grid-template-rows: minmax(0, 1fr) 40px 64px;
    }
    .workspace-layout.show-properties {
      grid-template-rows: minmax(0, 1fr) 40px min(40%, 320px);
    }
    .canvas-panel {
      grid-column: 1;
      grid-row: 1;
    }
    .canvas-toolbar {
      height: 36px;
      flex-basis: 36px;
      padding: 3px 8px;
    }
    .dock-tabs {
      display: flex;
      grid-column: 1;
      grid-row: 2;
      border-top: 1px solid var(--studio-border);
      background: #20232b;
    }
    .dock-tabs button {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 6px;
      padding: 6px 10px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: #9da8ba;
      font-size: 12px;
    }
    .dock-tabs button.active {
      color: #bdd5ff;
      background: #29354a;
      border-bottom-color: #86b3ff;
    }
    .dock-tabs button:focus-visible {
      outline: 2px solid #8eb8ff;
      outline-offset: -3px;
    }
    .insert-rail,
    .inspector {
      display: none;
      grid-column: 1;
      grid-row: 3;
      border: 0;
    }
    .show-tools .insert-rail {
      display: grid;
      grid-template-columns: repeat(8, minmax(0, 1fr));
      grid-template-rows: minmax(0, 1fr);
      padding: 6px 8px;
      gap: 4px;
    }
    .show-properties .inspector {
      display: flex;
    }
    .rail-heading,
    .rail-divider {
      display: none;
    }
    .insert-tool {
      gap: 3px;
      padding: 4px 2px;
      font-size: 10px;
    }
    .insert-tool :global(.mdi) {
      font-size: 21px;
    }
    .inspector-heading {
      height: 30px;
      flex-basis: 30px;
      padding: 4px 12px;
    }
    .inspector-section {
      padding: 12px;
    }
    .storage-note {
      display: none;
    }
    .canvas-scroll {
      padding: 40px 20px;
    }
  }
  @media (max-width: 600px) {
    .workspace-layout.show-tools {
      grid-template-rows: minmax(0, 1fr) 40px 116px;
    }
    .show-tools .insert-rail {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
    }
    .document-name {
      max-width: 100px;
    }
    .document-actions > .btn,
    .document-actions > .document-save {
      flex: 1;
    }
    .document-actions .library-button {
      display: inline-block;
    }
    .document-action-label {
      display: none;
    }
    .canvas-actions {
      gap: 0;
    }
    .canvas-actions .btn {
      padding: 3px 5px;
      font-size: 11px;
    }
    .canvas-actions .action-divider {
      display: none;
    }
    .size-button {
      gap: 3px;
      font-size: 10px;
      padding: 3px 5px;
    }
    .workspace-statusbar {
      padding: 0 8px;
      gap: 8px;
    }
    .workspace-status {
      min-width: 0;
      flex-shrink: 1;
      overflow: hidden;
    }
    .workspace-settings {
      gap: 0;
    }
    .workspace-zoom {
      margin-left: auto;
    }
    .zoom-controls .btn {
      padding: 2px 3px;
    }
  }
</style>
