# Locate Ghidra installation and analyzeHeadless.bat (Windows native)
# PowerShell port of find-ghidra.sh
# Outputs the absolute path to analyzeHeadless.bat on stdout.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Test-AnalyzeHeadless([string]$root) {
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { return $null }
    $bat = Join-Path $root 'support\analyzeHeadless.bat'
    if (Test-Path -LiteralPath $bat) { return (Resolve-Path $bat).Path }
    return $null
}

# 1. Honor explicit env vars
foreach ($var in 'GHIDRA_INSTALL_DIR', 'GHIDRA_HOME') {
    $v = [Environment]::GetEnvironmentVariable($var)
    if ($v) {
        $hit = Test-AnalyzeHeadless $v
        if ($hit) { Write-Output $hit; exit 0 }
    }
}

# 2. Common Windows install locations
$candidates = @(
    "$env:USERPROFILE\ghidra",
    "$env:LOCALAPPDATA\Programs\ghidra",
    'C:\ghidra',
    'C:\Tools\ghidra',
    'C:\Program Files\ghidra',
    "$env:USERPROFILE\Tools\ghidra"
)
foreach ($c in $candidates) {
    $hit = Test-AnalyzeHeadless $c
    if ($hit) { Write-Output $hit; exit 0 }
}

# 3. Versioned dirs (e.g. ghidra_12.0.4_PUBLIC) inside known parents
$parents = @(
    "$env:USERPROFILE", "$env:USERPROFILE\Tools",
    "$env:LOCALAPPDATA\Programs", 'C:\', 'C:\Tools', 'C:\Program Files'
)
foreach ($parent in $parents) {
    if (-not (Test-Path -LiteralPath $parent)) { continue }
    $matches = Get-ChildItem -LiteralPath $parent -Directory -Filter 'ghidra*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    foreach ($m in $matches) {
        $hit = Test-AnalyzeHeadless $m.FullName
        if ($hit) { Write-Output $hit; exit 0 }
    }
}

# 4. Last resort: PATH lookup
$cmd = Get-Command analyzeHeadless.bat -ErrorAction SilentlyContinue
if ($cmd) { Write-Output $cmd.Source; exit 0 }

Write-Error "Could not find Ghidra's analyzeHeadless.bat. Set `$env:GHIDRA_INSTALL_DIR (or `$env:GHIDRA_HOME) to the Ghidra install root, or install Ghidra to one of: $($candidates -join '; ')."
exit 1
