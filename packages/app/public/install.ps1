# 神念安装器（Windows）
#
#   irm https://shennian.net/install.ps1 | iex
#
# 可以反复运行：已装好的部分会跳过。它会：
#   1. 使用本机 Node 22.19+；没有时下载一份只给神念用的 Node（不改动系统）
#   2. 安装或升级神念 Client（国内网络自动使用 npmmirror 镜像）
#   3. 运行 `shennian setup`：安装 Skill、发现本机 AI、给出配对链接、启动后台服务
#
# 需要给 `shennian setup` 传参数时（例如 AI 需要 JSON 输出）：
#   & ([scriptblock]::Create((irm https://shennian.net/install.ps1))) --json
#
# 可选环境变量：SHENNIAN_HOME、SHENNIAN_NPM_REGISTRY、SHENNIAN_NODE_MIRROR、
# SHENNIAN_OSS_NODE_MIRROR、SHENNIAN_CLI_PACKAGE（默认 shennian@latest；预览版用 shennian@next）
# 设计说明：docs/architecture/cli/setup.md

function Install-Shennian {
  param([string[]]$SetupArgs)
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

  $ShennianHome = if ($env:SHENNIAN_HOME) { $env:SHENNIAN_HOME } else { Join-Path $env:USERPROFILE '.shennian' }
  $RuntimeDir = Join-Path $ShennianHome 'runtime\node'
  $CliPrefix = Join-Path $ShennianHome 'cli'
  $BinDir = Join-Path $ShennianHome 'bin'
  $CliPackage = if ($env:SHENNIAN_CLI_PACKAGE) { $env:SHENNIAN_CLI_PACKAGE } else { 'shennian@latest' }
  $NodeMajor = 24
  $RegistryOfficial = 'https://registry.npmjs.org'
  $RegistryCn = 'https://registry.npmmirror.com'
  $NodeDistOfficial = 'https://nodejs.org/dist'
  $NodeDistCn = 'https://npmmirror.com/mirrors/node'
  # Our own mirror of the exact official Node binaries (see scripts/cache-node-runtime-to-oss.mjs);
  # tried first since it is typically far faster and more reliable than nodejs.org or npmmirror.
  $OssNodeMirror = if ($env:SHENNIAN_OSS_NODE_MIRROR) { $env:SHENNIAN_OSS_NODE_MIRROR } else { 'https://videoindustry.oss-cn-hangzhou.aliyuncs.com/shennian/toolchain/node' }

  function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" }
  function Fail([string]$Text) {
    Write-Host ''
    Write-Host "✗ $Text" -ForegroundColor Red
    Write-Host '  需要帮助：把上面的输出发给你的 AI，或到神念官方群找客服（https://shennian.net/#contact）。'
    throw "shennian_install_failed: $Text"
  }
  function Test-Url([string]$Url) {
    try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4 -Method Get | Out-Null; return $true } catch { return $false }
  }
  function Test-CompatibleNode([string]$Node) {
    # Windows PowerShell 5.1 strips inner double quotes from native arguments, so parse `--version`.
    try {
      if ((& $Node --version 2>$null) -match '^v(\d+)\.(\d+)\.') { return ([int]$Matches[1] -gt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 19)) }
    } catch {}
    return $false
  }
  function Save-Url([string]$Url, [string]$Dest, [int]$TimeoutSec = 300) {
    Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -TimeoutSec $TimeoutSec
  }

  try { New-Item -ItemType Directory -Force -Path $ShennianHome | Out-Null } catch {
    Fail "无法写入 $ShennianHome。如果是 AI 在帮你安装，它可能运行在沙盒里：请给它开启完整权限，或者自己打开 PowerShell 粘贴这一行安装命令。"
  }

  Step '检查网络'
  if ($env:SHENNIAN_NPM_REGISTRY) {
    $Registry = $env:SHENNIAN_NPM_REGISTRY; $RegistryAlt = $RegistryOfficial
    $NodeDist = if ($env:SHENNIAN_NODE_MIRROR) { $env:SHENNIAN_NODE_MIRROR } else { $NodeDistOfficial }
  } elseif (Test-Url "$RegistryOfficial/-/ping") {
    $Registry = $RegistryOfficial; $RegistryAlt = $RegistryCn
    $NodeDist = if ($env:SHENNIAN_NODE_MIRROR) { $env:SHENNIAN_NODE_MIRROR } else { $NodeDistOfficial }
    Write-Host '使用 npm 官方源'
  } else {
    $Registry = $RegistryCn; $RegistryAlt = $RegistryOfficial
    $NodeDist = if ($env:SHENNIAN_NODE_MIRROR) { $env:SHENNIAN_NODE_MIRROR } else { $NodeDistCn }
    Write-Host '使用国内镜像 npmmirror'
  }

  # ── 1. Node ──────────────────────────────────────────────────────────────────
  $PrivateNode = Join-Path $RuntimeDir 'node.exe'
  $Node = $null
  $IsPrivate = $false
  Step '检查 Node'
  $systemNode = Get-Command node -ErrorAction SilentlyContinue
  $systemNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ((Test-Path $PrivateNode) -and (Test-CompatibleNode $PrivateNode)) {
    $Node = $PrivateNode; $IsPrivate = $true
    Write-Host "使用神念专用的 Node $(& $Node -v)"
  } elseif ($systemNode -and $systemNpm -and (Test-CompatibleNode $systemNode.Source)) {
    $Node = $systemNode.Source
    Write-Host "使用本机 Node $(& $Node -v)"
  } else {
    $arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { $null } }
    if (-not $arch) { Fail "这台电脑的 CPU 架构（$($env:PROCESSOR_ARCHITECTURE)）没有现成的 Node 安装包。请先安装 Node.js 22.19 或更高版本，再重新运行。" }
    Step "下载神念专用的 Node（放在 $RuntimeDir，不改动系统）"
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("shennian-node-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
      $file = $null; $sum = $null; $zip = $null

      # Our own mirror first: one small pointer file (`version filename sha256`), no JSON
      # parsing needed. Falls straight through to nodejs.org/npmmirror on any failure below.
      try {
        $pointer = Join-Path $tmp 'pointer.txt'
        Save-Url "$OssNodeMirror/latest/win-$arch.txt" $pointer 15
        $parts = (Get-Content $pointer -Raw).Trim() -split '\s+'
        if ($parts.Count -eq 3) {
          $ossVersion, $ossFile, $ossSum = $parts
          $ossZip = Join-Path $tmp $ossFile
          Save-Url "$OssNodeMirror/$ossVersion/$ossFile" $ossZip 300
          if ((Get-FileHash -Algorithm SHA256 $ossZip).Hash.ToLower() -eq $ossSum.ToLower()) {
            $file = $ossFile; $sum = $ossSum; $zip = $ossZip
            Write-Host '使用神念自有源下载 Node'
          }
        }
      } catch {}

      if (-not $file) {
        # Newest v24 from the release index; mirrors can lag on the latest-v24.x alias.
        $NodeLine = "latest-v$NodeMajor.x"
        try {
          $latest = (Invoke-RestMethod -Uri "$NodeDist/index.json" -TimeoutSec 30) | Where-Object { $_.version -like "v$NodeMajor.*" } | Select-Object -First 1
          if ($latest) { $NodeLine = $latest.version }
        } catch {}
        $sums = Join-Path $tmp 'SHASUMS256.txt'
        try { Save-Url "$NodeDist/$NodeLine/SHASUMS256.txt" $sums } catch {
          try { Save-Url "$NodeDistOfficial/$NodeLine/SHASUMS256.txt" $sums } catch { Fail '无法下载 Node 版本列表，请检查网络后重试。' }
        }
        $line = Get-Content $sums | Where-Object { $_ -match " node-v[0-9.]+-win-$arch\.zip$" } | Select-Object -First 1
        if (-not $line) { Fail "没有找到适合 win-$arch 的 Node 安装包。" }
        $sum, $file = $line -split '\s+', 2
        $zip = Join-Path $tmp $file
        try { Save-Url "$NodeDist/$NodeLine/$file" $zip } catch {
          try { Save-Url "$NodeDistOfficial/$NodeLine/$file" $zip } catch { Fail 'Node 下载失败，请检查网络后重试。' }
        }
      }

      if ((Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower() -ne $sum.ToLower()) { Fail '下载的 Node 校验失败（文件不完整或被篡改），请重试。' }
      $extract = Join-Path $tmp 'extract'
      Expand-Archive -Path $zip -DestinationPath $extract -Force
      $extracted = Join-Path $extract ([IO.Path]::GetFileNameWithoutExtension($file))
      if (-not (Test-Path (Join-Path $extracted 'node.exe'))) { Fail 'Node 安装包内容异常，请重试。' }
      New-Item -ItemType Directory -Force -Path (Split-Path $RuntimeDir) | Out-Null
      if (Test-Path "$RuntimeDir.old") { Remove-Item -Recurse -Force "$RuntimeDir.old" }
      if (Test-Path $RuntimeDir) { Move-Item $RuntimeDir "$RuntimeDir.old" }
      Move-Item $extracted $RuntimeDir
      if (Test-Path "$RuntimeDir.old") { Remove-Item -Recurse -Force "$RuntimeDir.old" }
    } finally {
      Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
    $Node = $PrivateNode; $IsPrivate = $true
    Write-Host "Node $(& $Node -v) 已就绪"
  }
  # npm.cmd beside a Node uses that node.exe, so the private runtime needs no PATH change.
  $Npm = if ($IsPrivate) { Join-Path $RuntimeDir 'npm.cmd' } else { 'npm.cmd' }

  function Invoke-NpmInstall([string]$Prefix) {
    $npmArgs = @('install', '-g', $CliPackage, '--no-fund', '--no-audit', '--no-update-notifier', '--loglevel=error')
    if ($Prefix) { $npmArgs += @('--prefix', $Prefix) }
    # Out-Host keeps npm's output out of this function's return value.
    & $Npm @npmArgs --registry $Registry | Out-Host
    if ($LASTEXITCODE -ne 0) { & $Npm @npmArgs --registry $RegistryAlt | Out-Host }
    return ($LASTEXITCODE -eq 0)
  }
  function Test-Setup([string]$Entry) {
    # `<entry> setup --help` exits 0 even when `setup` is not a real subcommand
    # (commander prints the root help for any unrecognized command name), so
    # check the real command list instead.
    $help = & $Node $Entry --help 2>&1 | Out-String
    return ($help -match '(?m)^\s+setup(\s|$)')
  }

  # ── 2. 神念 Client ────────────────────────────────────────────────────────────
  Step '安装神念 Client'
  $ownEntry = Join-Path $CliPrefix 'node_modules\shennian\dist\bin\shennian.js'
  $Entry = $null
  if (Test-Path $ownEntry) {
    $Entry = $ownEntry
  } elseif (-not $IsPrivate -and ($existing = Get-Command shennian -ErrorAction SilentlyContinue)) {
    # Follow the `shennian` shim actually on PATH (npm puts it beside node_modules).
    $candidate = Join-Path (Split-Path $existing.Source) 'node_modules\shennian\dist\bin\shennian.js'
    if (Test-Path $candidate) { $Entry = $candidate }
  }

  if ($Entry) {
    Write-Host "发现已安装的神念 Client $(& $Node $Entry --version)"
    if (-not (Test-Setup $Entry)) {
      # Existing installs upgrade through the Client's own transactional updater.
      Write-Host '更新到最新版'
      & $Node $Entry upgrade --yes | Out-Host
      if (-not (Test-Setup $Entry)) { Fail '神念 Client 更新没有完成。请运行 shennian upgrade 查看原因，完成后重新运行本脚本。' }
    }
  } elseif (-not $IsPrivate) {
    if (-not (Invoke-NpmInstall '')) { Fail '神念 Client 安装失败，请检查网络后重试。' }
    $Entry = Join-Path (& $Npm root -g) 'shennian\dist\bin\shennian.js'
  } else {
    if (-not (Invoke-NpmInstall $CliPrefix)) { Fail '神念 Client 安装失败，请检查网络后重试。' }
    $Entry = $ownEntry
  }
  if (-not (Test-Path $Entry)) { Fail '没有找到安装好的神念 Client。' }
  if (-not (Test-Setup $Entry)) { Fail '安装到的神念 Client 版本过旧，缺少 setup 命令。请稍后重试。' }

  if ($Entry -eq $ownEntry) {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $nodeForLauncher = if ($IsPrivate) { $Node } else { 'node' }
    Set-Content -Path (Join-Path $BinDir 'shennian.cmd') -Encoding ASCII -Value "@`"$nodeForLauncher`" `"$Entry`" %*"
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (($userPath -split ';') -contains $BinDir)) {
      [Environment]::SetEnvironmentVariable('Path', (@($BinDir, $userPath) | Where-Object { $_ }) -join ';', 'User')
    }
    if (-not (($env:Path -split ';') -contains $BinDir)) { $env:Path = "$BinDir;$env:Path" }
  }
  Write-Host "神念 Client $(& $Node $Entry --version) 已就绪"

  # ── 3. 连接 ───────────────────────────────────────────────────────────────────
  Step '连接神念'
  & $Node $Entry setup @SetupArgs
  $global:LASTEXITCODE = $LASTEXITCODE
}

# `irm | iex` must not call `exit`: it would close the person's PowerShell window.
Install-Shennian -SetupArgs $args
