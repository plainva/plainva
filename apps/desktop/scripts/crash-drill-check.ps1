# Crash-safety drill check (hardening plan P2.5 / Release Gate Checklist §5).
#
# The drill itself is manual: open the vault in Plainva, type continuously in
# a note (or run an external edit loop), and kill the app hard at random
# moments — `taskkill /F /IM plainva.exe` (release) or kill the `pnpm tauri
# dev` process tree. Repeat a handful of times, once against a network-share
# vault. THEN run this script against the vault folder.
#
# It verifies the atomic-write guarantees:
#   1. no zero-byte .md files (a torn direct write would leave one)
#   2. no leftover .plainva-tmp-* temp files (failed writes must clean up;
#      a temp left by a HARD KILL mid-write is tolerated by the app — the
#      walker/watcher skip dot files — but is reported here for awareness)
#
# Usage: powershell -File crash-drill-check.ps1 -VaultPath C:\path\to\vault

param([Parameter(Mandatory = $true)][string]$VaultPath)

if (-not (Test-Path $VaultPath)) { Write-Error "vault not found: $VaultPath"; exit 2 }

$zeroByte = Get-ChildItem -Path $VaultPath -Recurse -File -Filter *.md |
  Where-Object { $_.Length -eq 0 -and $_.FullName -notmatch '\\\.plainva\\' }
$tempLeft = Get-ChildItem -Path $VaultPath -Recurse -File -Force |
  Where-Object { $_.Name -like '.plainva-tmp-*' }

$fail = $false
if ($zeroByte) {
  Write-Output "FAIL: zero-byte notes found (torn write):"
  $zeroByte | ForEach-Object { Write-Output "  $($_.FullName)" }
  $fail = $true
} else {
  Write-Output "OK: no zero-byte notes."
}
if ($tempLeft) {
  Write-Output "INFO: leftover atomic-write temp files (safe to delete, invisible to the app):"
  $tempLeft | ForEach-Object { Write-Output "  $($_.FullName)" }
} else {
  Write-Output "OK: no atomic-write temp files left behind."
}
if ($fail) { exit 1 } else { exit 0 }
