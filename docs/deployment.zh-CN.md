# 内网一体化部署：网页 + HTTPS + 存储 server

这套 Docker Compose 同时运行两个服务：

- `web`：NiimBlue 网页、Caddy 内网 HTTPS 和 API 反向代理。
- `storage`：Python + SQLite 标签库，支持单用户和多用户 token。8787 端口只在容器网络内使用。

手机和电脑访问同一个地址，例如 `https://192.168.1.100`。网页和 `/api/v1/*` 共用 HTTPS 来源，无需另开 HTTP API 端口或手动配置 CORS。打印时仍由打开网页的手机/电脑通过蓝牙连接打印机，服务器无需蓝牙适配器。

## 一、从源码直接部署

目标机器需要 Docker Engine 和 Docker Compose v2，并能下载构建依赖；无需安装 Node 或 Python。以下命令在仓库根目录执行：

```sh
cp .env.deploy.example .env.deploy
openssl rand -hex 32
```

编辑 `.env.deploy`：

| 变量 | 示例 / 说明 |
| --- | --- |
| `NIIMBLUE_BIND_IP` | Docker 主机的实际内网 IPv4，例如 `192.168.1.100`；必须是主机已有的地址 |
| `NIIMBLUE_HOST` | 设备访问的 IP 或内网 DNS 名称，不带协议、端口或路径；使用域名时自行配置局域网 DNS |
| `NIIMBLUE_HTTPS_PORT` | 唯一对外 TCP 端口，默认 `443`；例如改为 `8443` 后，`http://192.168.1.100:8443` 会跳转到 `https://192.168.1.100:8443` |
| `NIIMBLUE_PLATFORM` | Intel/AMD 机器用 `linux/amd64`，ARM64 机器用 `linux/arm64` |
| `NIIMBLUE_STORAGE_TOKEN` | 粘贴刚生成的 token，用于默认用户；至少 24 位非空白 ASCII 字符 |
| `NIIMBLUE_STORAGE_USERS` | 可选 JSON 用户配置，见下面的多用户说明；至少设置默认 token 或一个用户 |

建议通过路由器固定服务器 IP。`.env.deploy` 与原本的前端构建 `.env`、旧版 `server/.env` 分开，已加入 Git 忽略规则。不要把真实 token 写进示例文件。

```sh
docker compose --env-file .env.deploy config --quiet
docker compose --env-file .env.deploy up -d --build
docker compose --env-file .env.deploy ps
```

源码目录的 `compose.override.yaml` 会被 Compose 自动加载，用来构建镜像；`compose.yaml` 本身只描述运行服务。`storage` 健康检查通过后才启动 `web`。`config --quiet` 检查 Compose 格式，token 的有效性由 server 启动时检查。

允许局域网设备访问 `NIIMBLUE_HTTPS_PORT` 指定的一个 TCP 端口即可。不需要公网域名、公网端口或 Let's Encrypt；Caddy 使用本地 CA 签发和续期证书。首次启动后按第三节安装 CA。

