# 在内网部署共享标签存储

使用此目录的 Docker Compose 配置，可以在 NAS、家用服务器或电脑上运行存储 API。手机和电脑连接同一个服务，就能读取和编辑同一份已保存标签。

同一个服务支持多个用户，每个用户有独立的标签库和 token。服务端根据 token 识别用户，网页仍然只需要填写服务地址和 token；同一用户的手机和电脑使用相同 token，不同用户使用不同 token。

## 1. 准备服务器

需要安装并启动 Docker，以及 Docker Compose v2。假设 Docker 所在机器的内网 IPv4 地址为 `192.168.1.100`，存储端口使用 `8787`。请将下面的示例 IP 换成你自己的实际地址；建议在路由器中为这台机器保留固定地址。

此 Compose 配置启动存储服务。手机和电脑仍需打开已包含「存储设置」功能的 NiimBlue 前端。

在仓库根目录执行：

```sh
cd server
cp .env.example .env
openssl rand -hex 32
```

最后一条命令会生成一个随机访问令牌。打开 `server/.env`，填写以下配置：

| 配置项 | 填写方式 |
| --- | --- |
| `NIIMBLUE_STORAGE_BIND_IP` | Docker 宿主机的内网 IP，例如 `192.168.1.100` |
| `NIIMBLUE_STORAGE_PUBLISH_PORT` | 对外端口，默认 `8787` |
| `NIIMBLUE_STORAGE_TOKEN` | 默认用户的随机令牌，同一用户的手机和电脑使用相同的值；也可留空并使用下面的多用户配置 |
| `NIIMBLUE_STORAGE_USERS` | 可选的 JSON 用户配置，格式见下面的「配置多个用户」；至少要配置一个有效 token |
| `NIIMBLUE_STORAGE_ORIGINS` | **NiimBlue 网页的来源地址**，例如 `https://labels.example.com` |

`NIIMBLUE_STORAGE_ORIGINS` 填的是浏览器地址栏里**前端网页**的来源，不是存储 API 地址。例如：

- 网页是 `https://labels.example.com/editor`，填写 `https://labels.example.com`。
- 网页是 `http://localhost:5173`，填写 `http://localhost:5173`。
- 两台设备使用不同的前端来源时，用英文逗号分隔，例如 `https://labels.example.com,http://localhost:5173`。

保留 `http://` 或 `https://` 和实际使用的端口，不带页面路径或末尾的 `/`。`.env` 已加入 Git 忽略规则，不会进入镜像构建上下文；不要分享这个文件中的令牌。

`NIIMBLUE_STORAGE_BIND_IP` 是宿主机的发布地址。容器内部会自动监听 `0.0.0.0:8787`，无需将宿主机 IP 填进容器环境变量。

## 2. 启动服务

在 `server` 目录执行：

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

启动后，`storage` 的状态应在首次健康检查后显示 `healthy`。健康检查会使用令牌访问 API，并验证数据库可以读取。

查看日志：

```sh
docker compose logs --tail=100 storage
```

确保宿主机防火墙允许局域网设备访问 TCP `8787`，手机和电脑能访问这台机器。访客 Wi-Fi、无线客户端隔离或不同 VLAN 可能阻止设备互访。

SQLite 数据保存在 Docker 命名卷 `niimblue-storage_storage-data` 中。更新镜像、重建容器和普通的 `docker compose down` 都会保留数据。**不要使用 `docker compose down -v`，它会删除数据卷和标签。**

## 配置多个用户

在 `server/.env` 中增加 JSON 格式的用户配置，例如：

```dotenv
NIIMBLUE_STORAGE_USERS='{"alice":"<替换成alice的随机令牌>","bob":"<替换成bob的随机令牌>"}'
```

分别运行 `openssl rand -hex 32` 为每个用户生成不同的令牌，替换上面的占位符。用户名只在服务端配置里使用，不需要在网页填写。用户名支持 1–64 位英文字母、数字、点、下划线和短横线，首位为字母或数字。

- Alice 在自己的手机和电脑上输入 Alice 的 token，只能访问 Alice 的标签库。
- Bob 输入 Bob 的 token，只能访问 Bob 的标签库，即使知道 Alice 的标签 ID 也无法读取或修改。
- `NIIMBLUE_STORAGE_TOKEN` 对应固定的 `default` 用户，可以与其他用户同时配置。只使用 JSON 配置时，可以将它留空；至少需要一个有效 token。
- 更换 token 时保持用户名不变，原标签仍属于该用户。删除用户配置后，其旧 token 会失效，数据库里的标签仍会保留。
- 每个用户的 token 必须唯一。不要同时在单 token 变量和 JSON 中重复定义 `default`。

修改后执行：

```sh
docker compose up -d --build
```

旧版单用户数据库会自动升级，原标签的 ID、版本和内容均保留，归属 `default` 用户。升级时保留原 `NIIMBLUE_STORAGE_TOKEN`，即可继续访问旧数据；也可以将它留空，并在 JSON 中显式配置 `default`。新增用户看不到旧用户的数据。升级前请备份数据库，升级后的数据库不要再交给不支持用户隔离的旧版服务运行。

前端升级后请重新应用一次存储设置，以记录服务端识别的用户。切换到其他用户后，当前画布会保留并解除原标签关联，下一次保存会在新用户的库里创建副本；同一用户更换 token 时保留关联。草稿恢复会检查服务地址和用户是否一致。

