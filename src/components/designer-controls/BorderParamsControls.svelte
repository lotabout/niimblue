<script lang="ts">
  import { Point } from "fabric";
  import { onMount } from "svelte";
  import { borderImageHref, prepareBorderImages } from "$/utils/border_images";
  import { Toasts } from "$/utils/toasts";
  import CustomBorders from "./CustomBorders.svelte";
  import { LabelBorder } from "$/fabric-object/border";
  import {
    BORDER_ANCHORS,
    BORDER_PRESETS,
    borderPresetFeatures,
    borderPreviewSvg,
    type BorderPreset,
    type BorderAnchor,
  } from "$/utils/border_layout";
  import { tr, locale } from "$/utils/i18n";
  import { borderPresetName } from "$/utils/border_catalog";

  interface Props {
    selectedBorder: LabelBorder;
    editRevision: number;
    valueUpdated: () => void;
  }
  let { selectedBorder, editRevision, valueUpdated }: Props = $props();
  const presets = Object.keys(BORDER_PRESETS) as BorderPreset[];
  let tab = $derived<"builtin" | "custom">(selectedBorder.borderPackage ? "custom" : "builtin");
  let previews = $state<Record<string, string>>({});
  onMount(() => {
    let active = true;
    void prepareBorderImages()
      .then(() => {
        if (active)
          previews = Object.fromEntries(
            presets.map((preset) => [
              preset,
              `data:image/svg+xml,${encodeURIComponent(borderPreviewSvg(preset, borderImageHref))}`,
            ]),
          );
      })
      .catch((error) => {
        if (active) Toasts.error(error);
      });
    return () => {
      active = false;
    };
  });
  const values = $derived.by(() => {
    void editRevision;
    return {
      preset: selectedBorder.preset,
      image: !!selectedBorder.borderPackage,
      imageFit: selectedBorder.imageFit,
      width: Math.round(selectedBorder.width * selectedBorder.scaleX),
      height: Math.round(selectedBorder.height * selectedBorder.scaleY),
      lineWidth: selectedBorder.lineWidth,
      decorationSize: selectedBorder.decorationSize,
      decorationAnchor: selectedBorder.decorationAnchor,
      patternSpacing: selectedBorder.patternSpacing,
      inset: selectedBorder.inset,
      borderColor: selectedBorder.borderColor,
      minimumWidth: selectedBorder.minimumDimensions.width,
      minimumHeight: selectedBorder.minimumDimensions.height,
      canFit:
        selectedBorder.minimumDimensions.width <= (selectedBorder.canvas?.width ?? 0) - 8 &&
        selectedBorder.minimumDimensions.height <= (selectedBorder.canvas?.height ?? 0) - 8,
    };
  });
  const recipe = $derived(borderPresetFeatures(values.preset));

  const change = (key: string, value: string | number) => {
    if (typeof value === "number" && !Number.isFinite(value)) return;
    if (key === "preset") selectedBorder.usePreset(value as BorderPreset);
    else selectedBorder.set(key, value);
    valueUpdated();
  };
  const resize = (key: "width" | "height", value: number) => {
    if (!Number.isFinite(value)) return;
    selectedBorder.set({ width: values.width, height: values.height, scaleX: 1, scaleY: 1, [key]: value });
    valueUpdated();
  };
  const fit = () => {
    const canvas = selectedBorder.canvas;
    if (!canvas) return;
    selectedBorder.set({ width: canvas.width - 8, height: canvas.height - 8, scaleX: 1, scaleY: 1, angle: 0 });
    selectedBorder.setPositionByOrigin(new Point(4, 4), "left", "top");
    valueUpdated();
  };
</script>

