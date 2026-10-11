# 03 · Clash Verge（Rev）知识：配置结构、命名管道 API 与自动化

> 对象：Clash Verge Rev（`io.github.clash-verge-rev.clash-verge-rev`），内核 verge-mihomo v1.19.31，Windows 服务模式（service mode）。本机实测 + 官方源码/文档。
> 标注约定：【实测】【源码】【官方文档】【未验证】。

## 摘要

1. **文件分工**：`verge.yaml` = 应用设置（源）；`config.yaml`/`clash-verge.yaml` = 应用生成的配置（每次 apply 重写，**不要手改**）；`profiles.yaml` = 订阅注册表（含每个订阅的 selected 节点记录）；`profiles\` 目录 = 订阅与"扩展文件"（节点/规则/代理组/扩展配置/脚本），**这是唯一可以安全编辑并在重新生成配置后生效的入口**。
2. **没有官方 CLI**：`clash-verge.exe` 不解析命令行参数，"静默启动"只能在应用设置里开（`enable_silent_start`）；开机自启用 Windows 计划任务实现。
3. **程序化控制的唯一通道**：内核在 **Windows 命名管道**上提供 Clash REST API：`\\.\pipe\verge-mihomo-<模式>-<哈希>`（本机为 `production-3de2e736…`）。**管道名含哈希，必须运行时枚举**；经管道访问**不校验 secret**。【实测：Node.js 用 `http.request({socketPath})` 可直接 GET /version、/proxies】
4. 常用端点：`GET /proxies`（看组当前选择 `now`）、`PUT /proxies/{组}`（body `{"name":"节点"}` 切节点，204 成功）、`GET /proxies/{节点}/delay?url=…`（测速）、`GET /connections`（看每条连接的实际链路 `chains` 与命中 `rule`）、`GET /configs`。
5. **持久化分流走"扩展文件 + 重新生成配置"**：把自定义节点写进 `profiles\pYSK1srNIfYO.yaml`（proxies 槽位）、把规则写进 `profiles\rQPkKclEsQ5L.yaml`（rules 槽位）、新建代理组写进 `profiles\gKPowEnXWzil.yaml`（groups 槽位）；改完需要应用**重新生成配置**（应用内任意 apply 操作，或**重启 Clash Verge 应用**——重启最省事且脚本可控）。订阅更新不会冲掉这些扩展内容。
6. **易错点**：只通过 API 切节点、不改扩展/记录时，Verge 在内核重启/切订阅时可能把选择恢复为 `profiles.yaml` 里的旧记录；应用托管字段（mixed-port、mode、tun.enable、external-controller 等）写进扩展会被丢弃；`enable_external_controller: false` 时 TCP 9097 不监听。

## 一、配置文件职责表（本机实测时间戳为证）

| 文件 | 职责 | 何时被重写 |
|---|---|---|
| `%APPDATA%\io.github.clash-verge-rev.clash-verge-rev\verge.yaml` | 应用设置（TUN/系统代理开关、端口、语言…） | 应用设置变更时整体回写（改它要关掉应用再改） |
| `…\config.yaml` | 应用生成的"模板配置" | 应用生成配置时 |
| `…\clash-verge.yaml` | **内核实际加载的运行时合并配置** | 每次 apply |
| `…\profiles.yaml` | 订阅注册表（current + items[] + selected） | 订阅操作/选择记录时 |
| `…\profiles\{uid}.yaml/.js` | 订阅本体与扩展文件（见下） | 用户编辑/应用生成时 |
| `…\cache.db` | 内核持久缓存（store-selected / store-fake-ip） | 内核运行时 |
| `…\logs\` | 应用日志（内核 stdout 在 `logs\service\`） | 持续 |

本机运行时要点（来自 `GET /configs`）：
```json
{ "mixed-port":7897, "mode":"rule", "tun":{"enable":true,"device":"Meta","stack":"gVisor","auto-route":true},
  "find-process-mode":"strict", "ipv6":true }