Caddy 的 `http_redirect` 会在同一端口识别明文 HTTP 并返回 308，保留原端口、路径和查询参数，最终通过 HTTPS 提供网页和 API。例如端口为 `8443` 时，`http://192.168.1.100:8443/?a=1` 会跳转到 `https://192.168.1.100:8443/?a=1`。不再单独发布 80 端口：`http://192.168.1.100` 默认访问 80，不会进入这个服务；请直接使用 HTTPS 地址，或在 HTTP 地址中显式带上配置的端口。[Caddy 官方说明](https://caddyserver.com/docs/caddyfile/options#http_redirect)

旧版配置的 `NIIMBLUE_HTTP_PORT` 不再使用，可以从 `.env.deploy` 删除；单端口由原有的 `NIIMBLUE_HTTPS_PORT` 控制。升级需要重建 `web` 镜像，或加载新版离线包的镜像后重新启动，因为 Caddyfile 打包在镜像中；仅修改 `.env.deploy` 不会更新旧镜像的行为。

## 二、打成大包，搬到另一台机器 / 离线内网

在能联网、Docker 正常运行的构建机器上执行：

```sh
# 默认给 Intel/AMD Linux 服务器打包
npm run package:compose

# 给 ARM64 NAS / ARM64 Linux 服务器打包
npm run package:compose -- --platform linux/arm64

# 也可以不通过 npm 调用（构建机只需 Docker、Buildx、Compose、Bash 和 tar）
bash scripts/package-compose.sh --platform linux/amd64 --output /tmp/niimblue-compose.tar.gz
```

输出默认在 `release/niimblue-compose-linux-amd64.tar.gz` 或 `release/niimblue-compose-linux-arm64.tar.gz`。已有同名文件时脚本会拒绝覆盖，请换 `--output` 路径。跨架构构建需要构建机的 Buildx 支持目标平台模拟（例如 Docker Desktop 的模拟支持，或已配置的 binfmt/QEMU）。

包内目录：

```text
niimblue/
  compose.yaml
  compose.bind.yaml
  .env.deploy.example
  images.tar
  BUILD.txt
  LICENSE
  README.zh-CN.md
```

`images.tar` 包含网页 HTTPS 镜像和存储镜像，运行所需的基础镜像层也已包含。包里不包含源码构建配置、真实 token、数据库或证书私钥。CA 在部署机器首次启动时生成，不同的新部署有各自的 CA。

把压缩包复制到目标机器，执行：

```sh
tar -xzf niimblue-compose-linux-amd64.tar.gz
cd niimblue
docker load -i images.tar
cp .env.deploy.example .env.deploy
openssl rand -hex 32
# 编辑 .env.deploy，填写目标机 IP / 地址 / token；保留包内的目标架构
docker compose --env-file .env.deploy config --quiet
docker compose --env-file .env.deploy up -d --pull never
docker compose --env-file .env.deploy ps
```

目标机器只需 Docker 和 Compose v2，启动不需要联网。离线包没有 `compose.override.yaml`，因此不会触发源码构建。若只是更新现有部署，保留已有 `.env.deploy` 和数据卷，加载新镜像后执行同一条 `up -d --pull never`。

### 可选：所有持久化数据保存在部署目录下

无需修改应用代码或重建镜像。额外加载 `compose.bind.yaml`，即可把三个挂载点替换为绑定目录：

| 部署目录下的路径 | 内容 | 容器内路径 |
| --- | --- | --- |
| `./data/storage/` | SQLite 数据库及 WAL 文件 | `storage:/data` |
| `./data/caddy-data/` | Caddy CA、证书及私钥 | `web:/data` |
| `./data/caddy-config/` | Caddy 自动保存的配置 | `web:/config` |

相对路径以第一个 Compose 文件所在目录为基准，通常就是部署目录；并非任意执行命令时的 shell 工作目录。Compose 按容器内的 `target` 合并挂载，因此这三个绑定目录会替换原命名卷，而不是重复挂载。[Docker 合并规则](https://docs.docker.com/reference/compose-file/merge/#unique-resources)

**已有数据时，先按下一小节复制旧卷，再设置 `COMPOSE_FILE`。** 新部署可以直接创建空目录：

```sh
mkdir -p ./data/storage ./data/caddy-data ./data/caddy-config
```

为避免以后执行 `up`、`stop`、备份时遗漏 override，建议在 `.env.deploy` 增加以下配置（Linux / macOS）：

```dotenv
# 离线包或使用已有镜像
COMPOSE_FILE=compose.yaml:compose.bind.yaml
```

源码部署需要同时加载构建配置，改用：

```dotenv
COMPOSE_FILE=compose.yaml:compose.override.yaml:compose.bind.yaml
```

然后初始化 SQLite 目录权限并启动。镜像需已加载或构建；`run` 仅以 root 调整这个挂载目录的所有者，正常服务仍以镜像中的 `niimblue` 用户运行，无需猜测 UID，也无需开放所有人的写权限：

```sh
docker compose --env-file .env.deploy config --quiet
docker compose --env-file .env.deploy run --rm --no-deps --user root storage sh -c 'chown -R niimblue:niimblue /data'
docker compose --env-file .env.deploy up -d --pull never
```

源码模式若还没构建镜像，先执行 `docker compose --env-file .env.deploy build`，再执行上面的权限初始化和启动命令。

也可以不设置 `COMPOSE_FILE`，在每条命令中显式加 `-f compose.yaml -f compose.bind.yaml`；源码构建时加 `-f compose.yaml -f compose.override.yaml -f compose.bind.yaml`。指定 `-f` 后不会自动加载源码目录的 `compose.override.yaml`。

根目录 `data/` 已被 Git 忽略，离线打包也不会包含它。`caddy-data` 含 CA 私钥，不应作为网页静态目录分享。切换后，前面导出根证书的 `docker compose cp` 命令仍可使用；也可读取 `./data/caddy-data/caddy/pki/authorities/local/root.crt`。

### 将已有命名卷迁移到部署目录

在设置上述 `COMPOSE_FILE` **之前**，先使用原来的命名卷配置停机并复制完整目录：

```sh
docker compose --env-file .env.deploy stop
mkdir -p ./data/storage ./data/caddy-data ./data/caddy-config
docker compose --env-file .env.deploy cp storage:/data/. ./data/storage/
docker compose --env-file .env.deploy cp web:/data/. ./data/caddy-data/
docker compose --env-file .env.deploy cp web:/config/. ./data/caddy-config/
```

目标目录应为空，避免把不同数据库的 WAL 文件或不同 CA 混在一起。然后在 `.env.deploy` 设置对应的 `COMPOSE_FILE`，执行上一小节的权限初始化和 `up -d --pull never`。原命名卷仍然保留，确认标签正常、CA 未变化后再另行处理。复制原 Caddy 数据可以保留客户端已经信任的 CA；如果直接使用空目录，将生成新 CA 和空标签库。

## 三、信任 HTTPS 证书（iPhone / iPad / 电脑）

配置已显式设置 `skip_install_trust`，不会自动将 CA 加入主机或客户端的系统信任存储。以下安装步骤由需要访问服务的设备管理员手动完成。

容器启动成功后，在部署机器的 Compose 目录导出**公开根证书**：

```sh
docker compose --env-file .env.deploy cp web:/data/caddy/pki/authorities/local/root.crt ./niimblue-root.crt
openssl x509 -in niimblue-root.crt -noout -subject -fingerprint -sha256
```

通过可信渠道（例如 AirDrop、USB 或已信任的文件传输）将该 `.crt` 传给客户端，并核对指纹。只分发 `root.crt`，不要分发 Caddy 数据卷中的私钥。

iOS / iPadOS：

1. 打开根证书文件，按系统提示安装描述文件；通常在「设置 → 通用 → VPN 与设备管理」中完成。
2. 进入「设置 → 通用 → 关于本机 → 证书信任设置」，对这个 Caddy 根证书启用完全信任。
3. 重新打开 Safari，访问 `.env.deploy` 中配置的 HTTPS 地址，应无证书警告。只点浏览器里的「继续访问」不能替代安装并信任 CA。

电脑上将证书导入系统的受信任根证书存储；macOS 可导入钥匙串并设为始终信任，Windows 可导入「受信任的根证书颁发机构」。浏览器若使用独立证书存储，也要在其证书设置中导入。

Caddy 会自动续期站点证书，通常不需要重新安装根证书。保留 `caddy-data` 卷便能保持 CA 不变。更换访问 IP / 域名后更新 `.env.deploy` 并运行 `up -d`；Caddy 会为新地址签发证书，客户端应始终使用配置的地址访问。

参考：[Caddy 内网 HTTPS](https://caddyserver.com/docs/automatic-https#local-https)、[Apple 手动安装证书的信任设置](https://support.apple.com/en-us/102390)。

## 四、iOS 蓝牙和共享标签库

HTTPS 为 Web Bluetooth 提供安全上下文；**iOS Safari 本身没有原生 Web Bluetooth 支持**，需要按项目现有方案安装并启用 [BeaCIO 扩展](https://beacio.com/setup)，允许扩展访问这个内网站点，并授予所需的蓝牙权限。仅部署 HTTPS 不会自动让 Safari 获得蓝牙能力。打印机型号和扩展的兼容性仍需实机验证。

Android / 桌面端同样需要使用支持 Web Bluetooth 的浏览器并授权蓝牙。参考 [MDN 安全要求与浏览器兼容性](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)。

在手机和电脑上分别配置标签库：

1. 打开同一个 HTTPS 网页，进入「存储设置」。
2. 选择「远程标签库」。
3. 服务地址填写**网页的来源地址**，例如 `https://192.168.1.100` 或 `https://192.168.1.100:8443`；不加 `/api/v1`，不填 `storage:8787`。
4. 填写服务端分配的 token，点击「测试连接」再「应用设置」。
5. 在一端保存标签，另一端打开「我的标签」并刷新，即可加载同一用户的标签。

现有浏览器里的本地标签不会自动上传；需要先导出标签 JSON，再切换到远程标签库导入。自定义字体、尺寸预设和打印机设置仍保存在各设备本地。

### 多用户

可以保留默认用户 token，同时增加独立用户；也可以把默认 token 留空，只配置 JSON：

```dotenv
NIIMBLUE_STORAGE_USERS='{"alice":"<替换为alice生成的token>","bob":"<替换为bob生成的token>"}'
```

每个用户各自生成一个 token。同一用户的设备使用相同 token，不同用户的标签库彼此隔离。用户名只在服务器配置里使用；换 token 时保持用户名不变，即可保留标签归属。修改后执行 `docker compose --env-file .env.deploy up -d`。

## 五、更新、备份和迁移

所有命令都在部署目录执行，并使用同一份 `.env.deploy`：

```sh
# 日志 / 停止（保留标签和 CA）
docker compose --env-file .env.deploy logs --tail=100
docker compose --env-file .env.deploy down

# 源码部署更新
docker compose --env-file .env.deploy up -d --build

# 离线部署更新：先加载新包中的镜像，保留原配置和卷
docker load -i images.tar
docker compose --env-file .env.deploy up -d --pull never
```

持久卷默认叫 `niimblue_storage-data`、`niimblue_caddy-data`、`niimblue_caddy-config`。**不要执行 `down -v`，它会删除标签和 CA**。迁移到新机器时，仅搬镜像不会携带数据；如需保留标签和客户端已信任的 CA，可以停机复制：

使用 `compose.bind.yaml` 时，持久数据位于 `./data/`，可在停机后直接备份整个目录并保留文件权限。以下 `docker compose cp` 备份和恢复命令也适用；所有操作均需保留 `.env.deploy` 中的 `COMPOSE_FILE` 或使用同一组 `-f` 参数。

```sh
mkdir -p backup
docker compose --env-file .env.deploy stop
docker compose --env-file .env.deploy cp storage:/data ./backup/storage-data
docker compose --env-file .env.deploy cp web:/data ./backup/caddy-data
docker compose --env-file .env.deploy start
```

同时安全备份 `.env.deploy`。`backup/caddy-data` 包含 CA 私钥，仅交给受信任的管理员。数据库采用停机复制整个目录，包含可能存在的 SQLite WAL 文件，以避免丢失尚未合并到主数据库的写入。

在新机器加载镜像并准备 `.env.deploy` 后，先创建容器（不要先启动），再恢复：

```sh
docker compose --env-file .env.deploy create --pull never
docker compose --env-file .env.deploy cp ./backup/storage-data/. storage:/data/
docker compose --env-file .env.deploy cp ./backup/caddy-data/. web:/data/
# docker cp 可能把数据库所有者改为 root；恢复为服务用户
docker compose --env-file .env.deploy run --rm --no-deps --user root storage sh -c 'chown -R niimblue:niimblue /data'
docker compose --env-file .env.deploy up -d --pull never
```

旧的 `server/compose.yaml` 使用 `niimblue-storage_storage-data` 卷，与此整套部署的卷不同。升级时可以从旧服务导出标签 JSON 后导入新服务，或停掉旧服务后通过 `docker compose cp` 备份数据库，再按上述步骤恢复到新服务。保留原默认 token / 用户 ID，旧数据仍属于原用户。旧服务配置和细节见源码仓库的 `server/README.zh-CN.md`。

## 排查

| 现象 | 检查方式 |
| --- | --- |
| `exec: "docker-init": executable file not found` | 旧配置的 `storage` 含 `init: true`，依赖主机提供 Docker init。更新 `compose.yaml` 或删除该行，再运行 `docker compose --env-file .env.deploy up -d --force-recreate --no-build --pull never`；无需重新构建镜像，数据卷保留 |
| `storage` 不健康、`web` 没启动 | 查看 `docker compose --env-file .env.deploy logs storage`，确认至少配置一个有效 token，JSON 格式和用户 token 没有重复 |
| 无法绑定端口 / IP | `NIIMBLUE_BIND_IP` 必须属于主机；检查 `NIIMBLUE_HTTPS_PORT` 指定的端口是否被占用，必要时更换发布端口 |
| HTTP 没有跳转到 HTTPS | HTTP 地址必须带配置的同一个端口，例如 `http://192.168.1.100:8443`；确认已重建或加载新版 `web` 镜像 |
| 仍有证书警告 | 安装根证书并启用完全信任；确认访问地址与 `NIIMBLUE_HOST` 一致，系统时间正确 |
| iOS 没有蓝牙入口 | 检查 BeaCIO 扩展、站点访问和蓝牙权限，以及 HTTPS 信任状态 |
| API 返回 401 | 直接在地址栏打开 API 没有 token 是正常的；通过网页「测试连接」验证 |
| 手机访问不了 | 检查防火墙、访客 Wi-Fi / VLAN 隔离、局域网 DNS；手机的 `localhost` 指向手机自己 |
| 镜像架构不匹配 | 重新按目标机器架构打包；镜像架构和 `.env.deploy` 中的 `NIIMBLUE_PLATFORM` 必须一致 |
| 修改配置后没生效 | 执行 `up -d` 重建容器；单独 `restart` 不会加载新的环境变量 |
