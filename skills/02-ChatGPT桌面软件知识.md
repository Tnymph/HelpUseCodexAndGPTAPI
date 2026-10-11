# 02 · ChatGPT 桌面软件（Microsoft Store MSIX）知识

> 对象：开始菜单名为 **ChatGPT** 的桌面应用（包名 `OpenAI.Codex`，即桌面版 ChatGPT + Codex 客户端）。本机版本 `26.1007.2314.0`。
> 标注约定：【实测】=本机验证；【源码】=上游仓库/二进制分析；【未验证】=社区信息。

## 摘要

1. **它在哪**：Microsoft Store（MSIX）应用一律装在 `C:\Program Files\WindowsApps\<PackageFullName>`。本机 = `C:\Program Files\WindowsApps\OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0\`，主程序 `app\ChatGPT.exe`【实测】。
2. **怎么启动**：必须走"包身份"启动：`explorer.exe "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"`。**直接运行包内 exe 会丢失 package identity**，导致沙箱服务/协议/执行别名/授权/数据重定向异常【官方文档】。
3. **怎么关闭**：`taskkill /IM ChatGPT.exe /T /F`（连带 `Codex.exe`、`codex.exe` 等子进程）；托盘应用 `CloseMainWindow()` 不一定真退出。包内还注册了 Windows 服务 `CodexSandboxService.OpenAI.Codex`（常驻，与应用是否在跑无关）。
4. **代理行为（本项目最关键）**：应用是"三层"结构 —— Electron 前端（跟随 Windows 系统代理✅）、Rust 后端 `codex.exe`（**默认忽略系统代理**⚠️）、本地沙箱服务。因此**必须开启 TUN 模式**（网络层兜底）才能保证"全程走代理、不泄漏真实 IP"；备选方案是 `%USERPROFILE%\.codex\config.toml` 写入 `[features] respect_system_proxy = true` 或设置 `HTTPS_PROXY/HTTP_PROXY/ALL_PROXY` 环境变量（仅对 Rust 后端有效）。
5. **Loopback 限制不适用**：它是 full-trust 打包应用（mediumIL），可直接访问 `127.0.0.1:7897` 的本地代理，**不需要** `CheckNetIsolation LoopbackExempt`【官方文档+实测】。
6. **已知坑**：系统代理/TUN 下 Remote Control WebSocket 偶发超时（社区 issue）；应用自带沙箱网络代理占用 127.0.0.1:3128/8081，与"向进程注入代理环境变量"会互相干扰；地区校验（中国大陆/香港/澳门不支持）会导致登录/接口报 `unsupported_country_region_territory`。
7. **开机自启**：包内声明的 StartupTask 注册表状态为 `State=1`，**含义是"用户已禁用"**（取值表：0=Disabled，1=DisabledByUser，2=Enabled，3=DisabledByPolicy，4=EnabledByPolicy；本机 `LastDisabledTime=2026-10-11 11:25:51` 是"被关闭过"的直接证据）。也就是说它目前**不会**开机自启 —— 这正是我们要的状态；程序A每次运行都会校验，若发现被改回"启用"（State=2/4）会自动置回"用户禁用"。

## 一、安装位置与包信息

| 项 | 值 |
|---|---|
| 安装根目录 | `C:\Program Files\WindowsApps\`（普通用户**可读包子目录**，根目录枚举需管理员） |
| 本机包目录 | `C:\Program Files\WindowsApps\OpenAI.Codex_26.1007.2314.0_x64__2p2nqsd0c76g0\` |
| 主程序 | `...\app\ChatGPT.exe`（Electron 壳） |
| 其它可执行文件 | `app\Codex.exe`、`app\resources\codex.exe`（Rust CLI）、`app\resources\codex-command-runner.exe`、`codex-windows-sandbox-service.exe`、`codex-computer-use.exe`、`chrome_proxy.exe`、`notification_helper.exe` 等 |
| 权限 | 包目录只读 + TrustedInstaller 保护；**绝不要改其权限**（篡改后 Windows 会拒绝启动该应用） |

查询命令（PowerShell）：
```powershell
Get-AppxPackage OpenAI.Codex | Select Name,PackageFullName,Version,InstallLocation,Status
(Get-AppxPackage OpenAI.Codex | Get-AppxPackageManifest).Package.Applications.Application
Get-StartApps | Where AppID -like '*OpenAI.Codex*'      # 查 AUMID
```

## 二、启动、检测、关闭

### 启动（带包身份）
```cmd
explorer.exe "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
:: 或
start "" "shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App"
```
- 三种等价写法（explorer / start / Start-Process）都经 Shell 激活，**无法传命令行参数**；`shell:AppsFolder` 字符串里的 `!` 在 cmd 的 delayed expansion 下会被吃掉（本项目的 .cmd 启动器已规避）。
- 重复激活 = 唤起已运行实例（单实例行为，正常）。

### 检测运行状态
```powershell
Get-Process | Where-Object { $_.Path -like 'C:\Program Files\WindowsApps\OpenAI.Codex*' } | Select Id,ProcessName,Path
Get-Process ChatGPT,Codex -ErrorAction SilentlyContinue
Get-Service CodexSandboxService.OpenAI.Codex     # 服务常驻，不代表应用在使用
```

### 关闭
```powershell
Get-Process ChatGPT -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }  # 温和
taskkill /IM ChatGPT.exe /T /F          # 兜底强杀（含子进程）
taskkill /IM Codex.exe /T /F            # 视需要
```
- 沙箱服务不随应用停止（要停需管理员 `Stop-Service CodexSandboxService.OpenAI.Codex`，一般不必）。

## 三、目录与配置（代理配置的落点）

| 路径 | 内容 |
|---|---|
| `%USERPROFILE%\.codex\config.toml` | **Codex 后端配置**（可放 `[features] respect_system_proxy = true`） |
| `%USERPROFILE%\.codex\auth.json` | 登录凭据 |
| `%USERPROFILE%\.codex\.sandbox\`、`sessions\`、`logs_2.sqlite` 等 | 运行时数据 |
| `%LOCALAPPDATA%\OpenAI\Codex\` | 程序运行库（`runtimes\`、Codex CLI `bin\<hash>\codex.exe`） |
| `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Codex` | Electron userData（Roaming 写入被 MSIX 虚拟化到此） |
| `HKCU\Software\Classes\Local Settings\...\AppModel\SystemAppData\OpenAI.Codex_2p2nqsd0c76g0\App\State` | 开机自启任务状态（`1`=**用户禁用**，`2`=启用；注意与直觉相反，勿凭字面猜） |

## 四、网络/代理行为详解（三层结构）

```
┌ ChatGPT.exe（Electron/Chromium 前端）── 跟随 Windows 系统代理（WinINET），无需配置
├ codex.exe / Codex.exe（Rust 后端）  ── 默认【不使用】系统代理：
│       · 读环境变量 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/NO_PROXY（大小写均可）
│       · 或 config.toml: [features] respect_system_proxy = true（实验性开关，默认关闭）
│       · 该开关默认关闭是官方仓库事实（feature: stage=UnderDevelopment, default=false）
└ CodexSandboxService（Windows 服务）── 本地沙箱；自带网络代理端口 3128(HTTP)/8081(SOCKS5)
```

推论与对策（本项目采用）：
1. **TUN 模式是唯一"应用无关"的兜底**：网络层接管，Electron 层、Rust 层、子进程全都进代理，不会泄漏。
2. 备选/加固（可选，不默认改动）：
   - `config.toml` 增加 `[features] respect_system_proxy = true`；
   - 或给应用进程树设 `HTTPS_PROXY=http://127.0.0.1:7897`（注意：Shell 激活的 Store 应用 env 继承不可靠，且会影响沙箱代理，需配套 `[shell_environment_policy] exclude` 排除代理变量）。
