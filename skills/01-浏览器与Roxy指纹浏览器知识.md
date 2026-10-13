# 01 · 浏览器知识：Chromium/Electron 代理机制 + Roxy 指纹浏览器

> 适用范围：一切"浏览器相关的网络/代理知识"，包括本项目里 Roxy Browser 的内部结构与静态 IP 复用方法。
> 标注约定：【实测】= 在本机验证过；【源码】= 从官方仓库/二进制分析得到；【未验证】= 只有第三方信息或推断。

## 摘要

1. **Chromium/Electron 系浏览器在 Windows 上跟随系统代理（WinINET）**，并且监视注册表变化（改完注册表即生效，不用重启浏览器）；`--proxy-server` 命令行开关可覆盖系统代理、优先级更高；**`HTTP_PROXY/HTTPS_PROXY` 环境变量在 Windows 上对 Chromium 无效**（只对 Linux/macOS 有效）【源码 + 官方文档】。
2. **Roxy Browser = Electron 外壳（RoxyBrowser.exe）+ 补丁版 Chromium（RoxyChrome.exe，代号 lumi）+ 本地代理组件（roxynet.exe）**。每个"指纹窗口"的代理不是用 `--proxy-server` 注入的，而是写进加密文件 `lumi.conf`，由补丁内核自己读取【源码 + 实测解密】。
3. **roxynet 是一个本地混合代理（HTTP+SOCKS5 同端口），并且可以被本机任意程序复用**：`http://<dirId>:<dirId>@127.0.0.1:<roxynet端口>` 实测出口 = 窗口 `261011-1` 的美国静态 IP `<美国静态IP>`【实测】。这是本项目"让 ChatGPT 走美国静态 IP"的核心通道。
4. 关键动态值：**roxynet 端口是动态分配的（本机当前 56632）**，dirId 是每个窗口固定的 32 位十六进制串（窗口 `261011-1` = `<窗口dirId>`）。两者都能程序化获取，**禁止硬编码端口**。
5. 附带风险：roxynet 监听在 `0.0.0.0`（局域网内其他设备可借用出口）；上游代理账号密码会明文打印在 Roxy 日志里；Roxy 的 `config.json` 与 `lumi.conf` 都使用硬编码密钥加密（可被本机程序解密，不要把这两台目录同步到云盘）。

## 一、Chromium / Electron 的代理机制（通用知识）

### 1.1 代理配置来源与优先级（Windows）

| 层级 | 说明 |
|---|---|
| 企业策略 | 组策略设置的 ProxySettings 会**强制**并忽略命令行参数（本项目不涉及） |
| 命令行 | `--proxy-server=<scheme>://host:port`（覆盖系统设置；不支持用户名密码；可按协议分别指定） |
| 系统设置 | 默认路径。Chromium 读取 WinINET（`HKCU\...\Internet Settings`）的代理配置 + PAC/WPAD |
| 环境变量 | Windows 上**不支持** `HTTP_PROXY` 等（这是 Linux/macOS 的机制） |

要点：
- **改了注册表系统代理，Chromium 系程序会自动跟随**（Chromium 内部对该注册表键做了变更监视），无需重启应用。
- `--proxy-bypass-list` 只在同时给了 `--proxy-server` 时才有意义。
- Electron 应用若自行调用 `session.setProxy()` 会覆盖以上一切（本机 ChatGPT 应用**没有**这么做【实测：扫描 app.asar 无 setProxy/proxy-server】）。

### 1.2 与 Microsoft Store（MSIX）应用的关系

- 若应用是 **full-trust 打包应用**（`Windows.FullTrustApplication` / `mediumIL`），则**不受 AppContainer 回环（loopback）限制**，可以直连 `127.0.0.1:7897` 这类本地代理，无需 `CheckNetIsolation LoopbackExempt`【官方文档 + 实测：豁免列表为空】。
- 只有真正的 UWP/AppContainer 应用才需要回环豁免。
- 打包应用**无法方便地追加命令行参数**（`shell:AppsFolder` 激活不支持传参），所以对 Store 版应用，"让浏览器层走代理"的现实手段就是**系统代理 + TUN**。

### 1.3 如何验证某个应用实际从哪个 IP 出网

- 经本地代理强制验证：`curl.exe -s -x http://127.0.0.1:7897 https://ipinfo.io/json`（curl 不读系统代理，必须显式 -x）。
- 直连/被 TUN 接管：`curl.exe -s https://api.ipify.org`。
- 稳定 IP 回显端点：`https://api.ipify.org`（纯 IP）、`https://ipinfo.io/json`（含城市/ASN）、`https://www.cloudflare.com/cdn-cgi/trace`（loc/colo）。
- 判断"某进程走没走本地代理"：`Get-NetTCPConnection` 看该 PID 是否连着 `127.0.0.1:7897`；TUN 模式下所有连接都归 mihomo，需用 Clash 的 `/connections` 或 IP 对比判断。

