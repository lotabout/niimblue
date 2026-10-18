<script lang="ts">
  import { onMount } from "svelte";
  import { OBJECT_DEFAULTS_TEXT } from "$/defaults";
  import { tr } from "$/utils/i18n";
  import { Toasts } from "$/utils/toasts";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { LocalStoragePersistence } from "$/utils/persistence";
  import { fontCache, userFonts } from "$/stores/app";
  import FontsMenu from "$/components/dialogs/FontsMenu.svelte";
  import type { MaterialIcon } from "$/styles/mdi_icons";

  interface Props {
    editRevision?: number;
    value: string;
    valueUpdated: (v: string) => void;
    label?: string;
    icon?: MaterialIcon;
    builtinFonts?: { family: string; label: string }[];
  }

  let { value, valueUpdated, editRevision, label, icon = "text_format", builtinFonts = [] }: Props = $props();

  let fontQuerySupported = typeof queryLocalFonts !== "undefined";
  let searchString = $state<string>("");

  let systemFontsFiltered = $derived.by<string[]>(() => {
    return $fontCache.filter((e) => e.toLowerCase().includes(searchString.toLowerCase()));
  });

  let userFontsFiltered = $derived.by<string[]>(() => {
    return $userFonts.map((e) => e.family).filter((e) => e.toLowerCase().includes(searchString.toLowerCase()));
  });

  const getSystemFonts = async () => {
    try {
      const fonts = await queryLocalFonts();
      const fontListSorted = [OBJECT_DEFAULTS_TEXT.fontFamily, ...new Set(fonts.map((f: FontData) => f.family))].sort();
      fontCache.update(() => fontListSorted);
      LocalStoragePersistence.saveCachedFonts(fontListSorted);
    } catch (e) {
      Toasts.error(e);
    }
  };

  const fontClick = (family: string) => {
    searchString = "";
    valueUpdated(family);
  };

  onMount(() => {
    try {
      let stored = LocalStoragePersistence.loadCachedFonts();
      if (stored.length > 0) {
        const uniqueFonts = new Set([OBJECT_DEFAULTS_TEXT.fontFamily, ...stored]);
        fontCache.update(() => [...uniqueFonts].sort());
      }
    } catch (e) {
      Toasts.error(e);
    }
  });
</script>

<div class="input-group flex-nowrap input-group-sm font-family-picker">
  <span class="input-group-text" title={label ?? $tr("params.text.font_family")}>
    <MdIcon {icon} />
    {#if label}<span class="ms-1">{label}</span>{/if}
  </span>

  <input
    type="text"
    class="form-control font-family-input"
    aria-label={label ?? $tr("params.text.font_family")}
    data-ver={editRevision}
    {value}
    oninput={(e) => valueUpdated(e.currentTarget.value)} />

  <button class="btn btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown"
    aria-label={label ?? $tr("params.text.font_family")}></button>

  <div class="dropdown-menu">
    <div class="px-3 py-1">
      <input
        type="text"
        class="form-control form-control-sm"
        placeholder={$tr("params.text.font_family.search")}
        bind:value={searchString} />
    </div>

    {#each builtinFonts.filter((font) => font.label.toLowerCase().includes(searchString.toLowerCase()) || font.family.toLowerCase().includes(searchString.toLowerCase())) as font (font.family)}
      <button class="dropdown-item" type="button" onclick={() => fontClick(font.family)}>{font.label}</button>
    {/each}

    {#if userFontsFiltered.length > 0}
      <h6 class="dropdown-header">{$tr("params.text.user_fonts")}</h6>
      {#each userFontsFiltered as family (family)}
        <button class="dropdown-item" style:font-family={family} type="button" onclick={() => fontClick(family)}>
          {family}
        </button>
      {/each}
    {/if}

    {#if systemFontsFiltered.length > 0}
      <h6 class="dropdown-header">{$tr("params.text.system_fonts")}</h6>
      {#each systemFontsFiltered as family (family)}
        <button class="dropdown-item" style:font-family={family} type="button" onclick={() => fontClick(family)}>
          {family}
        </button>
      {/each}
    {/if}

    {#if fontQuerySupported}
      <div class="dropdown-divider"></div>
      <button class="dropdown-item load-system-fonts" type="button" onclick={getSystemFonts}>
        <MdIcon icon="refresh" />
        {$tr("params.text.fetch_fonts")}
      </button>
    {/if}
  </div>

  <FontsMenu />
</div>

<style>
  .font-family-picker {
    width: unset;
  }

  .font-family-input {
    width: 14em;
  }

  .dropdown-menu {
    max-height: 240px;
    overflow-y: auto;
  }

  .load-system-fonts {
    color: var(--bs-primary);
  }
</style>
