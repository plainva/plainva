# What the built Windows installers start (0.9.0 is the first release with two
# programs in every package: the app and the MCP helper). The counterpart of
# check-package-entry.sh; the names are those of package-entry.mjs (MAIN,
# HELPER), src/packageEntry.test.ts holds them together.
#
#   - MSI, read without installing: its File table carries both programs, and
#     every shortcut that points at a file (Start menu, desktop) points at
#     the app;
#   - NSIS, installed silently for the current user (its default): the
#     uninstall entry names the app as MainBinaryName, both programs are in
#     the install folder, the Start-menu shortcut points at the app; the app
#     is started through that shortcut's target. Evidence: within
#     $env:PLAINVA_START_TIMEOUT seconds (default 45, polled every second, a
#     slow start is waited for, never retried) a process named
#     plainva-desktop has a main window (MainWindowHandle not 0), and it
#     still runs 3 seconds later. A failure names what was missing: never
#     started, ended early with its exit code, another process name, no
#     window. The app is a GUI-subsystem program without console output, so
#     there are no output lines to show. Then it is stopped and the
#     installer's own uninstaller removes it again.
#
# Not installed: the MSI. It installs per machine (administrator rights, a
# change to the runner that outlives the step); it is read only, and the
# start on Windows is the NSIS one.
$ErrorActionPreference = 'Stop'

$main = 'plainva-desktop.exe'
$helper = 'plainva-mcp.exe'
$bundle = Join-Path $PSScriptRoot '../src-tauri/target/release/bundle'
$timeout = if ($env:PLAINVA_START_TIMEOUT) { [int]$env:PLAINVA_START_TIMEOUT } else { 45 }
$problems = [System.Collections.Generic.List[string]]::new()

function Invoke-Com($obj, [string]$member, [System.Reflection.BindingFlags]$kind, [object[]]$params) {
  $obj.GetType().InvokeMember($member, $kind, $null, $obj, $params)
}
$call = [System.Reflection.BindingFlags]::InvokeMethod
$get = [System.Reflection.BindingFlags]::GetProperty

function Get-MsiRows($db, [string]$sql, [int]$columns) {
  $view = Invoke-Com $db 'OpenView' $call @($sql)
  Invoke-Com $view 'Execute' $call $null | Out-Null
  $rows = @()
  while ($true) {
    $record = Invoke-Com $view 'Fetch' $call $null
    if ($null -eq $record) { break }
    $rows += , @(1..$columns | ForEach-Object { Invoke-Com $record 'StringData' $get @($_) })
  }
  Invoke-Com $view 'Close' $call $null | Out-Null
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($view)
  return , $rows
}

# --- MSI ---------------------------------------------------------------
$msi = (Get-ChildItem (Join-Path $bundle 'msi/*.msi') | Select-Object -First 1).FullName
if (-not $msi) { throw 'no MSI was built' }
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = Invoke-Com $installer 'OpenDatabase' $call @($msi, 0)
# FileName is "SHORT~1.EXE|long-name.exe" when the long name is not 8.3.
$files = @{}
foreach ($row in (Get-MsiRows $db 'SELECT `File`, `FileName` FROM `File`' 2)) { $files[$row[0]] = ($row[1] -split '\|')[-1] }
$shortcuts = Get-MsiRows $db 'SELECT `Shortcut`, `Target` FROM `Shortcut`' 2
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($db)
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($installer)

foreach ($program in @($main, $helper)) {
  if ($files.Values -notcontains $program) { $problems.Add("$(Split-Path $msi -Leaf): $program is not in its File table") }
}
$toFiles = @($shortcuts | Where-Object { $_[1] -match '^\[[!#](.+)\]$' })
if ($toFiles.Count -eq 0) { $problems.Add("$(Split-Path $msi -Leaf): no shortcut points at a file") }
foreach ($s in $toFiles) {
  $null = $s[1] -match '^\[[!#](.+)\]$'
  $name = $files[$Matches[1]]
  if ($name -ne $main) { $problems.Add("$(Split-Path $msi -Leaf): shortcut $($s[0]) points at $name, not $main") }
  else { Write-Host "$(Split-Path $msi -Leaf): shortcut $($s[0]) -> $name" }
}