## 二、Roxy Browser 结构（本机 4.0.7）

```
E:\RoxyBrowser\RoxyBrowser.exe            # Electron 外壳（主窗口 = 账号/窗口管理/设置）
  ├─ 本地服务 :::45535 (HTTP) / :::45536 (WS)     # 界面 SPA + 内部接口(/api, /tunnel)
  ├─ %APPDATA%\RoxyBrowser\chrome-bin\154\RoxyChrome.exe   # 每个指纹窗口一个实例
  │     └─ --user-data-dir=<缓存根>\<dirId>   # 本机 2026-10-13 起缓存根 = E:\BrowserCache（原 %APPDATA%\RoxyBrowser\browser-cache）
  │           └─ lumi.conf   # 指纹 + 代理（加密）
  └─ %APPDATA%\RoxyBrowser\roxynet-bin\roxynet.exe          # 本地代理前哨
        ├─ :::56632  混合代理口（HTTP CONNECT + SOCKS5，需用户名=密码=dirId 认证）
        └─ :::56634  控制接口（/set_proxy、/del_proxy、/set_sysproxy）
```

### 2.1 每个窗口的代理如何生效

1. 窗口打开时，Electron 主进程把"该窗口的出口代理"登记到 roxynet（内部表：`dirId -> 上游代理`）。
2. 同时把 `fproxy` 写进该窗口的 `lumi.conf`：**ROXYNET 模式**下为
   `{"type":"socks5","host":"127.0.0.1","port":<roxynet端口>,"username":"<dirId>","password":"<dirId>"}`【实测解密】。
3. 补丁内核 RoxyChrome 读取并解密 `lumi.conf`，把代理应用到自己的网络栈（同时应用指纹、时区 America/Los_Angeles、en-US 等）。

### 2.2 roxynet 的上游链路（重要）

窗口 `261011-1` 的实际链路（Roxy 日志原文）：

```
[tunnel] Proxy chain created: socks5://<上游代理用户名>:***@<美国静态IP>:5782 -> http://127.0.0.1:7897 -> direct
```

即：**roxynet → (经本机系统代理 Clash 7897 做跳板) → 上游 socks5 美国静态 IP `<美国静态IP>:5782` → 目标网站**。
由此推出两条重要结论：
- 静态 IP 通道**依赖 Clash Verge 运行**（Clash 退出时该通道可能不通，【未验证】，程序A会先验证再继续）。
- 该通道的出口 = `<美国静态IP>`（US / New York / RCN），实测 `ipinfo.io` 一致。

### 2.3 解密 `lumi.conf`（程序化读取窗口信息）

- 文件格式：`base64(密文‖GCM认证标签)`；算法 `AES-256-GCM`；
- 密钥（ASCII）：`402ead7d23b43b6d1e0528d4f99c59bd`；IV（ASCII 12 字节）：`3a105229aa31`【源码：chrome.dll 内硬编码，实测可解密】；
- 解密后 JSON 关键字段：`windowName`（窗口名，如 `261011-1`）、`fproxy`（代理）、`timeZone`、`appLocale`、`geoLocation`、大量指纹字段。
- **用途**：靠它做 "窗口名 → dirId" 的映射（`dirId` = 该文件所在目录名）。

### 2.4 复用 roxynet 给本机其它程序（本项目核心）

```bash
# HTTP 代理形式（实测）
curl -x "http://<窗口dirId>:<窗口dirId>@127.0.0.1:56632" https://ipinfo.io/json
# 返回 "ip":"<美国静态IP>","city":"New York City","country":"US","org":"AS6079 RCN"
```

- 该用法**没有官方文档**（官方文档只讲"把外部代理填进 Roxy"，没有"把 Roxy 代理拿出来用"）。
- 前提：**该窗口必须处于打开状态**（dirId 条目只在 roxynet 内存里；关窗即失效，返回 502），且 roxynet/Clash 在运行。
- 若要长期稳定，建议在 Roxy 界面开启官方本地 API（`API → API配置`，默认端口 50000，请求头 `token`），通过 `/browser/open` 打开窗口、`/browser/close` 关窗，实现可控的开关。
- 安全提醒：同局域网任何设备可借用该出口（0.0.0.0 监听 + 凭据可从目录名推出）。

### 2.4b 程序化开关窗口的可靠性（实测经验）