3. **地区校验**：出口 IP 必须落在 OpenAI 支持地区（美国✅、日本/新加坡/台湾也可；香港/澳门/大陆❌）。登录走两段 OAuth，第二段 token 交换由客户端自己发起——**没走代理就会暴露真实 IP**，所以必须 TUN/系统代理双保险。

## 五、已知问题（2025–2026，社区/上游）

1. **无显式代理设置**：官方 issue #34488（"Add explicit proxy support to the ChatGPT desktop app"）仍开放。
2. **Remote Control WebSocket 超时**（#38768）：系统代理/TUN 下 `wss://chatgpt.com/backend-api/...` 报 `os error 10060`；部分版本对进程注入 env 变量后可解。
3. **沙箱代理端口冲突**：应用内置代理占 3128/8081（manifest 里 firewallRules 也声明了这两个端口段）；若全局注入代理环境变量会与沙箱 setup 互踩（`setup_marker.json` 的 `proxy_ports` 反复刷新、防火墙弹窗）。Windows 上启用沙箱网络代理要求"elevated 沙箱"（本机 config.toml 已是 `[windows] sandbox = "elevated"`）。
4. **自定义 CA/TLS 拦截**：新版支持 `CODEX_CA_CERTIFICATE`（PEM）；Chromium 侧用 Windows 证书存储。本项目用普通代理（非 MITM），不涉及。
5. **开机自启**：若 StartupTask 处于启用状态（State=2/4），开机即启动应用；此刻代理可能未就绪，会造成"直连出口"的第一次登录风险。本机当前为"用户禁用"（State=1），且程序A会持续守护这个状态。

## 总结

1. 启动 = `shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App`；关闭 = `taskkill /IM ChatGPT.exe /T /F`（+ Codex.exe/codex.exe）；不要直接跑包内 exe，不要动包目录权限。
2. 代理必须"双通道"：系统代理（喂 Electron）+ TUN（喂 Rust 后端与一切子进程）；本机 TUN 已开，程序A负责验证。
3. 出口地区必须美国 —— 本项目用"美国静态 IP 通道"覆盖 OpenAI 域名/进程（见 06 方案）。
4. 自启任务是"全程静态IP"的漏洞点，建议关闭（程序A处理）。
