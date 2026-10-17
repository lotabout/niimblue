<script lang="ts">
  import AppModal from "$/components/basic/AppModal.svelte";
  import { tr } from "$/utils/i18n";

  interface Props {
    initialTitle: string;
    saveAs: boolean;
    onSave: (title: string) => boolean;
    onClose: () => void;
  }

  let { initialTitle, saveAs, onSave, onClose }: Props = $props();
  let title = $state("");
  let input: HTMLInputElement;
  let modal: AppModal;

  const submit = () => {
    const name = title.trim();
    if (name && onSave(name)) modal.hide();
  };

  const focusName = () => {
    title = initialTitle;
    input.focus();
    input.select();
  };
</script>

<AppModal title={$tr(saveAs ? "workspace.save_as" : "workspace.save")} {onClose} onShow={focusName} bind:this={modal}>
  <form
    id="save-label-form"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}>
    <label class="form-label" for="label-name">{$tr("params.saved_labels.label_title")}</label>
    <input
      id="label-name"
      class="form-control"
      bind:this={input}
      bind:value={title}
      required
      autocomplete="off"
      placeholder={$tr("workspace.name.placeholder")} />
    <div class="form-text">{$tr("workspace.save.hint")}</div>
  </form>

  {#snippet footer()}
    <button class="btn btn-secondary" onclick={() => modal.hide()}>{$tr("dialog.cancel")}</button>
    <button class="btn btn-primary" type="submit" form="save-label-form" disabled={!title.trim()}
      >{$tr("workspace.save")}</button>
  {/snippet}
</AppModal>
