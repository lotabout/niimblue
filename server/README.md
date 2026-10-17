# Shared label storage

For the web app, LAN HTTPS and this API in one stack, including a portable offline image bundle, use the root [all-in-one Compose deployment](../docs/deployment.zh-CN.md). The Compose configuration below runs only the storage API.

The web app remains statically deployable. Each browser independently selects **Storage settings → This browser / Remote label library**. Remote mode connects to this optional Python + SQLite service. Python 3.11 or later is required; there are no additional Python dependencies.

A service instance supports **multiple isolated users**, identified by their access tokens. The server maps each token to a stable user ID; browsers enter only the service URL and their token. Devices using the same user's token share that user's library. Every list, read, update, delete and import is scoped to the authenticated user; knowing another user's label ID does not grant access.

The existing `NIIMBLUE_STORAGE_TOKEN` remains supported as the `default` user's token. Additional users are configured with `NIIMBLUE_STORAGE_USERS`, a JSON object mapping server-side user IDs to distinct tokens. Tokens must contain at least 24 non-whitespace ASCII characters; generate a separate random token per user. The server keeps token hashes for lookup and does not store tokens in SQLite.

## Docker Compose on a LAN

[中文部署和手机/电脑连接指南](README.zh-CN.md)

From the repository root:

```sh
cd server
cp .env.example .env
openssl rand -hex 32
```

Edit `.env`: set `NIIMBLUE_STORAGE_BIND_IP` to the Docker host's LAN IPv4 address, paste the generated token into `NIIMBLUE_STORAGE_TOKEN`, and set `NIIMBLUE_STORAGE_ORIGINS` to the exact origin(s) of the frontend opened on your devices. The template's IP and domain are examples to replace. The published port defaults to `8787`.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

On **both your phone and computer**, open the NiimBlue frontend's **Storage settings**, select **Remote label library**, enter `http://<server-LAN-IP>:8787` (without `/api/v1`) and the same access token, then **Test connection → Apply**. Allow local-network access if your browser prompts for it. Save a label on one device; open or refresh **My labels** on the other device to load it. The phone must be able to reach the server's LAN address; `localhost` on the phone refers to the phone itself.

Compose publishes only the configured host interface, stores SQLite in the `storage-data` named volume, restarts the service unless manually stopped, and checks the authenticated database health endpoint. `docker compose down` preserves the volume; **`docker compose down -v` deletes it**. Changes to `.env` require `docker compose up -d`, rather than only `restart`. This Compose file deploys the storage API; keep using your separately deployed frontend. For browser HTTPS/HTTP restrictions and reverse proxy setup, see below.

## Configure multiple users

In `server/.env`, keep the existing default token if upgrading, and add:

```dotenv
NIIMBLUE_STORAGE_USERS='{"alice":"<replace-with-alice-random-token>","bob":"<replace-with-bob-random-token>"}'
```

Replace each placeholder with a separately generated `openssl rand -hex 32` token, then run `docker compose up -d --build`. A users-only deployment can leave `NIIMBLUE_STORAGE_TOKEN` empty and configure all users through `NIIMBLUE_STORAGE_USERS`; at least one valid token is required. The health check uses the default token, or the first configured user token in users-only mode.

User IDs may contain 1–64 ASCII letters, digits, dots, underscores or hyphens and must start with a letter or digit. Keep IDs stable: changing a user's token under the same ID preserves their labels; changing the ID creates a different namespace. Duplicate tokens and conflicting `default` definitions are rejected at startup. After a token change or user removal, recreate the container to apply it. Removed users' data stays in the database but their old token stops working.

Existing single-user databases are automatically migrated: all old labels retain their IDs, revisions and content and belong to `default`. Keep `NIIMBLUE_STORAGE_TOKEN` to access them, or explicitly configure `default` in the JSON map with that variable empty. New users cannot see legacy data. Migration is idempotent; back up the database before upgrading, and do not roll an upgraded database back to the old single-user server, which does not enforce ownership.