```
即：**TUN 已开启**（网卡 `Meta`，198.18.0.1/30），系统代理 `127.0.0.1:7897`，DNS fake-ip（监听 1053）。

## 二、命名管道 API（程序化控制核心）

### 2.1 发现管道名（必须动态）
本机实测 PowerShell 枚举：
```powershell
Get-ChildItem \\.\pipe\ | Where-Object { $_.Name -match 'mihomo' } | Select-Object -ExpandProperty Name
# → verge-mihomo-production-3de2e7369693c1a37623cf3760edd0647160b2352ca9bab8aa2de230f4931033
```
- 名字格式随模式变化：service 模式 = `production-<owner_key>`，sidecar 模式 = `sidecar-release-<owner_key>`；旧版本曾用裸名 `\\.\pipe\verge-mihomo`。**任何情况下都不要硬编码**。
- 另有一个 `\\.\pipe\clash-verge-service`（应用↔服务 IPC，非 API，不要用）。

### 2.2 通过管道发 HTTP（Node.js 实测可用）
```js
const http = require('http');
http.request({ socketPath: `\\\\.\\pipe\\${pipeName}`, path: '/proxies', method: 'GET',
               headers: { Host: 'localhost' } }, res => { /* 读 body */ }).end();
```
- 无需 `Authorization`（mihomo 文档：管道访问不校验 secret）。
- PowerShell 5.1 也可用 `NamedPipeClientStream` 手写 HTTP/1.0 请求（本机验证过）；注意 HTTP/1.1 会分块编码，解析麻烦，用 HTTP/1.0 更省事。

### 2.3 常用端点速查

| 操作 | 请求 | 备注 |
|---|---|---|
| 看所有组/节点与当前选择 | `GET /proxies` | 组对象里 `now` = 当前节点 |
| 切换选择 | `PUT /proxies/{组名}`，body `{"name":"节点名"}` | 路径里的组名要 UTF-8 URL 编码（emoji/中文必须）；成功 204 |
| 单节点测速 | `GET /proxies/{节点}/delay?url=https://www.gstatic.com/generate_204&timeout=5000` | 返回 `{"delay":ms}` 或失败信息 |
| 组内测速 | `GET /group/{组名}/delay?…` | 会清除手动固定 |
| 实际链路（验收神器） | `GET /connections` | 每条连接含 `chains`（如 `["🤖OpenAI","US-Static"]`）、`rule`、metadata（含进程名/域名）。注意：**连接关闭后即从列表消失**，要抓某次请求的分流证据必须"边发请求边轮询" |
| 运行中的规则 | `GET /rules` | 返回内核**当前真正加载**的全部规则（type/payload/proxy）；用于判断扩展文件是否已被内核加载 |
| 运行参数 | `GET /configs` | mixed-port/tun/mode/find-process-mode 等 |
| 改运行参数 | `PATCH /configs`（如 `{"mode":"global"}`） | 临时验证节点出口IP时可用，记得还原 rule |

本机代理组名（JSON 原文，供程序引用）：`🤖OpenAI`（emoji + "OpenAI"，**不是** `OpenAI`），组内成员 34 个（订阅节点）。OpenAI 流量规则：`RULE-SET,OpenAI,🤖OpenAI,no-resolve`（`ruleset\OpenAI.yaml` 含 `DOMAIN-SUFFIX,chatgpt.com` / `openai.com` / `oaistatic.com` / `oaiusercontent.com` / `DOMAIN-KEYWORD,openai` 等）。

## 三、扩展文件（持久化改动的正确姿势）

本机 `profiles.yaml` 已为当前订阅绑定 5 个扩展槽位（订阅右键"编辑规则/编辑节点/编辑代理组"生成）：

