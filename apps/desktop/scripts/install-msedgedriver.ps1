# Installs the msedgedriver that matches the WebView2 runtime on this machine and
# puts it first on the PATH of the following workflow steps (§ 3.183 Nr. 9).
#
# Why this exists: @wdio/tauri-service downloads the driver itself when the one
# on the PATH does not match, with a script run by Windows PowerShell 5.1
# (Expand-Archive). On the runner image that script failed in every run, green
# ones included: "Cannot find an overload for ExtractToDirectory and the
# argument count: 3" (wdio.log of runs 44426951189 and 45214331102). The service
# then went on "anyway" with whatever driver it found. Here PowerShell 7 does the
# extraction, and the service finds a matching driver and skips its own download.
#
# Run with pwsh. Fails the step when no matching driver can be installed:
# a driver of the wrong major version is the failure this is meant to rule out.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$registryPaths = @(
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$webview = $null
foreach ($runtimeKey in $registryPaths) {
  $pv = (Get-ItemProperty -Path $runtimeKey -Name pv -ErrorAction SilentlyContinue).pv
  if ($pv) { $webview = [string]$pv; break }
}
if (-not $webview) { throw 'WebView2 runtime version not found in the EdgeUpdate registry keys' }
$major = ($webview -split '\.')[0]
if ($major -notmatch '^\d+$') { throw "Unexpected WebView2 runtime version: '$webview'" }
Write-Host "WebView2 runtime $webview (major $major)"

$existing = Get-Command msedgedriver.exe -ErrorAction SilentlyContinue
if ($existing) {
  $found = (& $existing.Source --version) -join ' '
  Write-Host "msedgedriver on the PATH: $found"
  if ($found -match "MSEdgeDriver $major\.") { Write-Host 'Matches; nothing to install.'; exit 0 }
}

# Microsoft serves LATEST_RELEASE_<major> as application/octet-stream with a
# UTF-16LE BOM. PowerShell 7 returns that as [byte[]] in .Content, not [string].
$resp = Invoke-WebRequest -Uri "https://msedgedriver.microsoft.com/LATEST_RELEASE_$major" -TimeoutSec 30
if ($resp.Content -is [byte[]]) {
  $ms = [System.IO.MemoryStream]::new($resp.Content)
  try {
    $reader = [System.IO.StreamReader]::new($ms, [System.Text.Encoding]::UTF8, $true)
    try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally {
    $ms.Dispose()
  }
} else {
  $raw = [string]$resp.Content
}
$version = ($raw -replace '[^0-9.]', '').Trim()
if ($version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Unexpected driver version answer: '$version'" }

$arch = if ([Environment]::Is64BitOperatingSystem) { 'win64' } else { 'win32' }
$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$dir = Join-Path $base "msedgedriver-$version"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$zip = Join-Path $dir 'edgedriver.zip'
Invoke-WebRequest -Uri "https://msedgedriver.microsoft.com/$version/edgedriver_$arch.zip" -OutFile $zip -TimeoutSec 120
Expand-Archive -Path $zip -DestinationPath $dir -Force
Remove-Item $zip -ErrorAction SilentlyContinue
$exe = Join-Path $dir 'msedgedriver.exe'
if (-not (Test-Path $exe)) { throw "msedgedriver.exe missing after extraction in $dir" }

if ($env:GITHUB_PATH) { Add-Content -Path $env:GITHUB_PATH -Value $dir }
Write-Host "Installed: $((& $exe --version) -join ' ') -> $dir"