No username field is added to the web app. **Apply** tests the token, records the returned user identity and detaches the current document when switching accounts, so a different user's document cannot overwrite it. The browser recovery draft is scoped by service and user. After upgrading an existing frontend configuration, reapply storage settings to record the account identity.

## Run locally

From the repository root:

```sh
export NIIMBLUE_STORAGE_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
npm run storage-server
```

The service defaults to `http://127.0.0.1:8787` and creates `server/data/labels.sqlite3`. In the web app, enter this service URL and the value of `NIIMBLUE_STORAGE_TOKEN`, then choose **Test connection** or **Apply**. Applying remote settings also tests the connection. Credentials are stored in that browser's localStorage, are sent only to the configured endpoint, and are omitted from label exports and recovery metadata. Use a dedicated storage token rather than a password from another service.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `NIIMBLUE_STORAGE_TOKEN` | Optional if users are configured | Token for the `default` user, at least 24 non-whitespace ASCII characters |
| `NIIMBLUE_STORAGE_USERS` | Empty | JSON object mapping stable user IDs to unique tokens; at least one default or per-user token is required |
| `NIIMBLUE_STORAGE_DB` | `server/data/labels.sqlite3` | Database path; parent directories are created automatically |
| `NIIMBLUE_STORAGE_HOST` | `127.0.0.1` | Bind interface |
| `NIIMBLUE_STORAGE_PORT` | `8787` | Listen port |
| `NIIMBLUE_STORAGE_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Comma-separated exact frontend origins allowed by CORS |

## Use from a phone and computer

The Python service uses HTTP and does not require a TLS certificate itself. Configure the same service URL and token in each device's storage settings. The service URL is the base URL, **without** `/api/v1`. A phone's `localhost` points at the phone itself.

For a trusted LAN, the frontend accepts HTTP on private IPv4 addresses (`192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12`) as well as loopback hosts. For example, bind the service to the host's LAN interface:

```sh
export NIIMBLUE_STORAGE_HOST=192.168.1.100
export NIIMBLUE_STORAGE_ORIGINS=https://labels.example.com
npm run storage-server
```

Then enter `http://192.168.1.100:8787` in each device's settings, substituting your server's actual LAN IP and your frontend's actual origin. Both devices need network access to that address and port. Public addresses and general hostnames still require HTTPS in the app's URL validation.