| 槽位 | 文件 | 结构 |
|---|---|---|
| 节点 (proxies) | `profiles\pYSK1srNIfYO.yaml` | `prepend: [] / append: [] / delete: []` |
| 规则 (rules) | `profiles\rQPkKclEsQ5L.yaml` | 同上 |
| 代理组 (groups) | `profiles\gKPowEnXWzil.yaml` | 同上 |
| 扩展配置 (merge) | `profiles\mLM6CxfGgW8v.yaml` | 合并式（可写 `find-process-mode: always` 等） |
| 扩展脚本 (script) | `profiles\sW4VvSpbtcgP.js` | `function main(config, profileName){ return config }` |

要点：
- **清单/标量整体替换，嵌套对象逐键合并**；写进"应用托管字段"（`mixed-port`、`mode`、`allow-lan`、`tun.enable`、`external-controller`、`secret`、`log-level`、`ipv6`…）会被丢弃。
- 生效需要"重新生成配置"：应用内任意 apply 操作，或**重启应用**。（核心 API 不能触发生成。）
- 订阅自动更新（本机 1440 分钟）会重新生成配置，但**扩展内容不会被冲掉**。

示例（本项目将写入的形态，具体见 06 方案）：

```yaml
# profiles\pYSK1srNIfYO.yaml（节点槽位）
prepend:
  - name: GPT-US-Static
    type: socks5
    server: 127.0.0.1
    port: 56632                # roxynet 动态端口，程序A运行时写入实际值
    username: <窗口dirId>   # = dirId
    password: <窗口dirId>
    udp: true
append: []
delete: []
```

```yaml
# profiles\rQPkKclEsQ5L.yaml（规则槽位；自上而下首条命中）
prepend:
  - PROCESS-NAME,ChatGPT.exe,GPT-US
  - PROCESS-NAME,Codex.exe,GPT-US
  - PROCESS-NAME,codex.exe,GPT-US
  - DOMAIN-SUFFIX,chatgpt.com,GPT-US
  - DOMAIN-SUFFIX,openai.com,GPT-US
  - DOMAIN-SUFFIX,oaistatic.com,GPT-US
  - DOMAIN-SUFFIX,oaiusercontent.com,GPT-US
append: []
delete: []
```

## 四、启动 / 关闭 / 状态

- **启动**：直接运行 `E:\Clash Verge\clash-verge.exe`。应用启动后会自动按 `verge.yaml` 恢复 TUN 与系统代理（本机均为 true），并请求服务拉起内核。【实测：内核以服务身份运行，owner=SYSTEM】
- **没有 --silent 参数**；`enable_silent_start: true` 可静默启动（本机当前 false，启动会显示窗口）。
- **内核/服务**：Windows 服务 `clash_verge_service`（Automatic）；`verge-mihomo.exe` 由服务拉起（**SYSTEM 身份 → 结束它需要管理员权限**）。
- **关闭（脚本化）的可靠顺序**（程序B采用，2026-10-11 实测修正）：
  1. 先清系统代理注册表（`ProxyEnable=0`）+ 通知（见下），避免内核死后系统代理指向死端口导致浏览器断网；
  2. `taskkill /F /IM clash-verge.exe`（应用是托盘程序，普通关闭只会最小化）；
  3. **`Stop-Service clash_verge_service`（需管理员）—— 内核会随服务一并结束**；这一步才是"真正关掉代理"的关键：
     - 实测「只杀内核 `taskkill /IM verge-mihomo.exe`」**会被服务自动拉起**（观察到内核 PID 变化），所以单杀内核不算关闭；
     - 只杀内核在 SYSTEM 身份下还可能被拒绝；即使提权也建议直接停服务，最省事；
     - 兜底手段：一个启用 `SeDebugPrivilege` 后再 `Stop-Process` 的脚本（本仓库 `src\tools\kill-system-process.ps1`）。
  4. 验证：7897 不再监听、`Meta` 网卡消失、系统代理已关闭（Clash 退出动作可能把系统代理改回开启，需再清一次）。
