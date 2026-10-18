<script lang="ts">
  import { onMount } from "svelte";
  import { tr } from "$/utils/i18n";
  import { iconCodepoints, type MaterialIcon } from "$/styles/mdi_icons";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import { appConfig, userIcons } from "$/stores/app";
  import { FileUtils } from "$/utils/file_utils";
  import { Toasts } from "$/utils/toasts";
  import AppModal from "$/components/basic/AppModal.svelte";

  interface Props {
    onSubmit: (i: MaterialIcon) => void;
    onSubmitSvg: (i: string) => void;
    onClose?: () => void;
  }

  let { onSubmit, onSubmitSvg, onClose }: Props = $props();

  let iconNames = $state<MaterialIcon[]>([]);
  let search = $state<string>("");
  let deleteMode = $state<boolean>(false);
  let modalRef: AppModal;
  let busy = $state(true);
  let error = $state("");

  const addOwn = async () => {
    if (busy) return;
    busy = true;
    error = "";
    try {
      let counter = 0;
      const xmls = await FileUtils.pickAndReadTextFile("svg", true);
      const iconsToAdd = xmls.map((xml) => ({
        name: `i_${FileUtils.timestampFloat()}_${counter++}`,
        data: xml,
      }));

      await userIcons.update((prev) => [...prev, ...iconsToAdd]);
    } catch (e) {
      error = String(e);
      Toasts.error(e);
    } finally {
      busy = false;
    }
  };

  const svgClicked = async (name: string, data: string) => {
    if (busy) return;
    if (deleteMode) {
      busy = true;
      error = "";
      try {
        await userIcons.update((prev) => prev.filter((e) => e.name !== name));
      } catch (e) {
        error = String(e);
        Toasts.error(e);
      } finally {
        busy = false;
      }
      return;
    }

    onSubmitSvg(data);
    modalRef.hide();
  };

  const iconClicked = (i: MaterialIcon) => {
    if (deleteMode) {
      return;
    }

    onSubmit(i);
    modalRef.hide();
  };

  onMount(() => {
    if (iconNames.length === 0) {
      iconNames = Object.keys(iconCodepoints) as MaterialIcon[];
    }
    void userIcons
      .refresh()
      .catch((e) => {
        error = String(e);
      })
      .finally(() => {
        busy = false;
      });
  });
</script>

<AppModal title={$tr("editor.iconpicker.title")} {onClose} bind:this={modalRef}>
  {#if busy}<p role="status">{$tr("storage.loading")}</p>{/if}
  {#if error}<div class="alert alert-danger" role="alert">{error}</div>{/if}
  <input
    disabled={$appConfig.iconListMode === "user"}
    type="text"
    class="form-control mb-1"
    placeholder={$tr("editor.iconpicker.search")}
    bind:value={search} />

  <div class="input-group input-group-sm mb-2">
    <span class="input-group-text">{$tr("editor.iconpicker.show")}</span>
    <select class="form-select form-select-sm" bind:value={$appConfig.iconListMode}>
      <option value="both">{$tr("editor.iconpicker.show.both")}</option>
      <option value="user">{$tr("editor.iconpicker.show.user")}</option>
      <option value="pack">{$tr("editor.iconpicker.show.pack")}</option>
    </select>
  </div>

  <div class="icons mb-2">
    {#if $appConfig.iconListMode === "both" || $appConfig.iconListMode === "user"}
      {#each $userIcons as { name, data } (name)}
        <button
          class="btn {deleteMode ? 'btn-danger' : 'btn-light'} me-1 mb-1 user-icon"
          disabled={busy}
          onclick={() => svgClicked(name, data)}>
          <img src="data:image/svg+xml;base64,{FileUtils.base64str(data)}" alt="user-svg" />
        </button>
      {/each}
    {/if}

    {#if $appConfig.iconListMode === "both" || $appConfig.iconListMode === "pack"}
      {#each iconNames as name (name)}
        {#if !search || name.includes(search.toLowerCase())}
          <button class="btn me-1" title={name} onclick={() => iconClicked(name)}>
            <MdIcon icon={name} />
          </button>
        {/if}
      {/each}
    {/if}
  </div>

  <div class="input-group input-group-sm mb-1">
    <button class="btn btn-outline-secondary" disabled={busy} onclick={addOwn}>
      <MdIcon icon="add" />

      {$tr("editor.iconpicker.add")}
    </button>
    <button
      class="btn {deleteMode ? 'btn-danger' : 'btn-outline-secondary'}"
      disabled={busy}
      onclick={() => (deleteMode = !deleteMode)}>
      <MdIcon icon="delete" />
      {$tr("editor.iconpicker.delete_mode")}
    </button>
  </div>

  <a
    href="https://fonts.google.com/icons?icon.set=Material+Icons&icon.style=Filled"
    target="_blank"
    class="text-secondary">
    {$tr("editor.iconpicker.mdi_link_title")}
  </a>
</AppModal>

<style>
  .icons {
    max-height: 400px;
    overflow-y: scroll;
  }
  .user-icon img {
    width: 24px;
  }
</style>