# --- NSIS --------------------------------------------------------------
$setup = (Get-ChildItem (Join-Path $bundle 'nsis/*-setup.exe') | Select-Object -First 1).FullName
if (-not $setup) { throw 'no NSIS installer was built' }
$leaf = Split-Path $setup -Leaf
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "$leaf /S exited $($p.ExitCode)" }

$entry = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' |
  ForEach-Object { Get-ItemProperty $_.PSPath } |
  Where-Object { $_.DisplayName -eq 'Plainva' } | Select-Object -First 1
if (-not $entry) { throw "$leaf installed no uninstall entry named Plainva for the current user" }
if ($entry.MainBinaryName -ne $main) { $problems.Add("${leaf}: MainBinaryName is $($entry.MainBinaryName), not $main") }
$uninstaller = ($entry.UninstallString -replace '"', '')
$dir = Split-Path $uninstaller -Parent
foreach ($program in @($main, $helper)) {
  if (-not (Test-Path (Join-Path $dir $program))) { $problems.Add("${leaf}: $program is not in $dir") }
}

# For the record of a run: the parts that are new in 0.9.0, by size.
Get-ChildItem $dir -Recurse -File |
  Where-Object { $_.Name -in @($main, $helper) -or $_.Name -like 'onnxruntime*.dll' } |
  ForEach-Object { Write-Host ("  {0}: {1} bytes ({2:N2} MiB)" -f $_.FullName.Substring($dir.Length + 1), $_.Length, ($_.Length / 1MB)) }

$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Plainva.lnk'
$started = $false
try {
  if (-not (Test-Path $lnk)) { $problems.Add("${leaf}: no Start-menu shortcut at $lnk") }
  else {
    $shell = New-Object -ComObject WScript.Shell
    $targetPath = $shell.CreateShortcut($lnk).TargetPath
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
    if ((Split-Path $targetPath -Leaf) -ne $main) { $problems.Add("${leaf}: the Start-menu shortcut points at $targetPath, not $main") }
    else {
      Write-Host "${leaf}: Start-menu shortcut -> $targetPath"
      $name = [IO.Path]::GetFileNameWithoutExtension($main)
      $proc = Start-Process -FilePath $targetPath -PassThru
      $why = $null
      $window = $false
      $seen = $false
      for ($i = 0; $i -lt $timeout; $i++) {
        Start-Sleep -Seconds 1
        $running = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
        if ($running.Count) { $seen = $true }
        if ($running | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero }) { $window = $true; break }
        if ($proc.HasExited -and $running.Count -eq 0) {
          $why = if ($seen) { "$main started and ended before a window appeared (exit code $($proc.ExitCode))" } else { "$main never ran: the started process ended with exit code $($proc.ExitCode)" }
          break
        }
      }
      if (-not $why -and -not $window) {
        $running = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
        if ($running.Count -eq 0) {
          $other = if ($proc.HasExited) { "the started process ended with exit code $($proc.ExitCode)" } else { "the started process runs as $($proc.ProcessName)" }
          $why = "no process named $name after $timeout s ($other)"
        } else { $why = "$main runs, but has no main window after $timeout s" }
      }
      if (-not $why) {
        Start-Sleep -Seconds 3
        if (@(Get-Process -Name $name -ErrorAction SilentlyContinue).Count -eq 0) { $why = "$main ended within 3 s after its window appeared" }
      }
      if ($why) { $problems.Add("${leaf}: $why") }
      else { $started = $true; Write-Host "${leaf}: $main is running with its main window" }
    }
  }
} finally {
  Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($main)) -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  if (Test-Path $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait | Out-Null }
}

if ($problems.Count) {
  foreach ($problem in $problems) { Write-Host "::error::$problem" }
  exit 1
}
Write-Host "Both installers start $main and carry $helper$(if ($started) { '; the installed app started' })."
