<script lang="ts">
  import { Point } from "fabric";
  import { LabelBorder } from "$/fabric-object/border";
  import {
    BORDER_ANCHORS,
    BORDER_PRESETS,
    borderPreviewSvg,
    type BorderPreset,
    type BorderAnchor,
    type BorderRecipe,
  } from "$/utils/border_layout";
  import { tr } from "$/utils/i18n";

  interface Props {
    selectedBorder: LabelBorder;
    editRevision: number;
    valueUpdated: () => void;
  }
  let { selectedBorder, editRevision, valueUpdated }: Props = $props();
  const presets = Object.keys(BORDER_PRESETS) as BorderPreset[];
  const previews = Object.fromEntries(
    presets.map((preset) => [preset, `data:image/svg+xml,${encodeURIComponent(borderPreviewSvg(preset))}`]),
  );
  const values = $derived.by(() => {
    void editRevision;
    return {
      preset: selectedBorder.preset,
      width: Math.round(selectedBorder.width * selectedBorder.scaleX),
      height: Math.round(selectedBorder.height * selectedBorder.scaleY),
      lineWidth: selectedBorder.lineWidth,
      decorationSize: selectedBorder.decorationSize,
      decorationAnchor: selectedBorder.decorationAnchor,
      patternSpacing: selectedBorder.patternSpacing,
      inset: selectedBorder.inset,
      borderColor: selectedBorder.borderColor,
      canFit:
        selectedBorder.minimumSize <=
        Math.min(selectedBorder.canvas?.width ?? 0, selectedBorder.canvas?.height ?? 0) - 8,
    };
  });
  const recipe: BorderRecipe = $derived(BORDER_PRESETS[values.preset]);

  const change = (key: string, value: string | number) => {
    if (typeof value === "number" && !Number.isFinite(value)) return;
    selectedBorder.set(key, value);
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
  <div class="border-presets" aria-label={$tr("params.border.style")}>
    {#each presets as preset (preset)}
      <button
        class="border-preset"
        class:chosen={values.preset === preset}
        aria-pressed={values.preset === preset}
        onclick={() => change("preset", preset)}>
        <img src={previews[preset]} alt="" />
        <span>{$tr(`params.border.preset.${preset}`)}</span>
      </button>
    {/each}
  </div>
  <p class="border-hint">{$tr("params.border.hint")}</p>
  <div class="border-fields">
    <label
      >{$tr("params.border.width")}<input
        class="form-control form-control-sm"
        type="number"
        min={selectedBorder.minimumSize}
        value={values.width}
        onchange={(e) => resize("width", e.currentTarget.valueAsNumber)} /></label>
    <label
      >{$tr("params.border.height")}<input
        class="form-control form-control-sm"
        type="number"
        min={selectedBorder.minimumSize}
        value={values.height}
        onchange={(e) => resize("height", e.currentTarget.valueAsNumber)} /></label>
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
    <label
      >{$tr("params.border.inset")}<input
        class="form-control form-control-sm"
        type="number"
        min="0"
        max="60"
        value={values.inset}
        onchange={(e) => change("inset", e.currentTarget.valueAsNumber)} /></label>
    <label
      >{$tr("params.border.color")}<input
        class="form-control form-control-sm form-control-color"
        type="color"
        value={values.borderColor}
        oninput={(e) => change("borderColor", e.currentTarget.value)} /></label>
    {#if recipe.repeat}
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
  {#if recipe.decoration}
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
  .border-controls {
    width: 100%;
    min-width: 0;
  }
  .border-presets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .border-preset {
    border: 1px solid #454f61;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    padding: 6px;
    font-size: 11px;
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
