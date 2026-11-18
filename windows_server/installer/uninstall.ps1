# ASTA Server uninstaller (Settings → Apps → ASTA Server → Uninstall).
$ErrorActionPreference = "Continue"
$InstallDir = $PSScriptRoot
$TaskName = "ASTA Server"
$DataDir = Join-Path $env:ProgramData "ASTAServer"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    exit
}

Add-Type -AssemblyName System.Windows.Forms
$ok = [System.Windows.Forms.MessageBox]::Show("Remove ASTA Server from this PC?", "ASTA Server", "YesNo", "Question")
if ($ok -ne "Yes") { exit }
$keep = [System.Windows.Forms.MessageBox]::Show(
    "Keep the data (accounts, meetings, recordings, settings and API keys) in $DataDir ?`n`nChoose Yes to keep it for a later re-install. Choose No to delete it permanently.",
    "ASTA Server", "YesNo", "Question")

Set-Location $env:TEMP
if (Test-Path $DataDir) { New-Item -ItemType File -Force -Path (Join-Path $DataDir "stop.flag") | Out-Null }
Start-Sleep -Seconds 6
schtasks /End /TN $TaskName 2>$null | Out-Null
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
foreach ($r in "ASTA Server (Python)", "ASTA Server (LiveKit)") { netsh advfirewall firewall delete rule name="$r" | Out-Null }
Remove-Item (Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "ASTA Server.lnk") -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "ASTA Server.lnk") -ErrorAction SilentlyContinue
Remove-Item "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAServer" -Recurse -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
if ($keep -eq "No") { Remove-Item -Recurse -Force $DataDir -ErrorAction SilentlyContinue }

[System.Windows.Forms.MessageBox]::Show("ASTA Server was removed." + $(if ($keep -eq "Yes") { "`nYour data is still in $DataDir." } else { "" }), "ASTA Server") | Out-Null
