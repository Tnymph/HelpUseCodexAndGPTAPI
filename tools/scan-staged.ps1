<#
  提交前脱敏扫描（由 .githooks/pre-commit 调用；也可手动运行：powershell -File tools\scan-staged.ps1）
  检查两件事：
    1) 被 .gitignore 忽略的文件被强行加入暂存区（例如 src\config.local.js、state\ 下文件）；
    2) 暂存的新增内容 / 文件名里出现敏感值（敏感值从 src\config.local.js 与机器环境变量自动收集）。
  命中即退出码 1（拒绝提交）；确属误报时用 git commit --no-verify 跳过。
#>
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$repoRoot = Split-Path -Parent $PSScriptRoot
$mask = { param($v) if ($v.Length -le 4) { $v.Substring(0, 1) + '***' } else { $v.Substring(0, 4) + '***' } }

# ---------- 收集敏感值 ----------
$values = New-Object 'System.Collections.Generic.List[string]'
$sensitiveKey = '(?i)(ip|host|user|pass|token|secret|credential|account|id)'
$cfgFile = Join-Path $repoRoot 'src\config.local.js'
if (Test-Path -LiteralPath $cfgFile) {
  $raw = [IO.File]::ReadAllText($cfgFile)
  $raw = [Regex]::Replace($raw, '/\*[\s\S]*?\*/', ' ')
  $raw = [Regex]::Replace($raw, '(^|[^:])//[^\r\n]*', '$1 ')
  # key: 'value' —— 只取"键名敏感"或"值形态像机密"（IPv4 / 长 hex / 超长串）的字面量
  foreach ($m in [Regex]::Matches($raw, "([A-Za-z][A-Za-z0-9_]*)\s*:\s*'([^'\r\n]{2,})'")) {
    $key = $m.Groups[1].Value
    $val = $m.Groups[2].Value
    if (-not $val -or $val.StartsWith('<')) { continue }
    $sens = $key -match $sensitiveKey
    $shape = ($val -match '^\d{1,3}(\.\d{1,3}){3}$') -or ($val -match '^[0-9a-fA-F]{16,}$') -or ($val.Length -ge 20)
    if (($sens -or $shape) -and -not $values.Contains($val)) { [void]$values.Add($val) }
  }
}
foreach ($name in @('USERNAME', 'COMPUTERNAME', 'GPT_PROXY_USER', 'GPT_PROXY_PASSWORD')) {
  $v = [Environment]::GetEnvironmentVariable($name, 'User')
  if (-not $v) { $v = [Environment]::GetEnvironmentVariable($name, 'Process') }
  if ($v -and $v.Length -ge 3 -and -not $values.Contains($v)) { [void]$values.Add($v) }
}

# ---------- 暂存文件：文件名 + "被忽略却强加"检查 ----------
$staged = @(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR --no-renames)
$hits = New-Object 'System.Collections.Generic.List[string]'
foreach ($f in $staged) {
  if (-not $f) { continue }
  foreach ($v in $values) {
    if ($f.Contains($v)) { [void]$hits.Add(("文件名命中敏感值：{0}（{1}）" -f $f, (& $mask $v))) }
  }
  # --no-index：即使文件已进暂存区也要按忽略规则判定，否则"被忽略却强加"的文件会被放过（实测踩坑）
  git check-ignore -q --no-index -- $f
  if ($LASTEXITCODE -eq 0) { [void]$hits.Add("被 .gitignore 忽略却被加入暂存区：$f") }
}

# ---------- 暂存内容：只扫描"新增行" ----------
$curFile = ''
$diff = @(git -c core.quotepath=false diff --cached -U0 --diff-filter=ACMR --no-renames --no-color)
foreach ($line in $diff) {
  if ($line -match '^\+\+\+ b/(.*)$') { $curFile = $Matches[1].Trim(); continue }
  if ($line -notlike '+*' -or $line -like '+++*') { continue }
  foreach ($v in $values) {
    if ($line.Contains($v)) {
      $shown = $line.Substring(1)
      foreach ($v2 in $values) { $shown = $shown.Replace($v2, (& $mask $v2)) }
      if ($shown.Length -gt 160) { $shown = $shown.Substring(0, 160) + ' …' }
      [void]$hits.Add(("新增内容命中敏感值：{0} → {1}" -f $curFile, $shown))
    }
  }
}

if ($hits.Count -gt 0) {
  Write-Host ''
  Write-Host '==== 脱敏扫描：已拦截本次提交 ===='
  foreach ($h in ($hits | Select-Object -Unique)) { Write-Host ('  · ' + $h) }
  Write-Host '（确属误报时可 git commit --no-verify 跳过；建议先检查内容）'
  Write-Host ''
  exit 1
}
Write-Host ('脱敏扫描通过（敏感值 {0} 个 / 暂存文件 {1} 个）' -f $values.Count, $staged.Count)
exit 0
