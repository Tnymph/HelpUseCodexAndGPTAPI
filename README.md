注意，项目所有内容均来自DeepSeek4.1flash的许愿式生成
# HelpUseCodexAndGPTAPI —— ChatGPT 中国网络环境一键配置

本项目的目标：让 **ChatGPT 桌面软件** 在国内环境下**全程通过美国静态 IP** 使用，并提供"一键启动 / 一键关闭"两个程序。

## 快速开始

| 操作 | 双击 | 说明 |
|---|---|---|
| 开始使用 | `start-gpt.cmd` | 自动检查并配置网络代理（美国静态 IP）→ 打开 ChatGPT → 打印验证结果 |
| 结束使用 | `stop-gpt.cmd` | 关闭 ChatGPT → 关闭 Roxy → 关闭 Clash Verge → 清理系统代理 → 关闭项目窗口（会请求一次 UAC 提权） |

前置条件（本机已满足）：Node.js（v18+）、Clash Verge、Roxy Browser 及其中名为 `261011-1` 的窗口（美国静态 IP）。

## 工作原理（一句话版）

```
ChatGPT.exe / codex.exe
   │  （系统代理 + TUN 双通道）
   ▼
Clash Verge（规则：OpenAI 域名/进程 → 自定义节点 GPT-US-Static）
   ▼
roxynet 本地代理（Roxy 窗口 261011-1 的静态 IP 通道）
   ▼
美国静态 IP（实测 <美国静态IP> / New York / RCN）
   ▼
OpenAI
```

关键设计：Clash 的改造通过订阅**扩展文件**完成（`profiles\` 下 3 个槽位），订阅更新不会冲掉；程序每次运行都会做**幂等检查**，只有内容变化时才写文件并重启 Clash Verge。

## 目录结构

```
├─ start-gpt.cmd / stop-gpt.cmd      双击入口
├─ src\
│  ├─ config.js                      全部路径/端口/规则的集中配置
│  ├─ start.js                       程序A（启动与代理配置）
│  ├─ stop.js                        程序B（关闭与清理）
│  ├─ lib\                           clash-api / clash-profile / roxynet / apps / verify / ...
│  └─ tools\                         PowerShell 小工具（进程探测、系统代理通知、提权）
├─ skills\                           知识文档（00 总览 / 01 浏览器与Roxy / 02 ChatGPT桌面软件 / 03 ClashVerge / 04 地址清单 / 05 API充值调研 / 06 方案设计）
└─ state\                            运行时状态（锁、深度校验还原点）
```

## 关闭到底关掉了什么（重要）

- `stop-gpt.cmd` 会结束 ChatGPT（含 Codex 进程）、Roxy（窗口/主程序/roxynet）、Clash Verge（应用 + 内核）并**停止 `clash_verge_service` 服务**、清空系统代理 —— 之后网络完全回到直连（TUN 网卡也会消失）。实测终检：进程 0 / 端口全关 / TUN 消失 / 直连出口=国内 IP。
- 代价与说明：
  - 结束 Roxy 是**强制关闭**，浏览器数据不会同步回 Roxy 云端；窗口里刚做过重要操作时，建议先在 Roxy 托盘菜单点"退出"再运行本程序。
  - 服务被停后，**程序A 会自动用助手计划任务把它拉起来（不需要 UAC）**；该任务（`GPTProxy-StartClashService`）由程序B 在提权时注册一次，删掉它也不影响已经运行中的服务（可在任务计划程序里看到并删除）。
  - 程序B 需要管理员权限（要停服务），启动器会自动弹出 UAC；程序A 全程不需要管理员。
- 每次运行都会把完整日志写到 `state\logs\start-*.log` / `stop-*.log`（提权窗口里的输出也在其中）。

## 常用参数

```bat
node src\start.js --dry-run      :: 只检查、只汇报，不做任何修改
node src\stop.js  --dry-run      :: 同上
```

## 自定义

全部可调项在 `src\config.js`：
- 目标窗口名（`roxy.windowName`）、期望的静态 IP（`roxy.expectedStaticIp`，仅用于提示）
- 强制走美国静态 IP 的规则（`clash.rules`，默认：ChatGPT/Codex 进程 + OpenAI 域名 + 出口校验域名）
- **出口策略**（`clash.groupType`）：
  - `'select'`（**当前默认，严格模式**）：只允许美国静态 IP。组里只有静态节点，静态通道不通时 GPT 直接连不上，不会使用任何其它 IP；
  - `'fallback'`：静态 IP 优先，健康检查暂时不通时自动回退到订阅里的美国节点（可用性优先）。
- 关闭范围与自启守护开关（`flags.closeCodexProcesses` / `flags.guardChatGPTAutostart`）
- Clash 应用与 Roxy 的安装路径

## 排障

| 现象 | 处理 |
|---|---|
| GPT 连不上网（严格模式） | 说明静态 IP 通道不通。依次检查：Roxy 窗口 `261011-1` 是否打开、roxynet 是否在跑、Clash 是否在跑、Roxy 窗口自身能否上网；修好后重跑 `start-gpt.cmd` |
| "未找到 roxynet 代理口" | 确认 Roxy 窗口 `261011-1` 已打开；窗口打开时 roxynet 会自动运行 |
| "Clash 中未找到自定义节点" | 打开 Clash Verge → 订阅右键"重新载入"后重试；扩展文件在 `%APPDATA%\io.github.clash-verge-rev.clash-verge-rev\profiles\` |
| 节点测速失败 | 静态 IP 通道依赖 Clash 运行；也可能是 Roxy 窗口的上游代理临时不可用 |
| 实测出口不是美国 | 检查 Roxy 窗口的代理配置；日志：`%APPDATA%\RoxyBrowser\logs\` |
| 关闭程序提示权限不足 | 右键 `stop-gpt.cmd` → 以管理员身份运行 |
| 想恢复 ChatGPT 开机自启 | 任务管理器 → 启动 → ChatGPT → 启用 |

## 关于本仓库（公开版）

本仓库是公开版本，所有**本机私密参数**都已替换为占位符，包括：

- 美国静态 IP（`<美国静态IP>`）、Roxy 工作区 ID、上游代理用户名、指纹窗口 dirId
- 本机公网/直连出口 IP、本机用户名与主机名（`skills\` 文档中的占位符）

真实值保存在 **不提交** 的 `src/config.local.js` 里（见 `.gitignore`）。自己部署时：

```bat
copy src\config.local.example.js src\config.local.js
rem 然后编辑 config.local.js，填入你的窗口名 / 工作区 ID / 静态 IP
```

`skills\04-本机软件与文件地址清单.md` 里的路径与端口清单是本机实测快照，换机器后按同法核对即可。

## 安全说明

- 本程序只读写"本机自己的"配置：Clash 扩展文件（覆盖前自动备份为 `*.gptproxy-backup`）、系统代理注册表、ChatGPT 自启任务状态、以及项目自己的进程/窗口。
- `roxynet` 的代理凭据来自本机运行态探测（窗口目录 ID），不写入项目文件之外的位置。
- 详细知识与风险说明见 `skills\` 目录。
