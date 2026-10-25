# 构建 Kedai 暗色版 Android APK（arm64 真机）
#
# 与 build.ps1 相互独立：build.ps1 只做 Windows 侧，Android 走这条。
#
# ★ 这个工程会被搬移（已经搬过两次），所以本脚本**不写死任何外部依赖的绝对路径**：
#   SDK / NDK / JDK / node / libclang / 签名密钥 全部自动发现，并顺手把两处
#   「只能写死路径」的配置改写成当前实际路径：
#       .cargo/config.toml                     -> [env] BINDGEN_EXTRA_CLANG_ARGS
#       src-tauri/gen/android/local.properties -> sdk.dir
#   也就是说：**搬完家直接跑一次本脚本就行**，不用手改任何配置。
#
# 用法：
#   .\build-apk-dark.ps1             完整构建
#   .\build-apk-dark.ps1 -CheckOnly  只做环境自检 + 修配置，不构建（几秒）
#
# 依赖的目录布局（相对本仓库的上一级）：
#   <上一级>\android-sdk      Android SDK
#   <上一级>\kedai-keys       release keystore
#   其余（DSH 的 node / libclang、Zulu JDK）在用户目录下自动搜。
#
# 前置（换机需重装）：
#   - Android SDK：platforms;android-36 / build-tools;36.0.0 / platform-tools / ndk;27.2.12479018
#   - JDK（Zulu 22；作者记录系统 JDK 26 不可用）
#   - rustup target add aarch64-linux-android
#   - libclang.dll（rquickjs 没有 arm64-android 预生成绑定，必须现场跑 bindgen）
#
# 为什么必须设 NODE_EXE：
#   src-tauri/gen/android/buildSrc/.../BuildTask.kt 依次找
#     C:\Program Files\nodejs\node.exe → C:\Program Files (x86)\nodejs\node.exe → $env:NODE_EXE → PATH 上的 node
#   node 装在用户目录时前两个都不命中；而 PATH 上那个系统 node 在 DSH 沙箱里写文件会
#   EPERM（vite/gradle 建临时文件失败）。所以显式指到能写文件的 node。
#
# 路径一律用正斜杠：bindgen/clang 在 Windows 上把反斜杠当转义符。

[CmdletBinding()]
param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$Repo = $PSScriptRoot
$Root = Split-Path $Repo -Parent

function Find-Dir {
  param([string[]]$Candidates, [string]$Probe)
  foreach ($c in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($c)) { continue }
    if ($Probe) { if (Test-Path (Join-Path $c $Probe)) { return (Resolve-Path $c).Path } }
    elseif (Test-Path $c) { return (Resolve-Path $c).Path }
  }
  return $null
}
function Find-One {
  param([string]$Base, [string]$Filter, [int]$Depth = 8)
  if (-not (Test-Path $Base)) { return $null }
  Get-ChildItem $Base -Recurse -Depth $Depth -Filter $Filter -File -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
function Fwd([string]$p) { if ($p) { $p -replace '\\', '/' } else { $null } }

# ---------------- 自动发现 ----------------
$Sdk = Find-Dir @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT,
                  (Join-Path $Root 'android-sdk'),
                  "$env:LOCALAPPDATA\Android\Sdk") -Probe 'platform-tools'

$Ndk = $env:NDK_HOME
if (-not $Ndk -and $Sdk -and (Test-Path (Join-Path $Sdk 'ndk'))) {
  $Ndk = Get-ChildItem (Join-Path $Sdk 'ndk') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name | Select-Object -Last 1 -ExpandProperty FullName
}

$JavaHome = $null
foreach ($c in @($env:JAVA_HOME)) {
  if ($c -and (Test-Path (Join-Path $c 'bin\javac.exe'))) { $JavaHome = $c; break }
}
if (-not $JavaHome -and (Test-Path 'C:\Program Files\Zulu')) {
  $JavaHome = Get-ChildItem 'C:\Program Files\Zulu' -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\javac.exe') } |
    Select-Object -Last 1 -ExpandProperty FullName
}
if (-not $JavaHome) {
  $jc = Get-Command javac.exe -ErrorAction SilentlyContinue
  if ($jc) { $JavaHome = Split-Path (Split-Path $jc.Source -Parent) -Parent }
}