- **识别"窗口是否已打开"要用 dirId，不要只看窗口标题**：指纹窗口的标题由页面决定，可能被改写/瞬时为空——本机实测出现过标题读不到、但窗口其实一直开着的情况。可靠做法：从 RoxyChrome **主进程**（命令行不含 `--type=`）的 `--user-data-dir=<缓存根>\<dirId>` 解析出 dirId（只看结尾的 32 位十六进制目录名，**不依赖缓存根路径**——Roxy 把缓存改到 E:\BrowserCache 后仍可识别）。
- **未文档化 CLI 的局限**：`RoxyBrowser.exe --roxy-action launch-browser --dir-id <dirId> --workspace-id <wid>` 在"主程序已经在运行"时是以 second-instance 方式送达，实测**不稳定**（日志里能看到 argv 被错误解析，窗口不一定打开）。可靠场景是"用 CLI 作为主程序的首次启动参数"。窗口确实关着时，程序会尝试它；仍失败则提示用户手动打开，或建议开启 Roxy 本地 API（官方 50000 端口的 `/browser/open`）。

### 2.4c 建链时机（实测踩坑）：roxynet 的"上游跳板"依赖当时的系统代理

- roxynet 建"上游跳板链路"时（日志 `Added system proxy to chain: http://127.0.0.1:7897`）会用到**当时的系统代理**；如果窗口/roxynet 启动时系统代理是关的（或 Clash 没在跑），链路会退化成"直连上游"——而国内直连美国静态 IP 的中转端口通常不通，表现为 **roxynet 对 CONNECT 一律回 502**（认证正常、但隧道建不起来）。
- 结论：**必须先让 Clash + 系统代理就绪，再启动 Roxy / 打开窗口**。程序A 已按此排序；若发现通道不通，程序A 会**自动重启 Roxy**（结束全部进程 → 带窗口参数重启 → 重新探测 roxynet 端口）来重建链路，实测有效。
- 另一处相关坑：**端口会变**（同一台机器多次会话实测出现 56632 / 62791 / 49443 / 61337），任何地方都不要硬编码；roxynet 重启后旧窗口的 `lumi.conf` 会指向旧端口而失效，所以"重建链路"要连窗口一起重启。

### 2.5 Fast 事实：Roxy 的本地 HTTP 接口（45535）

- `/tunnel/report_proxy_server?port=<n>`、`/tunnel/report_local_http?port=<n>`：roxynet 启动后向主进程上报端口用，**无鉴权**。【实测：调用后日志出现 `report_proxy_server 56632`】
- 主窗口关闭按钮 = 最小化到托盘（`closeSoft="min"`）；**真正退出** = 托盘菜单"退出"（会把窗口数据同步回服务器，再杀子进程）。
- 强制杀进程会**跳过数据同步**，可能导致窗口数据未落云 + 残留 lockfile；不得已时建议顺序：关窗 → `taskkill /F /IM RoxyChrome.exe /T` → `taskkill /F /IM RoxyBrowser.exe` → `taskkill /F /IM roxynet.exe`。

## 三、浏览器侧与本项目相关的其它结论

- Microsoft Store 版 ChatGPT 应用（Electron）**跟随系统代理**，与普通浏览器一致；它另有 Rust 后端进程（`codex.exe`）**不跟随**系统代理，需靠 TUN 兜底（详见 02 文档）。
- 用 Roxy 的静态 IP 窗口访问 OpenAI 平台（`platform.openai.com`）是用户既定用法；本项目让桌面版 GPT 软件共享同一静态 IP，保持"账号环境一致性"（同一 IP、同一区域），降低风控不确定性。

## 总结

1. Chromium/Electron 在 Windows 上：**系统代理是默认通道，注册表改完即生效，env 变量无效**。
2. Roxy 的静态 IP 可以通过 **roxynet 本地代理口（动态端口 + dirId:dirId 认证）**被本机其它程序复用，**已实测**，出口即 `<美国静态IP>`。
3. 程序化信息获取：窗口名↔dirId 用 `lumi.conf` 解密或 `--user-data-dir` 命令行参数；roxynet 端口必须运行时枚举，不能硬编码。
4. 该通道依赖"窗口打开 + roxynet 活着 + Clash 活着"；程序按这个顺序做前置检查与友好报错（见 06 方案文档）。**本项目当前采用严格模式（`select` 组只含静态节点）：通道不通时 GPT 直接不可用，绝不换用其它 IP**；如需可用性优先，可在 `src\config.js` 把 `clash.groupType` 改为 `'fallback'` 加美国节点兜底。
5. 安全提示：roxynet 监听全网卡、凭据可推导、日志含上游账号密码、加密密钥硬编码 —— 这些目录不要外传/同步。
