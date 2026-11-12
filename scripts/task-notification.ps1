param([string]$Payload)
$ErrorActionPreference = 'Stop'
$notice = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icon = [System.Windows.Forms.NotifyIcon]::new()
try {
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.Visible = $true
    $icon.BalloonTipTitle = $notice.title
    $icon.BalloonTipText = $notice.message
    $icon.ShowBalloonTip(5000)
    Start-Sleep -Seconds 6
} finally {
    $icon.Dispose()
}
