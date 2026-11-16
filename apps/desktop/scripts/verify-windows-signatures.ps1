# Verify that every Windows artifact a release ships is signed AND timestamped:
# both installers, the application binary inside the MSI and the MCP helper
# beside it. Called by release.yml on the Windows leg of a release and of a
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
# failed the 0.6.8 cut for a file nobody ships. The binary a user actually gets
# is the one inside the MSI, so extract it and measure that (finding 2026-08-22).
$extract = Join-Path $env:RUNNER_TEMP "msi-extract"
$msi = Get-ChildItem -Path "$root/bundle/msi/*.msi" -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($msi) {
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  $p = Start-Process msiexec -ArgumentList "/a `"$($msi.FullName)`" /qn TARGETDIR=`"$extract`"" -Wait -PassThru
  if ($p.ExitCode -eq 0) {
    $inner = Get-ChildItem -Path $extract -Recurse -Filter "plainva-desktop.exe" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($inner) { $targets += $inner.FullName }
    else { Write-Host "::warning::no plainva-desktop.exe inside the MSI" }
    # The MCP helper (plan KI-Harness §17.3) ships beside the app and is
    # started by other programs, so it is measured like the app itself.
    $helper = Get-ChildItem -Path $extract -Recurse -Filter "plainva-mcp.exe" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($helper) { $targets += $helper.FullName }
    else { $helperMissing = $true }
  } else {
    Write-Host "::warning::msiexec /a exited $($p.ExitCode); skipping the inner binary"
  }
}
$checked = 0
$failed = @()
if ($helperMissing) { $failed += "the MCP helper plainva-mcp.exe is missing from the MSI" }
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
    "{0}: {1}, timestamped={2}, signer={3}" -f $f.Name, $sig.Status, $stamped, $signer
    if ($sig.Status -ne 'Valid') { $failed += "$($f.Name): status $($sig.Status)" }
    if (-not $stamped) { $failed += "$($f.Name): signed but NOT timestamped" }
  }
}
if ($failed.Count -gt 0) {
  $failed | ForEach-Object { Write-Host "::error::$_" }
  throw "Windows signature check failed ($($failed.Count) of $checked artifacts)"
}
"All $checked Windows artifacts are signed and timestamped."