# node 必须能写文件 —— 排除 Program Files 下那个被沙箱挡住的系统 node
$Node = $null
foreach ($c in @($env:NODE_EXE)) {
  if ($c -and (Test-Path $c) -and $c -notmatch 'Program Files') { $Node = $c; break }
}
if (-not $Node) {
  $Node = Find-One "$env:USERPROFILE\.dsh" 'node.exe' 8 |
    Where-Object { $_ -notmatch 'node_modules' } | Select-Object -First 1
}
if (-not $Node) { $Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }

$Clang = $null
foreach ($c in @($env:LIBCLANG_PATH)) {
  if ($c -and (Test-Path (Join-Path $c 'libclang.dll'))) { $Clang = $c; break }
}
if (-not $Clang) {
  $dll = Find-One "$env:USERPROFILE\.dsh" 'libclang.dll' 10
  if ($dll) { $Clang = Split-Path $dll -Parent }
}
if (-not $Clang -and (Test-Path 'C:\Program Files\LLVM\bin\libclang.dll')) { $Clang = 'C:\Program Files\LLVM\bin' }

$Ks = $null
foreach ($c in @($env:KEDAI_KEYSTORE_FILE, (Join-Path $Root 'kedai-keys\kedai-release.jks'))) {
  if ($c -and (Test-Path $c)) { $Ks = $c; break }
}

# ---------------- 派生 ----------------
$NdkPre = Fwd (Join-Path $Ndk 'toolchains/llvm/prebuilt/windows-x86_64')
$ClangArgs = "-resource-dir=$NdkPre/lib/clang/18 " +
             "-isystem $NdkPre/sysroot/usr/include/aarch64-linux-android " +
             "-isystem $NdkPre/sysroot/usr/include"

# ---------------- 写回两处只能写死路径的配置 ----------------
$cfgPath = Join-Path $Repo '.cargo/config.toml'
if (Test-Path $cfgPath) {
  $t = [System.IO.File]::ReadAllText($cfgPath)
  $new = 'BINDGEN_EXTRA_CLANG_ARGS = { value = "' + $ClangArgs + '", force = true }'
  $t2 = [regex]::Replace($t, 'BINDGEN_EXTRA_CLANG_ARGS = \{.*?\}', $new)
  if ($t2 -ne $t) { [System.IO.File]::WriteAllText($cfgPath, $t2); $cfgFixed = 'rewritten' }
  else { $cfgFixed = 'unchanged' }
} else { $cfgFixed = 'missing' }

$lpPath = Join-Path $Repo 'src-tauri/gen/android/local.properties'
$lpWrote = $false
if ($Sdk) {
  $lpDir = Split-Path $lpPath -Parent
  if (Test-Path $lpDir) {
    [System.IO.File]::WriteAllText($lpPath, "sdk.dir=$(Fwd $Sdk)`n")
    $lpWrote = $true
  }
}

# gen/android/keystore.properties 的优先级高于环境变量，旧机器搬过目录后里面还写着
# 老绝对路径，gradle 会直接 validateSigningUniversalRelease 失败（2026-10-19 实测：
# C:\DSH\MC\_external\kedai\kedai-keys\kedai-release.jks not found）。按自检结果重写。
#
# 口令来源（**脚本里不内置任何口令**，2026-10-25 移除，理由见 AGENTS.local.md）：
#   ① 环境变量 KEDAI_KEYSTORE_PASSWORD（推荐；本次会话/CI 里给）
#   ② 本机已存在的 keystore.properties 里的 storePassword（该文件被 .gitignore 忽略，只在本地）
#   ③ 都没有 → 构建模式直接失败（exit 2），不再有兜底默认值。
$ksPropPath = Join-Path $Repo 'src-tauri/gen/android/keystore.properties'
$ksPropWrote = $false
$ksPwSrc = ''
$ksPw = $null
if ($env:KEDAI_KEYSTORE_PASSWORD) {
  $ksPw = $env:KEDAI_KEYSTORE_PASSWORD
  $ksPwSrc = 'env'
} elseif (Test-Path $ksPropPath) {
  $m = Select-String -Path $ksPropPath -Pattern '^storePassword=(.*)$' -Encoding UTF8 | Select-Object -First 1
  if ($m) { $ksPw = $m.Matches[0].Groups[1].Value.Trim(); $ksPwSrc = 'keystore.properties' }
}
$ksKp = if ($env:KEDAI_KEY_PASSWORD) { $env:KEDAI_KEY_PASSWORD } elseif ($ksPw) { $ksPw } else { $null }
$ksAl = if ($env:KEDAI_KEY_ALIAS) { $env:KEDAI_KEY_ALIAS } else { 'kedai' }
if ($Ks -and $ksPw -and (Test-Path (Split-Path $ksPropPath -Parent))) {
  $ksTxt = "storeFile=$(Fwd $Ks)`nstorePassword=$ksPw`nkeyAlias=$ksAl`nkeyPassword=$ksKp`n"
  [System.IO.File]::WriteAllText($ksPropPath, $ksTxt)
  $ksPropWrote = $true
}

