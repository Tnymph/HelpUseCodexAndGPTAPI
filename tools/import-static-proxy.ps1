<#
  从"服务商导出的代理凭据文件"导入静态 IP 代理账号/密码到 Windows 用户环境变量。
  文件格式（每行一条，取第一条有效行）：IP:端口:用户名:密码

  导入后 src\config.local.js 通过 $env:GPT_PROXY_USER / $env:GPT_PROXY_PASSWORD 读取，
  凭据不写入任何源码/配置文件（新开的窗口才会读取到新变量；已开着的 cmd 需要重开）。

  用法：
    powershell -ExecutionPolicy Bypass -File tools\import-static-proxy.ps1 -File "C:\path\to\proxies.txt"
#>
param(
  [Parameter(Mandatory = $true)][string]$File
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $File)) { throw "文件不存在：$File" }

$line = (Get-Content -LiteralPath $File |
  Where-Object { $_ -match '^\s*\d{1,3}(\.\d{1,3}){3}\s*:\s*\d+\s*:\s*[^:\s]+\s*:\s*.+$' } |
  Select-Object -First 1)
if (-not $line) { throw '没找到形如 IP:端口:用户名:密码 的行' }

# 按前 3 个冒号切分，密码里若含冒号也能保留
$parts = $line.Trim().Split(':', 4)
if ($parts.Count -lt 4) { throw '字段不足（需要 IP:端口:用户名:密码）' }
$ip = $parts[0].Trim()
$port = [int]$parts[1].Trim()
$user = $parts[2].Trim()
$pass = $parts[3].Trim()

# 只接受公网 IPv4（拒绝回环 / 私有 / 链路本地 / CGNAT / 保留地址）
$b = @($ip.Split('.') | ForEach-Object { [int]$_ })
if ($b.Count -ne 4 -or ($b | Where-Object { $_ -lt 0 -or $_ -gt 255 })) { throw "IP 格式不对：$ip" }
$isNonPublic =
  ($b[0] -eq 0) -or ($b[0] -eq 10) -or ($b[0] -eq 127) -or ($b[0] -ge 224) -or
  ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or
  ($b[0] -eq 192 -and $b[1] -eq 168) -or
  ($b[0] -eq 169 -and $b[1] -eq 254) -or
  ($b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127)
if ($isNonPublic) { throw "拒绝：$ip 不是公网地址" }
if ($port -lt 1 -or $port -gt 65535) { throw "端口不合法：$port" }

[Environment]::SetEnvironmentVariable('GPT_PROXY_USER', $user, 'User')
[Environment]::SetEnvironmentVariable('GPT_PROXY_PASSWORD', $pass, 'User')

Write-Host ("已导入用户环境变量：server={0}:{1}  用户名={2}  密码长度={3}" -f $ip, $port, $user, $pass.Length)
Write-Host '提示：重开 start-gpt.cmd 的窗口后生效；若之后更换了密码，重新运行本脚本即可。'
