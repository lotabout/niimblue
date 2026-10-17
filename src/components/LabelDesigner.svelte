<script lang="ts">
  import Dropdown from "bootstrap/js/dist/dropdown";
  import * as fabric from "fabric";
  import { onDestroy, onMount, tick } from "svelte";
  import { ArUcoMarker } from "$/fabric-object/aruco";
  import { Barcode } from "$/fabric-object/barcode";
  import { QRCode } from "$/fabric-object/qrcode";
  import { iconCodepoints, type MaterialIcon } from "$/styles/mdi_icons";
  import { appConfig, automation, connectionState, csvData, loadedFonts, printerMeta } from "$/stores/app";
  import {
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
  import { CustomCanvas } from "$/fabric-object/custom_canvas";
  import VectorParamsControls from "$/components/designer-controls/VectorParamsControls.svelte";
  import { CanvasUtils } from "$/utils/canvas_utils";

  type DialogName = "none" | "preview" | "label_props" | "saved_labels" | "csv_props" | "icon_picker" | "object_picker";

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
  let hasSavedLabel = $state(false);
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let autoFit = $state(true);
  let labelTitle = $state("");
  const dpmm = $derived(labelProps.dpmm ?? ($printerMeta?.dpi === 300 ? 11.81 : 8));
  const labelWidth = $derived(Number((labelProps.size.width / dpmm).toFixed(1)));
  const labelHeight = $derived(Number((labelProps.size.height / dpmm).toFixed(1)));
  const textContent = $derived.by(() => {
    void editRevision;
    return selectedObject instanceof fabric.IText ? selectedObject.text : "";
  });
  const insertTools: { type: OjectType; icon: MaterialIcon }[] = [
    { type: "text", icon: "title" },
    { type: "image", icon: "image" },
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

  const loadLabelData = async (data: ExportedLabelTemplate) => {
    undo.paused = true;
    onUpdateLabelProps(data.label);
    if (data.csv) {
      $csvData = data.csv;
      csvEnabled = true;
    }
    await FileUtils.loadCanvasState(fabricCanvas!, data.canvas);
    undo.paused = false;
  };

  undo.onLabelUpdate = async (data) => {
    await loadLabelData(data);
    hasUnsavedChanges = true;
  };

  undo.onStateUpdate = (state: UndoState) => {
    undoState = state;
  };

  const deleteSelected = () => {
    LabelDesignerUtils.deleteSelection(fabricCanvas!);
    discardSelection();
  };

  const cloneSelected = () => {
    LabelDesignerUtils.cloneSelection(fabricCanvas!).then(() => undo.push(fabricCanvas!, labelProps));
  };

  const moveSelected = (direction: MoveDirection, ctrl?: boolean) => {
    LabelDesignerUtils.moveSelection(fabricCanvas!, direction, ctrl);
    undo.push(fabricCanvas!, labelProps);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const key: string = e.key.toLowerCase();
    // windows and linux users are used to ctrl, mac users use cmd
    const cmdOrCtrl = e.metaKey || e.ctrlKey;

    // Esc
    if (key === "escape") {
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
    hasUnsavedChanges = true;
    fabricCanvas!.setDimensions(labelProps.size);
    fabricCanvas!.virtualZoom(fabricCanvas!.getVirtualZoom());
    try {
      LocalStoragePersistence.saveLastLabelProps(labelProps);
      undo.push(fabricCanvas!, labelProps);
    } catch (e) {
      Toasts.zodErrors(e, "Label parameters save error:");
    }
  };

  const exportCurrentLabel = (): ExportedLabelTemplate => {
    return FileUtils.makeExportedLabel(fabricCanvas!, labelProps, csvEnabled);
  };

  const onLoadRequested = (label: ExportedLabelTemplate) => {
    labelTitle = label.title ?? "";
    hasSavedLabel = true;
    loadLabelData(label).then(() => {
      undo.push(fabricCanvas!, labelProps);
      hasUnsavedChanges = false;
    });
  };

  const onSave = () => {
    hasSavedLabel = true;
    hasUnsavedChanges = false;
  };

  const zplImageReady = async (img: Blob) => {
    await LabelDesignerObjectHelper.addImageBlob(fabricCanvas!, img);
    undo.push(fabricCanvas!, labelProps);
  };

  const pdfImageReady = async (el: HTMLCanvasElement) => {
    const img = new fabric.FabricImage(el, {
      ...OBJECT_DEFAULTS,
      left: 0,
      top: 0,
    });

    fabricCanvas!.add(img);
    fabricCanvas!.setActiveObject(img);
    undo.push(fabricCanvas!, labelProps);
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
      undo.push(fabricCanvas!, labelProps);
    }
  };

  const onIconPicked = (i: MaterialIcon) => {
    // todo: icon is not vertically centered
    LabelDesignerObjectHelper.addStaticText(fabricCanvas!, String.fromCodePoint(iconCodepoints[i]), {
      fontFamily: "Material Icons",
      fontSize: 100,
    });
    undo.push(fabricCanvas!, labelProps);
  };

  const onSvgIconPicked = (i: string) => {
    LabelDesignerObjectHelper.addSvg(fabricCanvas!, i);
    undo.push(fabricCanvas!, labelProps);
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
    hasUnsavedChanges = true;
    if (selectedObject) {
      selectedObject.setCoords();
      selectedObject.dirty = true;
      undo.push(fabricCanvas!, labelProps);
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
    undo.push(fabricCanvas!, labelProps);
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
        undo.push(fabricCanvas!, labelProps);
      }
    }
  };

  const clearCanvas = () => {
    if (!confirm($tr("editor.clear.confirm"))) {
      return;
    }
    undo.push(fabricCanvas!, labelProps);
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
        onLoadRequested(urlTemplate);
        Toasts.message($tr("params.saved_labels.load.url.loaded"));
        return true;
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
      const defaultTemplate = LocalStoragePersistence.loadDefaultTemplate();

      if (defaultTemplate !== null) {
        onLoadRequested(defaultTemplate);
        return;
      }
    } catch (e) {
      Toasts.error(e);
    }

    LabelDesignerObjectHelper.addText(fabricCanvas!, $tr("editor.default_text"));
  };

  const renderOnFontsChanged = () => {
    fabricCanvas?.forEachObject((o) => {
      if (o instanceof fabric.Textbox) {
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

    undo.push(fabricCanvas, labelProps);
    hasUnsavedChanges = false;

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
      hasUnsavedChanges = true;
      undo.push(fabricCanvas!, labelProps);
    });

    fabricCanvas.on("object:added", (): void => {
      hasUnsavedChanges = true;
    });

    fabricCanvas.on("text:changed", () => {
      hasUnsavedChanges = true;
      editRevision++;
    });

    fabricCanvas.on("object:removed", (): void => {
      hasUnsavedChanges = true;
      undo.push(fabricCanvas!, labelProps);
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
          undo.push(fabricCanvas!, labelProps);
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

  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  };

  onDestroy(() => {
    fabricCanvas!.dispose();
    window.removeEventListener("hashchange", loadLabelFromUrl);
    window.removeEventListener("beforeunload", warnBeforeUnload);
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
      <div class="document-icon"><MdIcon icon="description" /></div>
      <div>
        <h2>{labelTitle || $tr("workspace.untitled")}</h2>
        <span class="save-status" class:has-changes={hasUnsavedChanges} role="status">
          <span></span>
          {hasUnsavedChanges
            ? $tr("workspace.unsaved")
            : hasSavedLabel
              ? $tr("workspace.saved")
              : $tr("workspace.local")}
        </span>
      </div>
    </div>
    <div class="document-actions">
      <button class="btn studio-quiet library-button" onclick={() => (currentDialog = "saved_labels")}>
        <MdIcon icon="folder_open" />
        {$tr("workspace.library")}
      </button>
      <button class="btn studio-secondary" onclick={() => (currentDialog = "saved_labels")}>
        <MdIcon icon="save" />
        {$tr("workspace.save")}
      </button>
      <span class="action-divider"></span>
      <button class="btn studio-secondary" onclick={openPreview}>
        <MdIcon icon="visibility" />
        {$tr("editor.preview")}
      </button>
      <button
        class="btn studio-primary"
        onclick={$connectionState === "connected" ? openPreviewAndPrint : openPreview}
        title={$connectionState === "connected" ? $tr("workspace.quickprint") : $tr("workspace.preview.connect")}>
        <MdIcon icon="print" />
        {$tr("editor.print")}
      </button>
    </div>
  </div>

  <div class="workspace-layout">
    <nav class="insert-rail" aria-label={$tr("workspace.insert")}>
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
        <div class="canvas-scroll">
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
      <div class="canvas-bottom">
        <span class="canvas-hint">{$tr("workspace.canvas.hint")}</span>
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
    </section>

    <aside class="inspector" aria-label={$tr("workspace.properties")}>
      <div class="inspector-heading">
        <h3>{selectedCount ? $tr("workspace.properties") : $tr("workspace.label")}</h3>
        <span class="inspector-badge">{selectedCount ? selectedCount : "mm"}</span>
      </div>
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
              <BarcodeParamsPanel selectedBarcode={selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
            {/if}
            {#if selectedObject}
              <VectorParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
            {/if}
            {#if selectedObject instanceof fabric.IText || selectedObject instanceof QRCode || (selectedObject instanceof Barcode && selectedObject.encoding === "CODE128B")}
              <VariableInsertControl {selectedObject} valueUpdated={controlValueUpdated} />
            {/if}
          </div>
        </div>
        {#if selectedObject && selectedCount === 1}
          <div class="inspector-section">
            <span class="field-caption">{$tr("workspace.position")}</span>
            <div class="property-controls">
              <GenericObjectParamsControls {selectedObject} {editRevision} valueUpdated={controlValueUpdated} />
            </div>
          </div>
        {/if}
        <div class="selection-actions">
          <button class="btn studio-secondary" onclick={cloneSelected}
            ><MdIcon icon="content_copy" /> {$tr("editor.clone")}</button>
          <button class="btn studio-danger" onclick={deleteSelected}
            ><MdIcon icon="delete_outline" /> {$tr("editor.delete")}</button>
        </div>
      {/if}
      <div class="storage-note"><MdIcon icon="info" /><span>{$tr("workspace.storage")}</span></div>
    </aside>
  </div>

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
      {onSave}
      canvas={fabricCanvas!}
      onRequestLabelTemplate={exportCurrentLabel}
      {onLoadRequested}
      {csvEnabled}
      {hasUnsavedChanges} />
  {:else if currentDialog === "csv_props"}
    <CsvControl
      onClose={() => (currentDialog = "none")}
      bind:enabled={csvEnabled}
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
  }
  .document-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 22px;
  }
  .document-info {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .document-icon {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border: 1px solid var(--studio-border);
    border-radius: 11px;
    background: #20232b;
    color: #b3bfce;
  }
  h2 {
    font-size: 18px;
    font-weight: 650;
    margin: 0 0 5px;
    overflow-wrap: anywhere;
  }
  .save-status {
    color: var(--studio-muted);
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .save-status > span {
    width: 5px;
    height: 5px;
    background: #8896ac;
    border-radius: 50%;
  }
  .save-status.has-changes > span {
    background: #e2bb77;
  }
  .document-actions,
  .canvas-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .image-editor :global(.btn) {
    border-radius: 7px;
    font-size: 12px;
  }
  .document-actions > .btn {
    padding: 9px 13px;
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
    box-shadow: 0 3px 12px #174eaf26;
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
    height: 20px;
    width: 1px;
    background: var(--studio-border);
    margin: 0 3px;
    flex-shrink: 0;
  }
  .workspace-layout {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr) 282px;
    border: 1px solid var(--studio-border);
    border-radius: 14px;
    background: #1e2128;
    height: max(490px, calc(100dvh - 250px));
  }
  .insert-rail {
    padding: 12px 8px;
    overflow-y: auto;
    border-right: 1px solid var(--studio-border);
    display: flex;
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }
  .rail-heading {
    font-size: 10px;
    text-align: center;
    color: #8f99ab;
    margin: 0 0 6px;
    letter-spacing: 0.6px;
  }
  .insert-tool {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 5px;
    padding: 6px 2px;
    flex-shrink: 0;
    border: 1px solid transparent;
    border-radius: 9px;
    color: #b4bfd1;
    background: transparent;
    font-size: 10px;
    line-height: 1.3;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .insert-tool :global(.mdi) {
    font-size: 24px;
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
    margin: 5px 10px;
    flex-shrink: 0;
  }
  .canvas-panel {
    min-height: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: #191c22;
    border-radius: 0;
  }
  .canvas-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 58px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--studio-border);
    background: #22262e;
  }
  .size-button {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 10px;
    border-radius: 7px;
    border: 1px solid #3a414e;
    color: #d3dceb;
    background: #292f39;
    font-size: 12px;
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
    padding: 5px 7px;
  }
  .canvas-viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    background-image: radial-gradient(#41495888 0.8px, transparent 0.8px);
    background-size: 18px 18px;
  }
  .canvas-scroll {
    position: absolute;
    inset: 0;
    display: flex;
    overflow: auto;
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
  .canvas-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid var(--studio-border);
    background: #20242c;
  }
  .canvas-hint {
    font-size: 10px;
    line-height: 1.7;
    color: #98a2b6;
  }
  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }
  .zoom-controls .btn {
    padding: 3px 5px;
    font-size: 11px;
  }
  .zoom-controls .zoom-value {
    min-width: 46px;
  }
  .fit-button {
    margin-left: 5px;
  }
  .inspector {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-left: 1px solid var(--studio-border);
    background: #20232b;
    border-radius: 0 14px 14px 0;
  }
  .inspector-heading {
    min-height: 58px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--studio-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
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
    padding: 20px;
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
    margin-top: auto;
    padding: 18px 20px;
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
    padding: 20px;
    gap: 8px;
  }
  .selection-actions .btn {
    flex: 1;
  }
  @media (max-width: 1100px) {
    .workspace-layout {
      grid-template-columns: 72px minmax(0, 1fr) 250px;
    }
    .canvas-hint {
      max-width: 180px;
    }
    .inspector-section,
    .inspector-heading,
    .inspector-empty {
      padding: 16px;
    }
    .library-button {
      display: none;
    }
  }
  @media (max-width: 850px) {
    .workspace-layout {
      height: auto;
      grid-template-columns: 72px minmax(0, 1fr);
    }
    .inspector {
      grid-column: 1 / -1;
      border-left: 0;
      border-top: 1px solid var(--studio-border);
      border-radius: 0 0 14px 14px;
    }
    .inspector-empty {
      display: none;
    }
    .label-facts {
      margin-top: 18px;
      grid-template-columns: repeat(3, auto auto);
      gap: 10px;
    }
    .size-value {
      font-size: 22px;
    }
    .inspector-section {
      padding: 16px;
    }
    .storage-note {
      padding: 12px 16px;
    }
    .canvas-viewport {
      min-height: 360px;
    }
  }
  @media (max-width: 600px) {
    .document-bar {
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 16px;
    }
    .document-actions {
      width: 100%;
      gap: 6px;
    }
    .document-actions > .btn {
      flex: 1;
      padding: 9px 7px;
      font-size: 11px;
    }
    .document-actions .action-divider {
      display: none;
    }
    .document-actions .library-button {
      display: inline-block;
    }
    .document-info h2 {
      font-size: 17px;
    }
    .workspace-layout {
      display: flex;
      flex-direction: column;
    }
    .insert-rail {
      flex-direction: row;
      padding: 7px;
      gap: 3px;
      overflow-x: auto;
      border-right: 0;
      border-bottom: 1px solid var(--studio-border);
    }
    .rail-heading,
    .rail-divider {
      display: none;
    }
    .insert-tool {
      flex: 1 0 47px;
      min-height: 62px;
      padding: 8px 4px;
      font-size: 9px;
      gap: 6px;
    }
    .insert-tool :global(.mdi) {
      font-size: 21px;
    }
    .canvas-toolbar {
      padding: 8px 10px;
    }
    .canvas-actions .action-divider {
      display: none;
    }
    .canvas-actions .btn {
      padding: 5px;
    }
    .size-button {
      gap: 4px;
      padding: 6px;
      font-size: 11px;
    }
    .canvas-bottom {
      padding: 9px 10px;
    }
    .canvas-hint {
      max-width: 160px;
      font-size: 9px;
    }
    .canvas-viewport {
      min-height: 310px;
    }
    .canvas-scroll {
      padding: 60px 20px;
    }
    .label-facts {
      grid-template-columns: 1fr auto;
    }
    .inspector {
      border-top: 1px solid var(--studio-border);
    }
  }
</style>