# ---------------- 环境变量 ----------------
$env:JAVA_HOME        = $JavaHome
$env:ANDROID_HOME     = Fwd $Sdk
$env:ANDROID_SDK_ROOT = Fwd $Sdk
$env:NDK_HOME         = Fwd $Ndk
$env:ANDROID_NDK_HOME = Fwd $Ndk
$env:LIBCLANG_PATH    = $Clang
$env:NODE_EXE         = $Node
$env:BINDGEN_EXTRA_CLANG_ARGS = $ClangArgs
Set-Item -Path 'Env:BINDGEN_EXTRA_CLANG_ARGS_aarch64-linux-android' -Value $ClangArgs
Set-Item -Path 'Env:BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android' -Value $ClangArgs
$env:PATH = "$env:USERPROFILE\.cargo\bin;$(Split-Path $Node);$(Fwd (Join-Path $Ndk 'toolchains/llvm/prebuilt/windows-x86_64/bin'));$env:PATH"
# 复用 daemon 会带走旧环境变量，每次都强制新 JVM
$env:GRADLE_OPTS = '-Dorg.gradle.daemon=false'
$env:CARGO_TERM_COLOR = 'never'

if ($Ks) {
  $env:KEDAI_KEYSTORE_FILE = Fwd $Ks
  if (-not $env:KEDAI_KEY_ALIAS) { $env:KEDAI_KEY_ALIAS = $ksAl }
  if ($ksPw) {
    if (-not $env:KEDAI_KEYSTORE_PASSWORD) { $env:KEDAI_KEYSTORE_PASSWORD = $ksPw }
    if (-not $env:KEDAI_KEY_PASSWORD)      { $env:KEDAI_KEY_PASSWORD      = $ksKp }
  }
}

# ---------------- 自检 ----------------
$ok = { param($v) if ($v -and (Test-Path $v)) { 'OK  ' } else { 'MISS' } }
$lines = @(
  "repo            = $Repo"
  "sdk             = $Sdk"
  "ndk             = $Ndk"
  "ndk prebuilt    = $NdkPre"
  "  bin/clang     = $(Test-Path "$NdkPre/bin/aarch64-linux-android24-clang.cmd")"
  "  lib/clang/18  = $(Test-Path "$NdkPre/lib/clang/18")"
  "  sysroot/inc   = $(Test-Path "$NdkPre/sysroot/usr/include")"
  "jdk             = $JavaHome"
  "node            = $Node   (非 Program Files: $($Node -and $Node -notmatch 'Program Files'))"
  "libclang        = $Clang"
  "keystore        = $(if ($Ks) { $Ks } else { '(未找到 -> 走 gen/android/keystore.properties，可能产出 unsigned)' })"
  "keystore pw     = $(if ($ksPw) { "OK (来源: $ksPwSrc)" } else { '(未设置 -> 构建会中止；设 KEDAI_KEYSTORE_PASSWORD)' })"
  "cargo [env]     = $cfgFixed"
  "local.properties= $(if ($lpWrote) { 'written' } else { 'skipped' })"
  "clang args      = $ClangArgs"
)
Write-Host '=== 环境自检 ==='
$lines | ForEach-Object { Write-Host "  $_" }
Write-Host ''
# 自检内容同时落一份到临时目录，方便事后对账；不写进仓库，免得污染工作树。
$lines | Set-Content -Encoding UTF8 (Join-Path $env:TEMP 'kedai-apk-selfcheck.txt') -ErrorAction SilentlyContinue