<div class="border-controls">
  <div class="border-tabs" role="group" aria-label={$tr("params.border.style")}>
    <button
      class="btn btn-sm"
      class:btn-secondary={tab === "builtin"}
      aria-pressed={tab === "builtin"}
      onclick={() => (tab = "builtin")}>{$tr("borders.builtin")}</button>
    <button
      class="btn btn-sm"
      class:btn-secondary={tab === "custom"}
      aria-pressed={tab === "custom"}
      onclick={() => (tab = "custom")}>{$tr("borders.mine")}</button>
  </div>
  {#if tab === "custom"}
    <CustomBorders {selectedBorder} {valueUpdated} />
  {:else}
    <div class="border-presets" aria-label={$tr("params.border.style")}>
      {#each presets as preset (preset)}
        <button
          class="border-preset"
          class:chosen={!values.image && values.preset === preset}
          aria-pressed={!values.image && values.preset === preset}
          onclick={() => change("preset", preset)}>
          {#if previews[preset]}<img src={previews[preset]} alt="" />{:else}<div class="border-preview-placeholder">
            </div>{/if}
          <span>{borderPresetName(preset, $locale)}</span>
        </button>
      {/each}
    </div>
  {/if}
  <p class="border-hint">{$tr(values.image ? "borders.image.hint" : "params.border.hint")}</p>
  {#if values.image}
    <label class="mb-2"
      >{$tr("borders.image.fit")}
      <select
        class="form-select form-select-sm"
        aria-label={$tr("borders.image.fit")}
        value={values.imageFit}
        onchange={(e) => change("imageFit", e.currentTarget.value)}>
        <option value="contain">{$tr("borders.image.contain")}</option>
        <option value="stretch">{$tr("borders.image.stretch")}</option>
      </select>
    </label>
  {/if}
  <div class="border-fields">
    <label
      >{$tr("params.border.width")}<input
        class="form-control form-control-sm"
        type="number"
        min={values.minimumWidth}
        value={values.width}
        onchange={(e) => resize("width", e.currentTarget.valueAsNumber)} /></label>
    <label
      >{$tr("params.border.height")}<input
        class="form-control form-control-sm"
        type="number"
        min={values.minimumHeight}
        value={values.height}
        onchange={(e) => resize("height", e.currentTarget.valueAsNumber)} /></label>
    {#if !values.image}
      <label
        >{$tr("params.border.line_width")}<input
          class="form-control form-control-sm"
          type="number"
          min="0.5"
          max="12"
          step="0.5"
          value={values.lineWidth}
          onchange={(e) => change("lineWidth", e.currentTarget.valueAsNumber)} /></label>
      <label
        >{$tr("params.border.decoration_size")}<input
          class="form-control form-control-sm"
          type="number"
          min="4"
          max="80"
          value={values.decorationSize}
          onchange={(e) => change("decorationSize", e.currentTarget.valueAsNumber)} /></label>
    {/if}
    <label
      >{$tr("params.border.inset")}<input
        class="form-control form-control-sm"
        type="number"
        min="0"
        max="60"
        value={values.inset}
        onchange={(e) => change("inset", e.currentTarget.valueAsNumber)} /></label>
    {#if !values.image}
      <label
        >{$tr("params.border.color")}<input
          class="form-control form-control-sm form-control-color"
          type="color"
          value={values.borderColor}
          oninput={(e) => change("borderColor", e.currentTarget.value)} /></label>
    {/if}
    {#if !values.image && recipe.repeat}
      <label
        >{$tr("params.border.spacing")}<input
          class="form-control form-control-sm"
          type="number"
          min="0"
          max="80"
          value={values.patternSpacing}
          onchange={(e) => change("patternSpacing", e.currentTarget.valueAsNumber)} /></label>
    {/if}
  </div>
  {#if !values.image && recipe.decoration}
    <label class="border-anchor"
      >{$tr("params.border.anchor")}
      <select
        class="form-select form-select-sm"
        value={values.decorationAnchor}
        onchange={(e) => change("decorationAnchor", e.currentTarget.value as BorderAnchor)}>
        {#each BORDER_ANCHORS as anchor (anchor)}
          <option value={anchor}>{$tr(`params.border.anchor.${anchor}`)}</option>
        {/each}
      </select>
    </label>
  {/if}
  <button
    class="btn btn-sm btn-secondary w-100"
    disabled={!values.canFit}
    title={values.canFit ? undefined : $tr("params.border.fit_too_small")}
    onclick={fit}>{$tr("params.border.fit")}</button>
</div>

<style>
  .border-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
  }
  .border-tabs .btn {
    color: inherit;
    flex: 1;
  }
  .border-controls {
    width: 100%;
    min-width: 0;
  }
  .border-presets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    max-height: 290px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 4px;
  }
  .border-preset {
    border: 1px solid #454f61;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    padding: 6px;
    font-size: 11px;
    min-width: 0;
  }
  .border-preset.chosen {
    border-color: #6597f4;
    background: #29354a;
  }
  .border-preset img {
    display: block;
    width: 100%;
    height: 46px;
    background: white;
    border-radius: 3px;
    margin-bottom: 5px;
  }
  .border-preview-placeholder {
    height: 46px;
    margin-bottom: 5px;
  }
  .border-hint {
    margin: 10px 0;
    font-size: 12px;
    opacity: 0.75;
  }
  .border-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    min-width: 0;
  }
  .border-anchor {
    margin-bottom: 12px;
  }
  .form-control-color {
    width: 100%;
  }
</style>
