#Requires -Version 5.1
<#
=============================================================================
 怪物难度调节器 · 一键推送到 GitHub
=============================================================================
 用法（任选一种）：

   1) 资源管理器里右键本文件 → 「使用 PowerShell 运行」
   2) 打开 PowerShell，cd 到仓库根目录后执行：
        powershell -ExecutionPolicy Bypass -File tools\push-to-github.ps1

 前置条件：

   先在 GitHub 网页上新建一个**空仓库**（不要勾选 README / .gitignore / License），
   仓库名与下面的 $RepoName 保持一致。建好后回来跑本脚本即可。

 脚本会做四件事：

   ① 找到本机可用的 git（找不到就退回 WorkBuddy 自带的便携版）
   ② 设置**本仓库**的提交身份（只写 .git/config，不动你的全局配置）
   ③ 把已有提交的作者/提交者改成配置区里的身份
   ④ 添加 / 更新 origin 远程，然后 push
=============================================================================
#>

[CmdletBinding()]
param(
    # 只做本地准备（身份 / 远程 / 作者改写），不推送。用来预览脚本会做什么。
    [switch]$NoPush,

    # 直接用参数指定 GitHub 用户名，覆盖配置区的 $GhUser
    [string]$User = ""
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# 让旧版控制台（conhost）也能正确显示中文和图钉符号
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

# ─── 配置区：只需要改这一段 ──────────────────────────────────────────────
$GhUser   = ""                                   # 你的 GitHub 用户名；留空则运行时询问
$RepoName = "mob-difficulty-tuner"               # 仓库名
$GitName  = "IRELIA"                             # commit 作者名
$GitEmail = "irelia@users.noreply.github.com"    # commit 作者邮箱（建议用 GitHub 的 noreply 邮箱）
# ─────────────────────────────────────────────────────────────────────────


function Write-Step { param([string]$Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "    [OK] $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "    [!]  $Text" -ForegroundColor Yellow }
function Stop-Here  { param([string]$Text) Write-Host "`n[错误] $Text" -ForegroundColor Red; exit 1 }


# ── 1. 定位 git ──────────────────────────────────────────────────────────
Write-Step "定位 git"

$portableRoot = Join-Path $env:USERPROFILE ".workbuddy\binaries\PortableGit\versions\1.2.0"
$candidates = @()
$onPath = Get-Command git -ErrorAction SilentlyContinue
if ($onPath) { $candidates += $onPath.Source }
$candidates += (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd\git.exe")
$candidates += "C:\Program Files\Git\cmd\git.exe"
$candidates += "C:\Program Files (x86)\Git\cmd\git.exe"
$candidates += (Join-Path $portableRoot "mingw64\bin\git.exe")

$Git = $null
foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { $Git = $c; break }
}
if (-not $Git) {
    Stop-Here "本机找不到 git。请先安装 Git for Windows：https://git-scm.com/download/win"
}
Write-Ok "git = $Git"

# 便携版 git 的 libexec 是空的，必须显式指定 GIT_EXEC_PATH，否则 https 推送会报
# "git: 'remote-https' is not a git command"。
if ($Git -like "*$portableRoot*") {
    $env:GIT_EXEC_PATH = Join-Path $portableRoot "mingw64\bin"
    Write-Warn "使用便携版 git，已设置 GIT_EXEC_PATH"
}

# 允许凭据管理器/终端弹出登录提示
$env:GIT_TERMINAL_PROMPT = "1"


# ── 2. 定位仓库根目录 ────────────────────────────────────────────────────
Write-Step "定位仓库根目录"

$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) {
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot ".git")) {
        $Root = $PSScriptRoot
    } else {
        Stop-Here "在 $Root 和 $PSScriptRoot 下都没找到 .git 目录"
    }
}
Set-Location -LiteralPath $Root
Write-Ok "仓库根目录 = $Root"


# ── 3. 收尾未提交的改动 ──────────────────────────────────────────────────
Write-Step "检查工作区状态"

$dirty = (& $Git status --porcelain) -join "`n"
if ($dirty) {
    Write-Warn "工作区还有未提交的改动，正在提交……"
    & $Git add -A
    & $Git commit -m "chore: 提交本地改动" | Out-Null
    Write-Ok "已提交"
} else {
    Write-Ok "工作区干净"
}


# ── 4. 询问用户名 ────────────────────────────────────────────────────────
if ($User) { $GhUser = $User }
if (-not $GhUser) {
    $GhUser = Read-Host "请输入你的 GitHub 用户名"
}
if (-not $GhUser) { Stop-Here "GitHub 用户名不能为空" }


# ── 5. 设置本仓库的提交身份 ──────────────────────────────────────────────
Write-Step "设置本仓库提交身份"

& $Git config --local user.name  $GitName
& $Git config --local user.email $GitEmail
& $Git config --local core.quotepath false
Write-Ok "$GitName <$GitEmail>"

# 只有一个提交时，顺手把作者/提交者一并改成上面的身份
$commitCount = [int](& $Git rev-list --count HEAD)
if ($commitCount -eq 1) {
    & $Git commit --amend --reset-author --no-edit | Out-Null
    Write-Ok "已把首个提交的作者改为 $GitName <$GitEmail>"
} else {
    Write-Warn "仓库有 $commitCount 个提交，跳过作者改写（只影响后续新提交）"
}


# ── 6. 配置远程 ──────────────────────────────────────────────────────────
Write-Step "配置 origin 远程"

$RemoteUrl = "https://github.com/$GhUser/$RepoName.git"
$existing = (& $Git remote) -split "`n" | ForEach-Object { $_.Trim() }
if ($existing -contains "origin") {
    & $Git remote set-url origin $RemoteUrl
    Write-Ok "已更新 origin → $RemoteUrl"
} else {
    & $Git remote add origin $RemoteUrl
    Write-Ok "已添加 origin → $RemoteUrl"
}


# ── 7. 推送 ──────────────────────────────────────────────────────────────
if ($NoPush) {
    Write-Step "已跳过推送（-NoPush）"
    Write-Host "    本地准备已完成。确认无误后去掉 -NoPush 再跑一次即可推送。" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  本地准备完成 ✔  目标仓库：https://github.com/$GhUser/$RepoName" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    exit 0
}

Write-Step "推送到 GitHub"

$branch = (& $Git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "    分支：$branch" -ForegroundColor DarkGray

& $Git push -u origin $branch
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Stop-Here @"
推送失败。常见原因：

  1) 仓库还没建 —— 先去 https://github.com/new 建一个**空仓库**，名字必须是 "$RepoName"
  2) 用户名写错了 —— 当前用的是 "$GhUser"
  3) 没登录 —— 推送时按提示在弹出的窗口里登录 GitHub（或配置 PAT）
  4) 远端已有内容 —— 若你在建仓库时勾了 README，先执行：
       git pull --rebase origin $branch
"@
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  推送完成 ✔" -ForegroundColor Green
Write-Host "  仓库地址：https://github.com/$GhUser/$RepoName" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
