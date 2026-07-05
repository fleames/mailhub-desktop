#requires -version 5.1
<#
  One-click release build.

  Always: rebuilds mailhub, syncs it into mailhub-desktop/vendor.

  Then, for the actual packaged app:
    - If dist\win-unpacked already exists from a prior successful package,
      HOT-PATCHES it in place (overwrites the bundled server/migrations/
      electron source only) and skips electron-builder entirely. This is
      the fast path for ordinary code changes and is unaffected by the
      Developer-Mode/symlink issue below.
    - If it doesn't exist yet (first run), or -FullRepackage is passed,
      runs electron-builder for real (needed after changing electron
      dependencies, electron-builder.yml, or native modules). That step
      needs Windows Developer Mode enabled (Settings > Privacy & security >
      For developers) - electron-builder's Windows resource-editing tool
      (rcedit, bundled in "winCodeSign" despite the name) ships as a 7z
      archive containing symlinks, and extracting those requires either
      Developer Mode or an elevated process. Without it, packaging from
      scratch fails; ask the user to flip that toggle once if this happens.

  Always finishes by zipping dist\win-unpacked into a portable build.
#>

param(
    [switch]$FullRepackage
)

$ErrorActionPreference = "Stop"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

$mailhubDir = "C:\Users\Ryzen3D\mailhub"
$desktopDir = "C:\Users\Ryzen3D\mailhub-desktop"
$unpackedDir = "$desktopDir\dist\win-unpacked"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

function Invoke-Checked($cmd) {
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $cmd" }
}

# Robocopy's exit codes are a bitmask where 0-7 all mean "success" (8+ is a real failure).
function Mirror-Dir($src, $dst) {
    robocopy $src $dst /MIR /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed mirroring $src -> $dst (exit $LASTEXITCODE)" }
}

try {
    Step "1/4  Building mailhub (Next.js production build)"
    Set-Location $mailhubDir
    Invoke-Checked "pnpm build"
    Remove-Item "$mailhubDir\.next\standalone\.next\static" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$mailhubDir\.next\standalone\public" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item "$mailhubDir\.next\static" "$mailhubDir\.next\standalone\.next\static" -Recurse
    Copy-Item "$mailhubDir\public" "$mailhubDir\.next\standalone\public" -Recurse
    Ok "mailhub built"

    Step "2/4  Syncing the built server into mailhub-desktop/vendor"
    Set-Location $desktopDir
    Invoke-Checked "pnpm run sync"
    Ok "Vendor synced"

    $canHotPatch = (-not $FullRepackage) -and (Test-Path "$unpackedDir\MailHub.exe")

    if ($canHotPatch) {
        Step "3/4  Hot-patching the existing packaged app (fast path, no electron-builder)"
        Mirror-Dir "$desktopDir\vendor\mailhub-server" "$unpackedDir\resources\mailhub-server"
        Mirror-Dir "$desktopDir\vendor\mailhub-migrate" "$unpackedDir\resources\mailhub-migrate"
        Mirror-Dir "$desktopDir\electron" "$unpackedDir\resources\app\electron"
        Copy-Item "$desktopDir\license\verify.js" "$unpackedDir\resources\app\license\verify.js" -Force
        Copy-Item "$desktopDir\license\format.js" "$unpackedDir\resources\app\license\format.js" -Force
        Ok "Hot-patched dist\win-unpacked"
        Warn "This only refreshes app code, not electron/native dependencies."
        Warn "Run with -FullRepackage after changing package.json or electron-builder.yml."
    }
    else {
        Step "3/4  Packaging the Electron app from scratch (electron-builder)"
        $builtInstaller = $true
        Invoke-Expression "pnpm exec electron-builder --win"
        if ($LASTEXITCODE -ne 0) {
            Warn "Installer build failed - falling back to a portable (--dir) build."
            $builtInstaller = $false
            Invoke-Expression "pnpm exec electron-builder --win --dir"
            if ($LASTEXITCODE -ne 0) {
                $msg = "Packaging failed entirely. This environment can't create the symlinks " +
                       "electron-builder's Windows resource-editing tool needs unless Developer Mode " +
                       "is on (Settings > Privacy and security > For developers > Developer Mode). " +
                       "Enable that once, then re-run this script."
                throw $msg
            }
        }
        Ok "Packaged"
    }

    Step "4/4  Creating the portable zip"
    $version = (Get-Content "$desktopDir\package.json" | ConvertFrom-Json).version
    $zipPath = "$desktopDir\dist\MailHub-$version-win-x64.zip"
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path $unpackedDir -DestinationPath $zipPath -Force
    Ok "Zip created"

    Write-Host "`nBUILD COMPLETE" -ForegroundColor Green
    $exe = Get-ChildItem "$desktopDir\dist\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) { Write-Host "Installer:    $($exe.FullName)" }
    Write-Host "Portable zip: $zipPath"
    Write-Host "Unpacked:     $unpackedDir\MailHub.exe"
}
catch {
    Write-Host "`nBUILD FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
