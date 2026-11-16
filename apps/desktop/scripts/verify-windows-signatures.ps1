# Verify that every Windows artifact a release ships is signed AND timestamped:
# both installers, and the application binary and the MCP helper inside each
# of them. Called by release.yml on the Windows leg of a release and of a
# release rehearsal, so the rehearsal measures with the same check.
#
# Why each part exists is told in the comments below and in release.yml.
$ErrorActionPreference = 'Stop'
$root = "apps/desktop/src-tauri/target/release"
$targets = @(
  "$root/bundle/nsis/*.exe",
  "$root/bundle/msi/*.msi"
)
# NOT "$root/plainva-desktop.exe": that is the raw build output, which Tauri
# never signs — it signs the copy it packs into the installers. Checking it
# failed the 0.6.8 cut for a file nobody ships. The binaries a user actually
# gets are the ones inside the installers, so extract BOTH installers and
# measure what is inside (finding 2026-08-22). The MCP helper (plan KI-Harness
# §17.3) ships beside the app and is started by other programs, so it is
# measured like the app itself, in each installer.
#
# Every gap here fails the step (review of the release rehearsal, 2026-11-16):
# an installer that cannot be unpacked, or that lacks the app or the helper,
# is a release that cannot be shown to be signed, not a warning.
$failed = @()
$inside = @("plainva-desktop.exe", "plainva-mcp.exe")
function Add-Inside([string]$installer, [string]$dir) {
  foreach ($name in $inside) {
    $found = Get-ChildItem -Path $dir -Recurse -Filter $name -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) { $script:targets += $found.FullName }
    else { $script:failed += "$name is missing from $installer" }
  }
}

# MSI: an administrative install unpacks the files without installing them.
$msi = Get-ChildItem -Path "$root/bundle/msi/*.msi" -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($msi) {
  $extract = Join-Path $env:RUNNER_TEMP "msi-extract"
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  $p = Start-Process msiexec -ArgumentList "/a `"$($msi.FullName)`" /qn TARGETDIR=`"$extract`"" -Wait -PassThru
  if ($p.ExitCode -eq 0) { Add-Inside $msi.Name $extract }
  else { $failed += "msiexec /a could not unpack $($msi.Name) (exit $($p.ExitCode))" }
}

# NSIS: 7-Zip reads the installer's archive (preinstalled on the GitHub
# Windows images). Measured on the published 0.8.7 setup with 7-Zip 23.01:
# it lists and extracts plainva-desktop.exe byte for byte, signature block
# included.
$nsis = Get-ChildItem -Path "$root/bundle/nsis/*.exe" -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($nsis) {
  $sevenZip = (Get-Command 7z -ErrorAction SilentlyContinue).Source
  if (-not $sevenZip -and (Test-Path "$env:ProgramFiles\7-Zip\7z.exe")) { $sevenZip = "$env:ProgramFiles\7-Zip\7z.exe" }
  if (-not $sevenZip) {
    $failed += "7-Zip is not available to unpack $($nsis.Name)"
  } else {
    $extract = Join-Path $env:RUNNER_TEMP "nsis-extract"
    New-Item -ItemType Directory -Force -Path $extract | Out-Null
    & $sevenZip x -y "-o$extract" $nsis.FullName | Out-Null
    if ($LASTEXITCODE -eq 0) { Add-Inside $nsis.Name $extract }
    else { $failed += "7-Zip could not unpack $($nsis.Name) (exit $LASTEXITCODE)" }
  }
}
$checked = 0
foreach ($pattern in $targets) {
  $files = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue
  if (-not $files) { $failed += "no artifact matched $pattern"; continue }
  foreach ($f in $files) {
    $checked++
    $sig = Get-AuthenticodeSignature $f.FullName
    $stamped = [bool]$sig.TimeStamperCertificate
    # Null-safe on purpose: an unsigned file has no SignerCertificate, and
    # $null.Subject.Split() throws — which killed the step before the two
    # checks below could report anything. A guard that crashes says nothing.
    $signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject.Split(',')[0] } else { '<unsigned>' }
    "{0}: {1}, timestamped={2}, signer={3}" -f $f.FullName, $sig.Status, $stamped, $signer
    if ($sig.Status -ne 'Valid') { $failed += "$($f.Name): status $($sig.Status)" }
    if (-not $stamped) { $failed += "$($f.Name): signed but NOT timestamped" }
  }
}
if ($failed.Count -gt 0) {
  $failed | ForEach-Object { Write-Host "::error::$_" }
  throw "Windows signature check failed ($($failed.Count) of $checked artifacts)"
}
"All $checked Windows artifacts are signed and timestamped."