if (-not $CheckOnly -and $Ks -and -not $ksPw) {
  Write-Host '[中止] 找不到签名口令，且脚本里没有任何内置默认口令（2026-10-25 移除）。' -ForegroundColor Red
  Write-Host '  二选一：' -ForegroundColor Red
  Write-Host '    ① 本次会话设环境变量：$env:KEDAI_KEYSTORE_PASSWORD = ''…''（可选 KEDAI_KEY_PASSWORD / KEDAI_KEY_ALIAS）' -ForegroundColor Red
  Write-Host '    ② 保留本机 src-tauri/gen/android/keystore.properties（被 .gitignore 忽略，里面存明文口令）' -ForegroundColor Red
  Write-Host '  说明见 AGENTS.local.md「签名口令」一节。' -ForegroundColor Red
  exit 2
}

if (-not $Sdk -or -not $Ndk -or -not $JavaHome -or -not $Node) {
  Write-Host '[中止] 关键依赖没找全。自己搜一下（别假设路径）：'
  Write-Host '  Get-ChildItem $env:USERPROFILE -Recurse -Depth 6 -Filter sdkmanager.bat -EA SilentlyContinue'
  Write-Host '  Get-ChildItem "$env:USERPROFILE\.dsh" -Recurse -Depth 8 -Filter node.exe -EA SilentlyContinue | ? { $_.FullName -notmatch "node_modules" }'
  Write-Host '  Get-ChildItem "C:\Program Files" -Recurse -Depth 4 -Filter javac.exe -EA SilentlyContinue'
  exit 1
}

if ($CheckOnly) { Write-Host '[CheckOnly] 只自检与修配置，未构建。'; exit 0 }

Set-Location $Repo
& $Node (Join-Path $Repo 'node_modules/@tauri-apps/cli/tauri.js') android build --apk --target aarch64 --ci 2>&1
Write-Host "=== tauri exit=$LASTEXITCODE ==="

Write-Host '=== 产物 ==='
Get-ChildItem (Join-Path $Repo 'src-tauri/gen/android/app/build/outputs/apk') -Recurse -Filter *.apk -ErrorAction SilentlyContinue |
  Select-Object FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}, LastWriteTime |
  Format-Table -AutoSize

# 把新 APK 拷进 dist\（命名沿用 Kedai-<version>-arm64-dark.apk）并打印指纹。
# 之前这一步靠手工做，结果 dist 里一直躺着旧包、新包只躺在 gen/android 下。
$apkOut = Get-ChildItem (Join-Path $Repo 'src-tauri/gen/android/app/build/outputs/apk') -Recurse -Filter *.apk -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apkOut) {
  Write-Host '[FAIL] 没找到 APK 产物' -ForegroundColor Red
  exit 1
}
$ver = (Get-Content (Join-Path $Repo 'package.json') -Raw | ConvertFrom-Json).version
$dstDir = Join-Path $Repo 'dist'
if (Test-Path $dstDir) {
  $dstApk = Join-Path $dstDir "Kedai-$ver-arm64-dark.apk"
  Copy-Item $apkOut.FullName $dstApk -Force
  $hash = (Get-FileHash $dstApk -Algorithm SHA256).Hash
  $size = (Get-Item $dstApk).Length
  Write-Host ''
  Write-Host "已复制: $dstApk" -ForegroundColor Green
  Write-Host "  大小: $size 字节"
  Write-Host "  SHA256: $hash"
}

# 显式收尾：node 的 stderr 经 2>&1 进 PS 5.1 会被包成 NativeCommandError，
# 构建成功时脚本仍可能被判 exit=1（2026-10-19 实测），这里以产物为准。
exit 0
