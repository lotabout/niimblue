<script lang="ts">
  import type { ExportedLabelTemplate } from "$/types";
  import { tr } from "$/utils/i18n";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import SavedLabelPreview from "./SavedLabelPreview.svelte";

  interface Props {
    onItemClicked: (index: number) => void;
    onItemDelete: (index: number) => void;
    onItemExport: (index: number) => void;
    labels: ExportedLabelTemplate[];
    selectedIndex?: number;
    disabled?: boolean;
    class?: string;
  }

  let {
    class: className = "",
    onItemClicked,
    onItemDelete,
    onItemExport,
    labels,
    selectedIndex = -1,
    disabled = false,
  }: Props = $props();

  let deleteIndex = $state(-1);
  let menuIndex = $state(-1);

  const closeMenu = () => {
    menuIndex = -1;
    deleteIndex = -1;
  };

  const toggleMenu = (idx: number) => {
    const wasOpen = menuIndex === idx;
    closeMenu();
    if (!wasOpen) menuIndex = idx;
  };

  const onOutsideClick = (e: MouseEvent) => {
    const insideActions = e
      .composedPath()
      .some((node) => node instanceof Element && node.classList.contains("label-actions"));
    if (!insideActions) closeMenu();
  };

  const onMenuKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && menuIndex !== -1) {
      e.stopPropagation();
      closeMenu();
      (e.currentTarget as HTMLElement)
        .closest(".label-actions")
        ?.querySelector<HTMLButtonElement>(".more-button")
        ?.focus();
    }
  };

  const exportRequested = (e: MouseEvent, idx: number) => {
    (e.currentTarget as HTMLElement)
      .closest(".label-actions")
      ?.querySelector<HTMLButtonElement>(".more-button")
      ?.focus();
    closeMenu();
    onItemExport(idx);
  };

  const cancelDelete = (e: MouseEvent) => {
    deleteIndex = -1;
    (e.currentTarget as HTMLElement).closest(".card-menu")?.querySelector<HTMLButtonElement>(".delete-action")?.focus();
  };

  const deleteRequested = (idx: number) => {
    if (deleteIndex !== idx) {
      deleteIndex = idx;
      return;
    }
    closeMenu();
    onItemDelete(idx);
  };

  $effect(() => {
    if (disabled || menuIndex >= labels.length) closeMenu();
  });
</script>

<svelte:window onclick={onOutsideClick} />