An HTTPS frontend accessing a LAN HTTP service is subject to browser mixed-content and local-network policies. Chrome 142 introduced a local-network permission prompt; when permission is granted, private-IP HTTP requests can be exempt from mixed-content blocking. Support varies across browsers, so allowing the URL in this app does not guarantee the browser will permit the connection. CORS must also allow the frontend origin. See [Chrome's local-network access documentation](https://developer.chrome.com/blog/local-network-access).

HTTP sends the access token and label data without transport encryption; use it only on a trusted LAN. For public deployments or broader browser compatibility, put the service behind an HTTPS reverse proxy. Keep the **frontend** in a secure context if you need Web Bluetooth printing: an ordinary `http://192.168.*` webpage does not meet that requirement ([Web Bluetooth security requirements](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#security_considerations)).

Set `NIIMBLUE_STORAGE_ORIGINS` to the exact origin(s) of your frontend, for example `https://labels.example.com`. Origins do not contain paths or trailing slashes. If the app and API share a domain through a proxy, that frontend origin still needs to be allowed. For this HTTPS deployment, keep the Python HTTP server bound to loopback and expose the HTTPS reverse proxy. Configure a 20 MiB request limit and request timeouts at the proxy as well.

Example Nginx location inside your existing HTTPS frontend server:

```nginx
location /api/v1/ {
    client_max_body_size 20m;
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_read_timeout 30s;
}
```

In this setup, the service URL is `https://labels.example.com`. For a separate API domain, use its HTTPS URL and allow the frontend domain in `NIIMBLUE_STORAGE_ORIGINS`. The proxy must forward `Authorization` and permit `OPTIONS`, `GET`, `POST`, `PUT` and `DELETE`. The API checks the token on every data request and checks origins when an `Origin` header is present. CORS does not replace authentication.

Optional container, built from the repository root:

```sh
docker build -t niimblue-storage server
docker run --rm -p 127.0.0.1:8787:8787 \
  -e NIIMBLUE_STORAGE_TOKEN \
  -e NIIMBLUE_STORAGE_ORIGINS=https://labels.example.com \
  -v niimblue-storage:/data niimblue-storage
```

The named volume preserves the database across container restarts. Back up the SQLite database using SQLite's backup API, or stop the service before copying the entire data directory. Do not copy only the main database file while the service is running in WAL mode.

## Template independence

Saved labels contain their full label properties (size, shape, direction, density, offsets, etc.), canvas objects and optional CSV. They do not refer to a preset/template ID. A device can open and edit a saved remote label even if the preset used to create it is absent locally, and later modifying or deleting that preset does not change the saved label. Missing presets affect creating new labels from those presets. Custom fonts are a separate dependency: import them on each device to keep rendering consistent.

## Behavior and migration

- Save, Save as, library listing, opening, deletion and JSON imports use the selected provider.
- Other devices see saved changes by reopening or refreshing the library. Opening a label fetches its latest content. This is not simultaneous collaborative editing or automatic background synchronization.
- Saves and deletions check revisions. An outdated device gets a conflict message instead of overwriting newer work. Use **Save as** to preserve the current version, or reopen the remote label to load the latest version.
- Switching providers keeps both libraries and the current canvas. The current document loses its saved identity, so the next save creates a new label in the selected destination. Existing labels are never automatically moved or deleted.
- To copy existing labels: open the source library, **Export → All saved labels → JSON file**, switch providers, then import that file in the destination. Imports create new IDs and do not overwrite existing labels. Reimporting the same file creates additional copies.
- Remote failures do not silently switch to local storage. Edits remain on the canvas and the existing browser recovery draft continues to work offline, retaining the saved revision for conflict checks after reconnecting.
- Label canvas data, embedded images, thumbnails and optional CSV data are stored remotely. Fonts, presets, default templates, recovery drafts and device settings remain local. Import custom fonts separately on each device.
- Each API request is limited to 20 MiB; a batch import accepts 1–1000 labels. Failed validation rolls back the entire import. Very large libraries may need smaller import batches.

## API

All paths start with `/api/v1`; use `Authorization: Bearer <user-token>`. User identity is derived from that token; clients cannot select an owner in request bodies. JSON request bodies require `Content-Type: application/json`.

| Method | Path | Body / response |
| --- | --- | --- |
| GET | `/health` | `{ "apiVersion": 1, "storage": "sqlite", "userId": "<authenticated-user>" }` |
| GET | `/labels` | List of stored label envelopes |
| POST | `/labels` | `{ "data": <label JSON> }` → new envelope |
| GET | `/labels/:id` | Stored label envelope |
| PUT | `/labels/:id` | `{ "revision": <current>, "data": <label JSON> }` → updated envelope |
| DELETE | `/labels/:id` | `{ "revision": <current> }` → 204 |
| POST | `/labels/import` | `{ "labels": [<label JSON>, ...] }` → `{ "imported": <count> }` |

An envelope is `{ "id": "<uuid>", "revision": 1, "data": <label JSON> }`. Successful updates increment the revision. Missing labels and labels owned by someone else both return 404, stale revisions return 409, invalid tokens return 401, blocked origins return 403, and invalid input returns 400. Imports are transactional and ignore imported IDs.

Run API integration tests with `npm run test:storage-server`; they start temporary loopback servers/databases and check authentication, CORS, persistence, transactional imports, concurrent edits, multi-user isolation, token rotation and legacy database migration.
