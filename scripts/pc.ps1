#requires -version 5.1
<#
.SYNOPSIS
    Controle do PC para o J.A.R.V.I.S.

.DESCRIPTION
    Acoes de controle local: screenshot, volume, mute, midia, lock e abertura
    de apps (whitelist). Imprime apenas o necessario no stdout.

.PARAMETER Action
    screenshot | volume-up | volume-down | mute | media-play-pause | media-next
    | media-prev | lock | open | test

.PARAMETER Value
    Para -Action open: URL http(s) ou nome de app da whitelist.

.EXAMPLE
    powershell -NoProfile -File scripts\pc.ps1 screenshot

.EXAMPLE
    powershell -NoProfile -File scripts\pc.ps1 open -Value notepad

.NOTES
    Codigos de saida: 0 = ok, 1 = erro de execucao, 2 = acao/valor invalido.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Action,

    [Parameter(Position = 1)]
    [string]$Value = ""
)

$ErrorActionPreference = 'Stop'

$Project   = Split-Path -Parent $PSScriptRoot
$ScreenDir = Join-Path $Project '.data\screens'

trap {
    [Console]::Error.WriteLine("Erro ao executar '$Action': $($_.Exception.Message)")
    exit 1
}

function Initialize-DpiAware {
    # Garante captura em resolucao real em telas com escala (125%, 150%...).
    try {
        if (-not ([System.Management.Automation.PSTypeName]'Jarvis.NativeDpi').Type) {
            Add-Type -Namespace Jarvis -Name NativeDpi -MemberDefinition @'
[DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
'@
        }
        [void][Jarvis.NativeDpi]::SetProcessDPIAware()
    } catch {
        # Sem DPI awareness a captura ainda funciona, apenas em escala logica.
    }
}

function Send-KeyCode {
    param([Parameter(Mandatory = $true)][int]$Code)
    try {
        $wsh = New-Object -ComObject WScript.Shell
        try {
            $wsh.SendKeys([char]$Code)
        } finally {
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wsh)
        }
    } catch {
        # Fallback: keybd_event direto (teclas de midia/volume sao virtuais).
        if (-not ([System.Management.Automation.PSTypeName]'Jarvis.NativeKeys').Type) {
            Add-Type -Namespace Jarvis -Name NativeKeys -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@
        }
        [Jarvis.NativeKeys]::keybd_event([byte]$Code, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 40
        [Jarvis.NativeKeys]::keybd_event([byte]$Code, 0, 2, [UIntPtr]::Zero)
    }
}

function Invoke-Screenshot {
    if (-not (Test-Path -LiteralPath $ScreenDir)) {
        New-Item -ItemType Directory -Path $ScreenDir -Force | Out-Null
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Initialize-DpiAware

    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp    = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $ms     = New-Object System.IO.MemoryStream
    try {
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
        } finally {
            $gfx.Dispose()
        }

        # Salva via MemoryStream para sobrescrever com seguranca e evitar lock.
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $path = Join-Path $ScreenDir ('shot-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
        [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
    } finally {
        $ms.Dispose()
        $bmp.Dispose()
    }

    Write-Output $path
}

function Get-AppCandidates {
    param([string]$Name)

    switch ($Name) {
        'chrome' {
            @(
                'chrome.exe',
                "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
                "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
            )
        }
        'edge' {
            @(
                'msedge.exe',
                "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
                "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
            )
        }
        'spotify' {
            @(
                "$env:APPDATA\Spotify\Spotify.exe",
                'spotify.exe',
                'spotify:'
            )
        }
        'notepad'   { @('notepad.exe') }
        'explorer'  { @('explorer.exe') }
        'vscode'    { @('code.cmd', 'code', "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe") }
        'code'      { @('code.cmd', 'code', "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe") }
        'calc'      { @('calc.exe') }
        'whatsapp'  {
            @(
                "$env:LOCALAPPDATA\WhatsApp\WhatsApp.exe",
                'whatsapp.exe',
                'whatsapp:'
            )
        }
        'telegram'  {
            @(
                "$env:APPDATA\Telegram Desktop\Telegram.exe",
                'telegram.exe',
                'tg://'
            )
        }
        default { @() }
    }
}

function Resolve-StartApp {
    # Apps modernas (Store/UWP) nao tem .exe acessivel: resolve pelo AppID.
    param([string]$Name)

    $patterns = @{
        'chrome'   = '^Google Chrome$'
        'edge'     = '^Microsoft Edge$'
        'spotify'  = 'Spotify'
        'notepad'  = 'Notepad'
        'explorer' = 'File Explorer|Windows Explorer'
        'vscode'   = 'Visual Studio Code'
        'code'     = 'Visual Studio Code'
        'calc'     = 'Calculator|Calculadora'
        'whatsapp' = 'WhatsApp'
        'telegram' = 'Telegram'
    }

    if (-not $patterns.ContainsKey($Name)) { return $null }

    try {
        $app = Get-StartApps -ErrorAction Stop |
            Where-Object { $_.Name -match $patterns[$Name] } |
            Select-Object -First 1
        if ($app) { return "shell:AppsFolder\$($app.AppID)" }
    } catch {
        # Get-StartApps indisponivel: segue sem o fallback.
    }

    return $null
}

function Start-AppTarget {
    param(
        [string[]]$Candidates,
        [string]$Alias = ""
    )

    foreach ($candidate in $Candidates) {
        try {
            if ([System.IO.Path]::IsPathRooted($candidate)) {
                if (-not (Test-Path -LiteralPath $candidate)) { continue }
                Start-Process -FilePath $candidate -ErrorAction Stop
            } elseif ($candidate -match '^[a-zA-Z][a-zA-Z0-9+.\-]*:') {
                # Protocolo/URI registrado (spotify:, whatsapp:, tg://).
                Start-Process -FilePath $candidate -ErrorAction Stop
            } else {
                $cmd = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($cmd -and $cmd.Source) {
                    Start-Process -FilePath $cmd.Source -ErrorAction Stop
                } else {
                    Start-Process -FilePath $candidate -ErrorAction Stop
                }
            }
            return $true
        } catch {
            # Tenta o proximo candidato.
        }
    }

    if ($Alias) {
        $shellTarget = Resolve-StartApp -Name $Alias
        if ($shellTarget) {
            try {
                Start-Process -FilePath $shellTarget -ErrorAction Stop
                return $true
            } catch {
                # Sem fallback possivel.
            }
        }
    }

    return $false
}

$verb = $Action.ToLowerInvariant().Trim()

switch ($verb) {
    'screenshot' { Invoke-Screenshot }

    'volume-up'   { Send-KeyCode 175 }
    'volume-down' { Send-KeyCode 174 }
    'mute'        { Send-KeyCode 173 }

    'media-play-pause' { Send-KeyCode 179 }
    'media-next'       { Send-KeyCode 176 }
    'media-prev'       { Send-KeyCode 177 }

    'lock' {
        Start-Process -FilePath 'rundll32.exe' -ArgumentList 'user32.dll,LockWorkStation' -ErrorAction Stop
    }

    'open' {
        $target = $Value.Trim()
        if ([string]::IsNullOrWhiteSpace($target)) {
            [Console]::Error.WriteLine("Acao 'open' exige -Value com URL http(s) ou app da whitelist.")
            exit 2
        }

        if ($target -match '^https?://') {
            Start-Process -FilePath $target -ErrorAction Stop
        } else {
            $name = $target.ToLowerInvariant()
            $candidates = Get-AppCandidates -Name $name

            if ($candidates.Count -eq 0) {
                [Console]::Error.WriteLine(
                    "App nao permitida: '$target'. Whitelist: chrome, edge, spotify, notepad, explorer, vscode (code), calc, whatsapp, telegram."
                )
                exit 2
            }

            if (-not (Start-AppTarget -Candidates $candidates -Alias $name)) {
                [Console]::Error.WriteLine("Nao foi possivel abrir '$target' (nenhum executavel/protocolo encontrado).")
                exit 1
            }
        }
    }

    'test' {
        Write-Output 'ok'
    }

    default {
        [Console]::Error.WriteLine(
            "Acao invalida: '$Action'. Validas: screenshot, volume-up, volume-down, mute, media-play-pause, media-next, media-prev, lock, open, test."
        )
        exit 2
    }
}

exit 0
