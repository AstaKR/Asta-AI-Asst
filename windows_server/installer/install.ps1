# ASTA Server installer (run by ASTA-Server-Setup.exe through install.cmd).
#   -Payload    the payload.zip next to this script
#   -InstallDir default C:\Program Files\ASTA Server
#   -TestMode   extract and set up only: no firewall rules, start-up task, shortcuts or Add/Remove Programs entry
#   -Unattended run from Setup.exe's window (already elevated; no prompts, output goes to the window)
param(
    [string]$Payload = (Join-Path $PSScriptRoot "payload.zip"),
    [string]$InstallDir = (Join-Path $env:ProgramFiles "ASTA Server"),
    [switch]$TestMode,
    [switch]$Unattended
)

$ErrorActionPreference = "Stop"
$TaskName = "ASTA Server"
$DataDir = if ($env:ASTA_DATA_DIR) { $env:ASTA_DATA_DIR } else { Join-Path $env:ProgramData "ASTAServer" }
$UninstallKey = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ASTAServer"

function Say($msg) { Write-Host "  $msg" }

# ---------- run as administrator ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $TestMode) {
    # -Wait: Setup.exe deletes its temporary folder (and payload.zip) when this script returns.
    $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Payload", "`"$Payload`"", "-InstallDir", "`"$InstallDir`"")
    Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList $argList
    exit
}

if (-not $Unattended) { $Host.UI.RawUI.WindowTitle = "Installing Asta Talk Server" }
Write-Host ""
Write-Host "  Asta Talk Server setup" -ForegroundColor Cyan
Write-Host "  -----------------"

try {
    # ---------- stop an older version ----------
    if (Test-Path $InstallDir) {
        Say "Stopping the running server (upgrade)..."
        if (Test-Path $DataDir) { New-Item -ItemType File -Force -Path (Join-Path $DataDir "stop.flag") | Out-Null }
        Start-Sleep -Seconds 6
        if (-not $TestMode) { schtasks /End /TN $TaskName 2>$null | Out-Null }
        Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } |
            Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        foreach ($d in "runtime", "app", "web", "livekit") {
            $p = Join-Path $InstallDir $d
            if (Test-Path $p) { Remove-Item -Recurse -Force $p }
        }
    }

    # ---------- files ----------
    Say "Copying files to $InstallDir ..."
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    & "$env:SystemRoot\System32\tar.exe" -x -f $Payload -C $InstallDir
    if ($LASTEXITCODE -ne 0) { throw "Could not extract the files (tar exit code $LASTEXITCODE)." }

    $py = Join-Path $InstallDir "runtime\python.exe"
    $pyw = Join-Path $InstallDir "runtime\pythonw.exe"
    $app = Join-Path $InstallDir "app"
    $lk = Join-Path $InstallDir "livekit\livekit-server.exe"
    $version = (Get-Content (Join-Path $InstallDir "VERSION.txt") -ErrorAction SilentlyContinue | Select-Object -First 1)

    # ---------- data folder: settings, database, recordings (Administrators + SYSTEM only) ----------
    Say "Preparing the data folder $DataDir ..."
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    if (-not $TestMode) {
        icacls $DataDir /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
    }
    Push-Location $app
    $env:ASTA_DATA_DIR = $DataDir
    & $py -m asta_server.tools init
    if ($LASTEXITCODE -ne 0) { throw "Could not create the settings." }
    Pop-Location

    if (-not $TestMode) {
        # ---------- firewall: allow this server's programs on Private/Domain networks ----------
        Say "Adding Windows Firewall rules..."
        foreach ($r in "ASTA Server (Python)", "ASTA Server (LiveKit)") { netsh advfirewall firewall delete rule name="$r" | Out-Null }
        netsh advfirewall firewall add rule name="ASTA Server (Python)" dir=in action=allow program="$py" enable=yes profile=private,domain | Out-Null
        netsh advfirewall firewall add rule name="ASTA Server (LiveKit)" dir=in action=allow program="$lk" enable=yes profile=private,domain | Out-Null

        # ---------- start with Windows (runs even when nobody is signed in) ----------
        Say "Setting the server to start with Windows..."
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        $action = New-ScheduledTaskAction -Execute $pyw -Argument "-m asta_server.supervisor" -WorkingDirectory $app
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
            -Description "Runs the ASTA translator server (website, calls, meetings)." | Out-Null

        # ---------- shortcuts ----------
        Say "Creating shortcuts..."
        $shell = New-Object -ComObject WScript.Shell
        $icon = Join-Path $InstallDir "asta.ico"
        foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "ASTA Server.lnk"), (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "ASTA Server.lnk"))) {
            $s = $shell.CreateShortcut($lnk)
            $s.TargetPath = $pyw
            $s.Arguments = "-m asta_server.manager"
            $s.WorkingDirectory = $app
            $s.Description = "ASTA Server settings"
            if (Test-Path $icon) { $s.IconLocation = $icon }
            $s.Save()
        }

        # ---------- Add/Remove Programs ----------
        $sizeKb = [int]((Get-ChildItem $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
        New-Item -Path $UninstallKey -Force | Out-Null
        $uninst = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
        $props = @{
            DisplayName = "ASTA Server"; DisplayVersion = "$version"; Publisher = "LevelUp Systems"; InstallLocation = $InstallDir
            DisplayIcon = (Join-Path $InstallDir "asta.ico"); UninstallString = $uninst; NoModify = 1; NoRepair = 1; EstimatedSize = $sizeKb
        }
        foreach ($k in $props.Keys) { Set-ItemProperty -Path $UninstallKey -Name $k -Value $props[$k] }

        # ---------- start ----------
        Say "Starting the server..."
        Remove-Item (Join-Path $DataDir "stop.flag") -ErrorAction SilentlyContinue
        Start-ScheduledTask -TaskName $TaskName
        Start-Process -FilePath $pyw -ArgumentList "-m asta_server.manager" -WorkingDirectory $app
    }

    Write-Host ""
    Write-Host "  Asta Talk Server $version is installed." -ForegroundColor Green
    Write-Host "  In the Asta Talk Server window: create the administrator account and add the AI keys."
    if (-not $TestMode -and -not $Unattended) { Start-Sleep -Seconds 4 }
    exit 0
}
catch {
    Write-Host ""
    Write-Host "  Installation failed: $($_.Exception.Message)" -ForegroundColor Red
    if (-not $TestMode -and -not $Unattended) {
        Write-Host "  Press Enter to close."
        Read-Host | Out-Null
    }
    exit 1
}
