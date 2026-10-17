<div align="center">

[![logo](about/logo.svg)](https://niim.blue)

# NIIMBOT printers webui

![ux](about/ux.png)

Design and print labels right from your browser

[FAQ](https://github.com/MultiMote/niimblue/wiki/Frequently-asked-questions) | [Discord](https://discord.gg/jXPAfZVd8a) | [Telegram](https://t.me/niimblue) |  [NIIMBOT Community Wiki](https://printers.niim.blue)

[NiimBlueLib](https://github.com/MultiMote/niimbluelib) is used for communication

Deployments:

[niim.blue](https://niim.blue) ![de](https://github.com/user-attachments/assets/07e72fdf-dd32-47a6-9071-43e77e9be7fa) main | [dev.niim.blue](https://dev.niim.blue) ![de](https://github.com/user-attachments/assets/07e72fdf-dd32-47a6-9071-43e77e9be7fa) dev | [2.niim.blue](https://2.niim.blue) ![ru](https://github.com/user-attachments/assets/b85647b0-4fb3-4b39-9da0-c31ec171067c) main

Give thanks:

[Boosty](https://boosty.to/multimote) | [Lava](https://app.lava.top/mithriss_art?tabId=donate) (less fees)


</div>

## Features

* Privacy first! By default, editing and label storage work locally in your browser (network access is used to download application files and import ZPL labels). Optionally connect your own storage service to share saved labels across devices.
* Support for both Bluetooth and USB connections.
* Rich label editor. Label saving, import/export.
* Print preview. You can see how your label will look like after post-processing. Several post-processing algorithms are available.
* [Standalone apps](https://github.com/MultiMote/niimblue/releases):
    - Android (Capacitor based)
    - Windows (Tauri based, uses Edge backed)
* Most complete implementation of [NIIMBOT protocol](https://printers.niim.blue/interfacing/proto/).

You can see more complete list of implemented and planned features [on the Wiki](https://github.com/MultiMote/niimblue/wiki#features).

Demonstration video:

[![demo video](https://img.youtube.com/vi/u8QX-5e3W_A/mqdefault.jpg)](https://www.youtube.com/watch?v=u8QX-5e3W_A)

## Supported printers

There is no exact list of supported models in this project. This project aims to support the maximum number of models.

You can check [a list of tested models here](https://github.com/MultiMote/niimbluelib/issues/1). If you own other model, please write a comment.

If your (new) printer model does not print, please make a [packet dump](https://github.com/MultiMote/niimblue/wiki/Making-packet-capture) of print with official application.

> [!NOTE]
> If you have printing problems, try different print task versions in print preview dialog. Make if default by pressing "Lock" button.


## Supported browsers

Your browser must support Web Bluetooth API: [supported browsers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#browser_compatibility).

For serial communication: [supported browsers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API#browser_compatibility).

Modern Chrome-based browsers should usually work.

In some systems you need to enable Chrome `Web Bluetooth` or `Experimental Web Platform Features` (navigate to `chrome://flags`).

Safari: while, this browser has no native `Web Bluetooth`, there is [beacio extension](https://beacio.com/) that enables Web Bluetooth under Safari.
Setup details available [here](https://beacio.com/setup).

On iOS, the app prefers writes with response when the printer characteristic supports them;
this avoids repeat-write failures observed with BeaCIO and B1. Printers exposing only writes without response still use that method.
Writes are serialized with a minimum 100ms interval on iOS. Explicit BLE rate-limit rejections are retried
after 1, 2 and 4 seconds, with a slower write pace retained for the connection. Other write errors are not retried.
Print status polling also slows down to leave room for these paced writes.

## Images

Images may be outdated.

![ui](about/ui.png)

<details>
<summary>⬇ More images ⬇</summary>

Label properties:

![labels](about/labels.png)

Save/load menu:

![save_load](about/save_load.png)

Print preview dialog:

![print_preview](about/print_preview.png)

Post-processing:

![dither](about/dither.png)

Templating:

![templating](about/templating.png)

Dynamic data:

![batch](about/batch.png)

In real life:

![printed_b1](about/printed_b1.jpg)

![printed_d110](about/printed_d110.jpg)
</details>


## Development

### Launching development server

Skip steps you have done.

1. Install [git](https://git-scm.com)

2. Install [nodejs](https://nodejs.org)

3. Clone repository

    ```bash
    git clone https://github.com/MultiMote/niimblue.git
    ```

4. Install dependencies

    ```bash
    npm i
    ```

5. Run dev server

    Check code and run:

    ```bash
    npm run dev-check
    ```

    Or just run:

    ```bash
    npm run dev
    ```

### Optional shared label storage

Use **Storage settings** in the web app to choose browser storage or a user-configured remote library. The optional [Python + SQLite service](server/README.md) supports sharing saved labels between a phone and computer, with token-based user isolation and revision checks. A [Docker Compose LAN deployment guide (中文)](server/README.zh-CN.md) includes setup and connection steps for both devices.

### Deployment

Here are some options. HTTPS is required for non-localhost deployments.

#### All-in-one LAN deployment (Docker Compose)

The root Compose stack runs the web app, Caddy HTTPS and the Python/SQLite storage server together. It uses a local CA, proxies `/api/*` on the same HTTPS origin and persists labels and certificates in Docker volumes. Only one port is published: HTTP requests on that port redirect to HTTPS on the same port. Copy `.env.deploy.example` to `.env.deploy`, set the LAN address and a generated storage token, then run:

```sh
docker compose --env-file .env.deploy up -d --build
```

For a portable offline image bundle, run `npm run package:compose` (default `linux/amd64`) or `npm run package:compose -- --platform linux/arm64`. The target machine only needs Docker and Compose. See the [complete deployment, iOS certificate trust and migration guide (中文)](docs/deployment.zh-CN.md). iOS Safari still needs a Web Bluetooth extension such as BeaCIO in addition to trusted HTTPS.

To keep all persistent state in the deployment directory, add `compose.bind.yaml` to the Compose files; it mounts SQLite and Caddy state under `./data/`. The guide covers directory permissions and migrating existing volumes.

#### Serving static files

To get static files run `npm run build` (result builds to `dist`) or download `niimblue-dist.zip` from [Releases](https://github.com/MultiMote/niimblue/releases).

#### Using Docker Image

Follow the instructions in the [wiki](https://github.com/MultiMote/niimblue/wiki/Running-own-instance-with-Docker).

### IDE setup

Project uses path aliases.

VSCode (settings.json):

```json
{
  "typescript.preferences.importModuleSpecifier": "non-relative",
  "javascript.preferences.importModuleSpecifier": "non-relative"
}
```

## Translations (click to contribute)

[![translation](https://weblate.mmote.ru/widget/niimblue/web/multi-auto.svg)](https://weblate.mmote.ru/engage/niimblue/)