## 3. 在电脑上配置

1. 打开你正在使用的 NiimBlue 网页，在工作台底部点击「存储设置」。
2. 存储位置选择「远程标签库」。
3. 服务地址填写 `http://192.168.1.100:8787`，不加 `/api/v1`。
4. 访问令牌填写服务端分配给你的 token：可以是默认用户的 `NIIMBLUE_STORAGE_TOKEN`，也可以是 `NIIMBLUE_STORAGE_USERS` 中对应用户的值；不需要填写用户名。
5. 点击「测试连接」，看到「连接成功」后点击「应用设置」。
6. 保存一个标签，确认顶部状态变成「已保存到远程」。

## 4. 在手机上配置

1. 让手机连接到能访问服务器的局域网，例如与服务器相同的家用 Wi-Fi。
2. 在手机浏览器中打开相同版本的 NiimBlue 前端。
3. 在「存储设置」中同样选择「远程标签库」，填写 **同一个服务地址和同一个令牌**。
4. 点击「测试连接」，成功后点击「应用设置」。若浏览器请求访问本地网络，请允许该站点访问。
5. 打开「我的标签」，点击「刷新列表」，就可以打开电脑刚保存的标签。

手机修改并保存后，电脑重新打开或刷新「我的标签」，再打开对应标签，即可加载新版本。若两台设备修改了同一旧版本，保存时会提示冲突；可以用「另存为」保留自己的版本，再重新打开最新标签。

地址要用服务器的真实内网 IP。手机上的 `localhost` 或 `127.0.0.1` 指的是手机自己，不能用它们连接电脑上的存储服务。

切换存储方式或用户会保留当前画布和原有标签库，不会自动迁移已有标签。需要迁移时，在原来的标签库导出全部标签的 JSON，切换到远程存储后再导入。字体、尺寸预设和打印机设置仍在各设备本地；自定义字体需要分别导入。

## 没有原来的模板，也能打开远程标签吗？

可以。保存的标签包含完整的尺寸、形状、出纸方向、密度、偏移以及画布对象等数据，不是只保存一个模板 ID。所以手机本地没有电脑创建标签时使用的尺寸模板，也能正常打开、编辑这个标签；以后修改或删除原模板，也不会改变已经保存的标签。

模板缺失只影响新建时复用该模板。目前尺寸模板和默认模板仍在各设备本地。自定义字体是单独的依赖，需要在各设备分别导入，否则文字外观可能不同。

## HTTP、HTTPS 与浏览器兼容性

可信内网可以直接使用上面的 HTTP 服务地址，无需给存储 API 配置证书。HTTP 会明文传输令牌和标签内容，因此不要将这个地址直接暴露到公网。

前端网页使用 HTTPS、存储服务使用内网 HTTP 时，浏览器会检查本地网络权限和混合内容策略。Chrome 142 起支持在获得局域网访问授权后访问私有 IP 的 HTTP 服务；其他浏览器或系统版本可能仍会阻止连接。应用允许填写该地址，并不代表所有浏览器都会放行。[Chrome 官方说明](https://developer.chrome.com/blog/local-network-access)

如果手机浏览器仍然拦截，可以按 [HTTPS 反向代理说明](README.md#use-from-a-phone-and-computer) 为存储 API 提供 HTTPS 地址，然后在两台设备上改填该地址。前端与 API 通过同一个 HTTPS 域名提供服务，可以减少跨来源和混合内容问题。

网页需要使用 Web Bluetooth 打印时，前端本身仍需要安全上下文，例如 HTTPS；普通的 `http://192.168.*` 网页不满足要求。[Web Bluetooth 安全要求](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API#security_considerations)

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 启动提示令牌未设置 | 在 `server/.env` 填好默认 token 或 JSON 用户配置；每个 token 至少 24 位非空白 ASCII 字符，建议使用生成的 64 位十六进制令牌 |
| 启动提示无法绑定 IP 或端口 | IP 必须属于 Docker 宿主机；端口不能被占用。修改 `.env` 后重新执行 `docker compose up -d` |
| 电脑连接成功，手机失败 | 检查手机 Wi-Fi、服务器 IP、防火墙、访客网络隔离和浏览器本地网络权限 |
| 两台设备均连接失败 | 先查看 `docker compose ps` 和日志，再检查服务地址与访问令牌；地址不含 `/api/v1` |
| 提示访问被拒绝，或浏览器显示跨域错误 | 检查令牌，以及 `NIIMBLUE_STORAGE_ORIGINS` 是否包含当前前端网页的完整来源 |
| 修改 `.env` 后设置未生效 | 执行 `docker compose up -d`，重新创建容器；仅执行 `restart` 不会应用新的环境变量 |
| 浏览器直接打开 API 地址显示 401 | API 需要 `Authorization` 请求头；浏览器地址栏没有这个令牌。应通过网页的「测试连接」验证 |
| 手机看不到电脑原来的本地标签 | 两端都切换到同一远程库；原本保存在浏览器中的标签需要手动导出、导入 |

停止服务（保留标签）：

```sh
docker compose down
```

代码更新后重建并启动（保留标签）：

```sh
docker compose up -d --build
```

数据库备份请参考 [SQLite 数据备份说明](README.md#use-from-a-phone-and-computer)。