- **重启服务会立刻把内核拉回来**（实测：Start-Service 后数秒内核就跑起来、端口恢复监听）。因此程序B 停服务是有代价的：下次要用代理时得有人把服务启动回来。
- **免 UAC 恢复服务的小技巧**：由提权的一方注册一个"最高权限"的计划任务（`New-ScheduledTaskPrincipal -RunLevel Highest`），之后非管理员程序用 `schtasks /run /tn <任务名>` 就能触发它启动服务。本项目用任务名 `GPTProxy-StartClashService`（程序B 创建、程序A 使用），这样程序A 全程不需要管理员权限。
- **系统代理注册表**：
  ```powershell
  $k='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  Set-ItemProperty $k ProxyEnable -Type DWord -Value 0        # 关
  # 开：ProxyEnable=1 + ProxyServer='127.0.0.1:7897'
  # 通知（P/Invoke）：InternetSetOption(0, 39=SETTINGS_CHANGED) + (0, 37=REFRESH)
  ```

## 五、自动化坑位清单

0. **"写盘 ≠ 生效"（本项目踩过的最大的坑）**：把扩展文件写好后，如果只重启/不重启应用而内核没重新加载配置，内核里跑的仍是旧规则（`profiles.yaml` 与扩展文件都变了，但 `GET /rules` 里看不到你的规则）。→ 程序必须先 `GET /rules` 核对"运行中的规则"，缺了就重启 Clash 应用；重启后再核对一次。
0b. **不要在"全局模式"下把 GLOBAL 指向本项目节点来测出口 IP**：本项目节点（经 roxynet）访问上游静态 IP 时需要以本机系统代理（Clash 自己）做跳板，全局模式下这条跳板流量又会被指回本项目节点 —— **形成回环**，表现为长时间卡住/超时。正确的出口校验方式：给一个专用域名（本项目用 `ipinfo.io`）加一条 `DOMAIN-SUFFIX,...,本项目组` 的规则，然后经规则路径请求它。
1. **选择回滚**：`selected` 记录在 `profiles.yaml`；内核重启/切订阅时 Verge 会恢复记录。→ 本项目把分流固化在**扩展文件**里，不依赖动态选择。
1b. **fallback 组的切换延迟**：Clash 重启后 fallback 组对成员的健康检查还没跑完，可能先选中第二个节点；本项目在确认首选节点可用后会主动调用 `GET /group/{组}/delay` 触发一次健康刷新，让它尽快切回首选。已建立的旧连接**不会**改道（连接级路由），只有新连接走新节点。
2. **不要手改** `config.yaml`/`clash-verge.yaml`（会被覆盖）；`verge.yaml` 只能在应用关闭时改。
3. **订阅更新**会重新生成配置并重载内核（扩展内容保留），更新后程序A的"幂等检查"会兜底。
4. **TUN 需要服务模式或管理员**（本机已是服务模式）。
5. **进程规则**（`PROCESS-NAME`）在 Windows 由内核按连接表反查 PID 实现；`find-process-mode: strict` 时"按需查找"。TUN 入站连接的进程反查在服务模式下一般可用；若发现进程规则不生效，可在扩展配置里改 `find-process-mode: always` 再验证（本机 `strict`）。
6. `enable_external_controller: false` → 不要指望 TCP 9097；要用 TCP 控制器得在 UI 打开该开关（可能需重启），本项目不需要（走管道）。

## 总结

1. 控制 Clash = **枚举管道 → 在管道上发 Clash REST API**（免 secret）；切组用 `PUT /proxies/{组}`，验收用 `GET /connections` 的 `chains`。
2. 持久化配置 = **扩展文件（节点/规则/组）+ 重启应用"重新生成配置"**；应用托管字段勿写。
3. 程序A的代理准备顺序：确认应用在跑（否则启动）→ 写/刷新扩展文件（节点端口/凭据变了才写）→ 需要时重启应用 → 等 7897 监听 + TUN 网卡出现 + 系统代理注册表正确 → API 验证节点可用。
4. 程序B的代理拆除顺序：清系统代理并通知 → 杀应用 → 杀内核（管理员）→ 验证网络回到直连。
