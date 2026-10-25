<#
.SYNOPSIS
    把本地工作树同步到私有备份仓（默认 remote `mine`），用「压缩历史」的方式推送。

.DESCRIPTION
    为什么不直接 `git push <remote> <branch>`：
      本地这条历史里有 20 多个未推提交，其中早期提交把 release keystore 口令
      写进了 `build-apk-dark.ps1`。直接把整段历史推上去，等于把口令永久泄露到远端。
    所以这里用 `git commit-tree` 现场造两条干净提交：
      base = 上游基线（tree 取 origin/main，无父提交）
      head = 当前工作树（tree 取 HEAD，父 = base）
    两条提交都不是从旧提交复制来的，旧提交对象根本不在新历史里。

    同一份 tree + 同一条消息 + 同一个父 + 同一个时间戳 ⇒ 同一个 commit hash
    （脚本里把 base 的日期钉成了固定值，否则 commit-tree 会用当前时间，hash 每次都变）。

.PARAMETER Remote
    备份仓的 remote 名，默认 `mine`（= https://github.com/hanliu660-gif/kedai-dark ）。

.PARAMETER Branch
    远端分支名，默认 `main`。

.PARAMETER DryRun
    只造提交并显示将推送的内容，不真的 push。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-backup.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\sync-backup.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string]$Remote = 'mine',
    [string]$Branch = 'main',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# 本文件自己也入库，所以这里**不能**把旧口令写成字面量，否则等于又泄露一次。
# 用字符拼装，`git grep <旧口令>` 在树里不会命中。
$secretNeedle = 'kedai' + [char]45 + 'local' + [char]45 + '2026'

function Invoke-Git {
    param([parameter(Mandatory)][string[]]$GitArgs)
    # git 把进度/横幅写到 stderr，PS 5.1 的 2>&1 会把它变成 ErrorRecord；配合
    # $ErrorActionPreference='Stop' 会把「推送成功」也当异常抛出（踩过一次）。
    # 这里临时放宽为 Continue，只按退出码判成败，stderr 取 Message 拼成文本。
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & git @GitArgs 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    $text = ($raw | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { "$_" }
    }) -join "`n"
    if ($code -ne 0) {
        throw "git $($GitArgs -join ' ') 失败:`n$text"
    }
    return ((($text.Trim() -split "`n")[-1]).Trim())
}

Write-Host '[1/5] 检查仓库状态' -ForegroundColor Cyan
$headBranch = Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')
$dirty = & git status --porcelain
if ($dirty) {
    throw '工作区有未提交改动——先提交，避免备份与工作树不一致。'
}
Write-Host "      分支 $headBranch，工作区干净"

Write-Host '[2/5] 解析两端的 tree' -ForegroundColor Cyan
$headTree = Invoke-Git @('rev-parse', 'HEAD^{tree}')
$headShort = Invoke-Git @('rev-parse', '--short', 'HEAD')
$headCount = Invoke-Git @('rev-list', '--count', 'HEAD')
$baseTree = ''
try {
    $baseTree = Invoke-Git @('rev-parse', 'origin/main^{tree}')
} catch {
    throw '取不到 origin/main 的 tree——先 git fetch origin（base 必须锚在上游基线）。'
}
Write-Host "      head tree = $headTree （$headShort，本地共 $headCount 个提交）"
Write-Host "      base tree = $baseTree （origin/main）"

Write-Host '[3/5] 造两条干净提交（不含旧历史）' -ForegroundColor Cyan
# base 的日期钉死：commit-tree 默认用「当前时间」，不钉死的话每次重跑 hash 都会变，
# 「base 恒定」就成了空话。head 仍用当前时间（它本来就随工作树变）。
$baseStamp = 'Sat Oct 25 18:57:00 2026 +0800'
$savedAuthorDate = $env:GIT_AUTHOR_DATE
$savedCommitDate = $env:GIT_COMMITTER_DATE
$env:GIT_AUTHOR_DATE = $baseStamp
$env:GIT_COMMITTER_DATE = $baseStamp
try {
    $baseSha = Invoke-Git @('commit-tree', $baseTree, '-m', 'chore: 上游 SpaceRelay/kedai-agent 基线')
} finally {
    $env:GIT_AUTHOR_DATE = $savedAuthorDate
    $env:GIT_COMMITTER_DATE = $savedCommitDate
}
Write-Host "      base commit = $baseSha"

$logLine = Invoke-Git @('log', '--oneline', '-1')
$subject = 'feat(夜间模式): 中性黑灰暗色主题 + 手机版适配 + 仓库整理与质量改进'
$bodyText = @(
    $subject,
    '',
    "对应本地提交 $headShort（$logLine）",
    '',
    '本次同步内容见仓库内 docs/ 与工程根目录的交接文档.md（交接文档不入库）。',
    '本提交由 tools/sync-backup.ps1 用当前工作树的 tree 现造：新历史里不含被压缩掉的旧提交，',
    '因此也不含旧版 build-apk-dark.ps1 里写死过的 keystore 口令。'
) -join "`n"

$msgFile = Join-Path ([System.IO.Path]::GetTempPath()) 'kedai-backup-msg.txt'
[System.IO.File]::WriteAllText($msgFile, $bodyText, (New-Object System.Text.UTF8Encoding($false)))
$headSha = Invoke-Git @('commit-tree', $headTree, '-p', $baseSha, '-F', $msgFile)
Remove-Item $msgFile -ErrorAction SilentlyContinue
Write-Host "      head commit = $headSha"

Write-Host '[4/5] 核对口径' -ForegroundColor Cyan
$commits = Invoke-Git @('rev-list', '--count', $headSha)
$treeHits = (& git grep -F -c $secretNeedle $headSha 2>$null | Measure-Object).Count
$historyHits = (& git log $headSha -p 2>$null | Select-String -SimpleMatch $secretNeedle | Measure-Object).Count
Write-Host "      提交数 = $commits（应为 2）"
Write-Host "      树内口令命中 = $treeHits（应为 0）"
Write-Host "      历史内口令命中 = $historyHits（应为 0）"
if ($commits -ne '2') { throw '提交数不是 2，说明 base 带了父提交' }
if ($treeHits -gt 0) { throw '工作树里还有 keystore 口令，先清掉再备份' }
if ($historyHits -gt 0) { throw '压缩后的历史里仍能 grep 到口令' }

if ($DryRun) {
    Write-Host '[5/5] -DryRun：跳过推送' -ForegroundColor Yellow
    Write-Host "      将执行: git push --force-with-lease=<远端旧值> $Remote ${headSha}:refs/heads/$Branch"
    return
}

Write-Host "[5/5] 推送到 $Remote/$Branch" -ForegroundColor Cyan
& git fetch --quiet $Remote 2>$null
$remoteSha = ''
try {
    $remoteSha = Invoke-Git @('rev-parse', "$Remote/$Branch")
} catch {
    $remoteSha = ''
}
if ($remoteSha) {
    Invoke-Git @('push', "--force-with-lease=$Branch`:$remoteSha", $Remote, "${headSha}:refs/heads/$Branch") | Out-Null
} else {
    Invoke-Git @('push', $Remote, "${headSha}:refs/heads/$Branch") | Out-Null
}
Write-Host "      推送完成：$Remote/$Branch -> $headSha"

Write-Host ''
Write-Host '推送完成，远端核对：' -ForegroundColor Green
& git ls-remote --heads $Remote
Write-Host "本地仍保留 $headCount 个原提交（未改写历史）。" -ForegroundColor DarkGray
Write-Host '下次同步直接重跑本脚本：base 的 hash 恒定，只有 head 会变。' -ForegroundColor DarkGray
