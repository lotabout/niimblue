<script lang="ts">
  import Modal from "bootstrap/js/dist/modal";
  import { onDestroy, onMount, type Snippet } from "svelte";

  interface Props {
    show?: boolean;
    title: string;
    onClose?: () => void;
    onShow?: () => void;
    children: Snippet;
    footer?: Snippet;
    variant?: "default" | "library";
  }

  let { show = $bindable(true), title, onClose, onShow, children, footer, variant = "default" }: Props = $props();

  let modalEl: HTMLElement;
  let modal: Modal | null = null;

  const handleHide = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleHidden = () => {
    show = false;
    onClose?.();
  };

  const handleShown = () => {
    onShow?.();
  };

  onMount(() => {
    modal = new Modal(modalEl);

    modalEl.addEventListener("shown.bs.modal", handleShown);
    modalEl.addEventListener("hide.bs.modal", handleHide);
    modalEl.addEventListener("hidden.bs.modal", handleHidden);

    if (show) {
      modal.show();
    }
  });

  $effect(() => {
    if (!modal) return;

    if (show) {
      modal.show();
    } else {
      modal.hide();
    }
  });

  onDestroy(() => {
    modalEl.removeEventListener("shown.bs.modal", handleShown);
    modalEl.removeEventListener("hide.bs.modal", handleHide);
    modalEl.removeEventListener("hidden.bs.modal", handleHidden);

    modal?.dispose();
    modal = null;
  });

  export function hide() {
    modal?.hide();
  }
</script>

<div
  bind:this={modalEl}
  class="modal fade"
  class:label-library={variant === "library"}
  tabindex="-1"
  aria-hidden="true"
  data-bs-theme={variant === "library" ? "dark" : undefined}>
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header">
        <h1 class="modal-title fs-5">{title}</h1>
        <button aria-label="Dismiss" type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>

      <div class="modal-body">
        {@render children()}
      </div>

      {#if footer}
        <div class="modal-footer">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .label-library {
    --bs-modal-bg: #1c2028;
    --bs-modal-color: #e7e9ef;
    --bs-modal-border-color: #353c49;
    --bs-modal-header-border-color: #303744;
    --bs-modal-footer-border-color: #303744;
    --bs-modal-border-radius: 16px;
  }
  .label-library .modal-dialog {
    width: calc(100% - 64px);
    max-width: 1040px;
    margin: 32px auto;
    min-height: calc(100% - 64px);
  }
  .label-library .modal-content {
    height: min(780px, calc(100dvh - 64px));
    overflow: hidden;
    box-shadow: 0 24px 80px #0006;
  }
  .label-library .modal-header {
    padding: 24px 28px 20px;
    flex-shrink: 0;
  }
  .label-library .modal-title {
    font-weight: 650;
    letter-spacing: 0.02em;
  }
  .label-library .modal-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 0;
    overflow: hidden;
  }
  .label-library .modal-footer {
    min-height: 76px;
    padding: 16px 24px;
    flex-shrink: 0;
    background: #1a1e25;
  }
  @media (max-width: 600px) {
    .label-library .modal-dialog {
      width: 100%;
      max-width: none;
      margin: 0;
      min-height: 100%;
    }
    .label-library .modal-content {
      height: 100dvh;
      border: 0;
      border-radius: 0;
    }
    .label-library .modal-header {
      padding: max(20px, env(safe-area-inset-top)) 20px 18px;
    }
    .label-library .modal-footer {
      padding: 12px 16px max(12px, env(safe-area-inset-bottom));
    }
  }
</style>
