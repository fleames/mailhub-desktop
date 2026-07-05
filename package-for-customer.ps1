#requires -version 5.1
<#
  Builds a complete, ready-to-send delivery folder for one customer:
  the packaged app + their license file sitting right next to the exe +
  a "Run MailHub.bat" launcher, zipped up. The app itself auto-detects
  and auto-activates from a *.license file next to the exe on first
  launch (see electron/main.js findAdjacentLicenseFile) - so the customer
  just unzips and double-clicks, nothing else.

  Usage:
    .\package-for-customer.ps1 -Email buyer@example.com
    .\package-for-customer.ps1 -Email buyer@example.com -Tier subscription -Expires 2027-01-01
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Email,

    [ValidateSet("lifetime", "subscription")]
    [string]$Tier = "lifetime",

    [string]$Expires
)

$ErrorActionPreference = "Stop"
$desktopDir = "C:\Users\Ryzen3D\mailhub-desktop"
$unpackedDir = "$desktopDir\dist\win-unpacked"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }

function Mirror-Dir($src, $dst) {
    robocopy $src $dst /MIR /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed mirroring $src -> $dst (exit $LASTEXITCODE)" }
}

try {
    Set-Location $desktopDir

    if (-not (Test-Path "$unpackedDir\MailHub.exe")) {
        throw "No packaged app found at $unpackedDir. Run Build Release.bat first."
    }

    Step "1/4  Issuing license for $Email ($Tier)"
    $issueArgs = @("license/scripts/issue-license.js", "--email", $Email, "--tier", $Tier)
    if ($Expires) { $issueArgs += @("--expires", $Expires) }
    & node @issueArgs
    if ($LASTEXITCODE -ne 0) { throw "License issuance failed (exit $LASTEXITCODE)" }
    $licenseSrc = "$desktopDir\license\issued\$Email.license"
    if (-not (Test-Path $licenseSrc)) { throw "Expected license file not found: $licenseSrc" }
    Ok "License issued"

    Step "2/4  Assembling the delivery folder"
    $safeEmail = $Email -replace '[^a-zA-Z0-9.\-@]', '_'
    $deliveryRoot = "$desktopDir\dist\customer-delivery\$safeEmail"
    $appDir = "$deliveryRoot\MailHub"
    Mirror-Dir $unpackedDir $appDir
    Copy-Item $licenseSrc "$appDir\$Email.license" -Force
    @'
@echo off
start "" "%~dp0MailHub.exe"
'@ | Set-Content -Path "$appDir\Run MailHub.bat" -Encoding ASCII
    Ok "Delivery folder ready: $appDir"

    Step "3/4  Zipping the delivery folder"
    $zipPath = "$desktopDir\dist\customer-delivery\MailHub-$safeEmail.zip"
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path $appDir -DestinationPath $zipPath -Force
    Ok "Zip created"

    Step "4/4  Done"
    Write-Host "`nDELIVERY READY" -ForegroundColor Green
    Write-Host "Send this to the customer: $zipPath"
    Write-Host "They unzip it and double-click 'Run MailHub.bat' - license activates automatically."
}
catch {
    Write-Host "`nFAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