<div class="labels-browser {className}" aria-busy={disabled}>
  {#if labels.length === 0}
    <div class="empty-state" role="status">
      <span class="empty-icon"><MdIcon icon="local_offer" /></span>
      <strong>{$tr(disabled ? "storage.loading" : "workspace.library.empty")}</strong>
      {#if !disabled}<p>{$tr("workspace.library.empty_hint")}</p>{/if}
    </div>
  {:else}
    <div class="labels-list">
      {#each labels as item, idx (item.id ?? item.timestamp)}
        {@const title = item.title || $tr("workspace.document.untitled")}
        <div class="label-card" class:selected={selectedIndex === idx}>
          <button
            type="button"
            class="card-select"
            aria-pressed={selectedIndex === idx}
            {disabled}
            onclick={() => onItemClicked(idx)}>
            <span class="preview-stage">
              <span
                class="preview-paper"
                style="width: min(100%, {(112 * item.label.size.width) / item.label.size.height}px); aspect-ratio: {item
                  .label.size.width} / {item.label.size.height};">
                <SavedLabelPreview label={item} />
              </span>
              {#if selectedIndex === idx}
                <span class="selected-mark"><MdIcon icon="check" /></span>
              {/if}
            </span>
            <span class="card-info">
              <span class="label-title" {title}>{title}</span>
              <span class="label-size"
                >{Number((item.label.size.width / (item.label.dpmm ?? 8)).toFixed(1))} × {Number(
                  (item.label.size.height / (item.label.dpmm ?? 8)).toFixed(1),
                )} mm</span>
            </span>
          </button>

          <div
            class="label-actions"
            role="group"
            aria-label={$tr("workspace.document.actions")}
            onfocusout={(e) => {
              if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) closeMenu();
            }}>
            <button
              type="button"
              class="more-button"
              aria-label={`${$tr("workspace.more")} · ${title}`}
              title={$tr("workspace.more")}
              aria-expanded={menuIndex === idx}
              {disabled}
              onkeydowncapture={onMenuKeyDown}
              onclick={() => toggleMenu(idx)}>
              <MdIcon icon="more_horiz" />
            </button>
            {#if menuIndex === idx}
              <div class="card-menu">
                <button type="button" onkeydowncapture={onMenuKeyDown} onclick={(e) => exportRequested(e, idx)}>
                  <MdIcon icon="download" />
                  {$tr("params.saved_labels.save.json")}
                </button>
                <div class="menu-divider"></div>
                <button
                  type="button"
                  class="delete-action"
                  onkeydowncapture={onMenuKeyDown}
                  onclick={() => deleteRequested(idx)}>
                  <MdIcon icon="delete" />
                  {$tr(deleteIndex === idx ? "workspace.library.delete_confirm" : "params.label.delete")}
                </button>
                {#if deleteIndex === idx}
                  <button type="button" onkeydowncapture={onMenuKeyDown} onclick={cancelDelete}>
                    <MdIcon icon="close" />
                    {$tr("params.label.delete.cancel")}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .labels-browser {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 28px 28px;
    scrollbar-color: #465166 transparent;
    scrollbar-width: thin;
  }
  .labels-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
    gap: 20px;
    align-content: start;
  }
  .label-card {
    position: relative;
    min-width: 0;
    border: 1px solid #353d4b;
    border-radius: 12px;
    background: #252b35;
    transition:
      border-color 150ms,
      background-color 150ms;
  }
  .label-card:hover {
    border-color: #62708a;
    background: #2a313e;
  }
  .label-card.selected {
    border-color: #78a7ff;
    background: #293a55;
    box-shadow: 0 0 0 1px #78a7ff;
  }
  .card-select {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    color: #e7ecf5;
    text-align: left;
  }
  button:focus-visible {
    outline: 2px solid #97bdff;
    outline-offset: 3px;
  }
  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
  .preview-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    height: 160px;
    padding: 24px;
    border-radius: 11px 11px 0 0;
    background: #303744;
  }
  .preview-paper {
    display: block;
    flex-shrink: 0;
    overflow: hidden;
    background: #fff;
    border-radius: 2px;
    box-shadow: 0 5px 14px #0003;
  }
  .selected-mark {
    position: absolute;
    top: 10px;
    left: 10px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: #fff;
    background: #4a83ed;
    font-size: 15px;
  }
  .card-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 54px 16px 16px;
  }
  .label-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
  }
  .label-size {
    color: #9daabd;
    font-size: 12px;
    line-height: 18px;
  }
  .label-actions {
    position: absolute;
    right: 8px;
    bottom: 16px;
  }
  .more-button {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    color: #b4c0d3;
    background: transparent;
    font-size: 22px;
  }
  .more-button:hover,
  .more-button[aria-expanded="true"] {
    color: #fff;
    background: #414d61;
  }
  .card-menu {
    position: absolute;
    z-index: 2;
    bottom: calc(100% + 8px);
    right: 0;
    width: 192px;
    max-width: calc(100vw - 48px);
    padding: 6px;
    border: 1px solid #4c586c;
    border-radius: 9px;
    background: #242b36;
    box-shadow: 0 8px 24px #0006;
  }
  .card-menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 40px;
    padding: 8px 10px;
    border: 0;
    border-radius: 5px;
    color: #e0e7f3;
    background: transparent;
    text-align: left;
    font-size: 13px;
  }
  .card-menu button:hover {
    background: #354157;
  }
  .card-menu .delete-action {
    color: #ffa1aa;
  }
  .menu-divider {
    height: 1px;
    margin: 5px;
    background: #3a4454;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: 32px 16px;
    text-align: center;
    color: #cdd6e5;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    margin-bottom: 20px;
    border: 1px solid #39465a;
    border-radius: 18px;
    background: #283348;
    color: #91b7f8;
    font-size: 30px;
  }
  .empty-state p {
    max-width: 320px;
    margin: 10px 0 0;
    color: #9daabd;
    font-size: 13px;
    line-height: 1.7;
  }
  @media (max-width: 600px) {
    .labels-browser {
      padding: 4px 16px 20px;
    }
    .labels-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .preview-stage {
      height: 144px;
      padding: 16px;
    }
    .card-info {
      padding: 12px 44px 12px 12px;
    }
    .label-title {
      font-size: 13px;
    }
    .label-actions {
      right: 2px;
      bottom: 12px;
    }
    .card-menu {
      width: 164px;
    }
  }
  @media (max-width: 360px) {
    .labels-list {
      grid-template-columns: 1fr;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .label-card {
      transition: none;
    }
  }
</style>
