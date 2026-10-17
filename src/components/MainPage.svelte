<script lang="ts">
  import { Utils } from "@mmote/niimbluelib";
  import BrowserWarning from "$/components/basic/BrowserWarning.svelte";
  import LabelDesigner from "$/components/LabelDesigner.svelte";
  import PrinterConnector from "$/components/PrinterConnector.svelte";
  import { locale, locales, tr } from "$/utils/i18n";
  import DebugStuff from "$/components/dialogs/DebugStuff.svelte";
  import MdIcon from "$/components/basic/MdIcon.svelte";
  import AppPrompt from "$/components/dialogs/AppPrompt.svelte";
  import { connectionState } from "$/stores/app";

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
  <header class="app-header">
    <div class="brand">
      <div class="brand-mark"><MdIcon icon="local_offer" /></div>
      <div>
        <h1>Niim<span>Blue{isStandalone ? "s" : ""}</span></h1>
        <div class="brand-caption">{$tr("workspace.subtitle")}</div>
      </div>
    </div>
    <div class="device-area">
      <span class="device-status" class:connected={$connectionState === "connected"} role="status">
        <span class="status-dot"></span>
        {$tr(`workspace.device.${$connectionState}`)}
      </span>
      <PrinterConnector />
    </div>
  </header>

  <main class="app-main">
    <BrowserWarning />
    <LabelDesigner />
  </main>

  <footer class="app-footer">
    <span class="local-note"><MdIcon icon="verified_user" /> {$tr("workspace.offline")}</span>
    <div class="footer-links">
      <select aria-label="Language" class="form-select form-select-sm" bind:value={$locale}>
        {#each Object.entries(locales) as [key, name] (key)}
          <option value={key}>{name}</option>
        {/each}
      </select>
      {#if appVersion}
        <a href="https://github.com/MultiMote/niimblue/releases/tag/{appVersion}">{appVersion}</a>
      {:else if appCommit}
        <a href="https://github.com/MultiMote/niimblue/commit/{appCommit}">{appCommit.slice(0, 6)}</a>
      {/if}
      <a href="https://github.com/MultiMote/niimblue">{$tr("main.code")}</a>
      <button
        class="btn btn-sm"
        title={$tr("debug.title")}
        aria-label={$tr("debug.title")}
        onclick={() => (debugStuffShow = true)}>
        <MdIcon icon="bug_report" />
      </button>
      <span class="build-date">{$tr("main.built")} {buildDate}</span>
    </div>
  </footer>
</div>

{#if debugStuffShow}
  <DebugStuff bind:show={debugStuffShow} />
{/if}

<AppPrompt />

<style>
  .page-wrapper {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: #15171b;
    color: #e7e9ef;
  }
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 16px 32px;
    border-bottom: 1px solid #2b2e36;
    background: #1b1d23;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }
  .brand-mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    color: #b9d2ff;
    background: #293d60;
    border: 1px solid #3b527a;
    border-radius: 12px;
  }
  h1 {
    margin: 0;
    font-size: 21px;
    font-weight: 750;
    letter-spacing: -0.7px;
  }
  h1 span {
    color: #86b3ff;
  }
  .brand-caption {
    margin-top: 2px;
    color: #939aa9;
    font-size: 11px;
    letter-spacing: 1px;
  }
  .device-area {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .device-status {
    display: flex;
    align-items: center;
    gap: 7px;
    color: #a2a8b6;
    font-size: 12px;
    white-space: nowrap;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #777f90;
  }
  .connected .status-dot {
    background: #6ed6ad;
  }
  .app-main {
    flex: 1;
    width: 100%;
    max-width: 1640px;
    padding: 24px 32px 12px;
    margin: 0 auto;
  }
  .app-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    max-width: 1640px;
    width: 100%;
    margin: 0 auto;
    padding: 12px 32px 20px;
    color: #929aaa;
    font-size: 11px;
  }
  .local-note {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .local-note :global(.mdi) {
    color: #85bfa9;
  }
  .footer-links {
    display: flex;
    align-items: center;
    gap: 15px;
  }
  .footer-links a {
    color: #929aaa;
    text-decoration: none;
  }
  .footer-links a:hover {
    color: #c4d7ff;
  }
  .footer-links .form-select {
    width: auto;
    max-width: 160px;
    font-size: 11px;
    background-color: transparent;
    border-color: #343843;
  }
  .footer-links .btn {
    padding: 0;
    color: #929aaa;
  }
  @media (max-width: 900px) {
    .device-status {
      display: none;
    }
    .build-date {
      display: none;
    }
  }
  @media (max-width: 600px) {
    .app-header {
      padding: 14px 16px;
      flex-wrap: wrap;
      gap: 14px;
    }
    .device-area {
      width: 100%;
      justify-content: flex-start;
    }
    .device-status {
      display: none;
    }
    .app-main {
      padding: 16px 12px 8px;
    }
    .app-footer {
      padding: 12px 16px;
    }
    .brand-mark {
      width: 34px;
      height: 34px;
    }
  }
</style>
