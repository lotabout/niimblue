<script lang="ts">
  import { Utils } from "@mmote/niimbluelib";
  import BrowserWarning from "$/components/basic/BrowserWarning.svelte";
  import LabelDesigner from "$/components/LabelDesigner.svelte";
  import PrinterConnector from "$/components/PrinterConnector.svelte";
  import { locale, locales, tr } from "$/utils/i18n";
  import DebugStuff from "$/components/dialogs/DebugStuff.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import AppPrompt from "$/components/dialogs/AppPrompt.svelte";
  import { storageConfig } from "$/utils/label_storage";
  import { connectionState } from "$/stores/app";
  import { fontLibrary, fontState } from "$/stores/fonts";

  // eslint-disable-next-line no-undef
  const appCommit = __APP_COMMIT__;
  // eslint-disable-next-line no-undef
  const appVersion = __APP_VERSION__;
  // eslint-disable-next-line no-undef
  const buildDate = __BUILD_DATE__;

  let isStandalone = Utils.getAvailableTransports().capacitorBle || "__TAURI__" in window;

  let debugStuffShow = $state<boolean>(false);
</script>

<div class="page-wrapper">
  <div class="browser-warnings">
    <BrowserWarning />
    {#if $fontState.error}
      <div class="alert alert-warning" role="alert">
        {$tr("fonts.sync.failed")}
        <button
          class="btn btn-sm btn-outline-secondary"
          disabled={$fontState.loading}
          onclick={() => fontLibrary.refresh()}>
          {$tr("storage.refresh")}
        </button>
      </div>
    {/if}
  </div>
  <main class="app-main">
    <LabelDesigner>
      {#snippet brand()}
        <div class="brand" title={$tr("workspace.subtitle")}>
          <MdIcon icon="local_offer" />
          <h1>Niim<span>Blue{isStandalone ? "s" : ""}</span></h1>
        </div>
      {/snippet}
      {#snippet device()}
        <PrinterConnector />
      {/snippet}
      {#snippet status()}
        <span class="device-status" class:connected={$connectionState === "connected"} role="status">
          <span class="status-dot"></span>
          {$tr(`workspace.device.${$connectionState}`)}
        </span>
        <span class="local-note" title={$tr($storageConfig.mode === "remote" ? "storage.remote" : "workspace.offline")}
          ><MdIcon icon="verified_user" /><span
            >{$tr($storageConfig.mode === "remote" ? "storage.remote" : "workspace.offline")}</span
          ></span>
      {/snippet}
      {#snippet workspaceSettings()}
        <select aria-label="Language" class="form-select form-select-sm" bind:value={$locale}>
          {#each Object.entries(locales) as [key, name] (key)}
            <option value={key}>{name}</option>
          {/each}
        </select>
        {#if appVersion}
          <a
            class="version-link"
            href="https://github.com/MultiMote/niimblue/releases/tag/{appVersion}"
            title={`${$tr("main.built")} ${buildDate}`}>{appVersion}</a>
        {:else if appCommit}
          <a
            class="version-link"
            href="https://github.com/MultiMote/niimblue/commit/{appCommit}"
            title={`${$tr("main.built")} ${buildDate}`}>{appCommit.slice(0, 6)}</a>
        {/if}
        <a class="source-link" href="https://github.com/MultiMote/niimblue">{$tr("main.code")}</a>
        <button
          class="btn btn-sm debug-button"
          title={$tr("debug.title")}
          aria-label={$tr("debug.title")}
          onclick={() => (debugStuffShow = true)}>
          <MdIcon icon="bug_report" />
        </button>
      {/snippet}
    </LabelDesigner>
  </main>
</div>

{#if debugStuffShow}
  <DebugStuff bind:show={debugStuffShow} />
{/if}
<AppPrompt />

<style>
  .page-wrapper {
    height: 100dvh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #15171b;
    color: #e7e9ef;
  }
  .browser-warnings {
    flex: 0 0 auto;
    max-height: 25dvh;
    overflow-y: auto;
  }
  .browser-warnings :global(.alert) {
    margin: 0;
    border-radius: 0;
    padding-top: 8px;
    padding-bottom: 8px;
    font-size: 12px;
  }
  .app-main {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    overflow: hidden;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .brand > :global(.mdi) {
    display: grid;
    place-items: center;
    width: 27px;
    height: 27px;
    color: #b9d2ff;
    background: #293d60;
    border: 1px solid #3b527a;
    border-radius: 7px;
    font-size: 17px;
  }
  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }
  h1 span {
    color: #86b3ff;
  }
  .device-status {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #818b9e;
  }
  .connected .status-dot {
    background: #6ed6ad;
  }
  .local-note {
    display: flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .local-note > :global(.mdi) {
    color: #85bfa9;
    font-size: 13px;
  }
  .form-select {
    width: 112px;
    height: 23px;
    padding-top: 1px;
    padding-bottom: 1px;
    background-color: transparent;
    border-color: #343843;
    font-size: 10px;
    color: #aeb8ca;
  }
  a {
    color: #9ca8bc;
    font-size: 10px;
    text-decoration: none;
  }
  a:hover {
    color: #c4d7ff;
  }
  .debug-button {
    padding: 1px 2px;
    color: #9ca8bc;
    font-size: 11px;
  }
  @media (max-width: 1050px) {
    .local-note span,
    .version-link {
      display: none;
    }
  }
  @media (max-width: 600px) {
    .brand {
      gap: 6px;
    }
    h1 {
      font-size: 13px;
    }
    .brand > :global(.mdi) {
      width: 23px;
      height: 23px;
      font-size: 15px;
    }
    .local-note,
    .source-link,
    .debug-button {
      display: none;
    }
    .device-status {
      font-size: 9px;
    }
    .form-select {
      width: 96px;
    }
  }
</style>
