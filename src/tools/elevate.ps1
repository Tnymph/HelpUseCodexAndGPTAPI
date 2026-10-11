# 以管理员身份重新启动本项目的 .cmd 启动器（会弹出 UAC 确认框）。
# 用法：elevate.ps1 -CmdPath "E:\...\stop-gpt.cmd" -Arguments "--elevated"
param(
    [Parameter(Mandatory = $true)][string]$CmdPath,
    [string]$Arguments = ''
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $CmdPath)) { throw "启动器不存在：$CmdPath" }
if ($CmdPath -notlike '*.cmd') { throw '只允许提权重启 .cmd 启动器' }

$command = '"{0}" {1}' -f $CmdPath, $Arguments
Start-Process -Verb RunAs -FilePath 'cmd.exe' -ArgumentList @('/c', $command)
Write-Output 'elevated'
