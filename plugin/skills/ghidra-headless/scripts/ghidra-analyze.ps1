# PowerShell wrapper for Ghidra headless analysis (Windows native)
# Mirrors the .sh wrapper but uses PowerShell conventions.
# Built-in scripts under ghidra_scripts/ are auto-discovered via -scriptPath.
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [string]$Binary,

    [Alias('o')]
    [string]$Output = (Get-Location).Path,

    [Alias('s')]
    [string[]]$Script = @(),

    [Alias('a')]
    [string[]]$ScriptArgs = @(),

    [string]$ScriptPath,

    [Alias('p')]
    [string]$Processor,

    [Alias('c')]
    [string]$Cspec,

    [switch]$NoAnalysis,

    [int]$Timeout,

    [switch]$KeepProject,

    [string]$ProjectDir = $env:TEMP,

    [string]$ProjectName,

    [string]$Loader,

    [string[]]$LibrarySearchPath,

    [int]$MaxCpu,

    [string]$MaxMemory,

    [Parameter(ValueFromRemainingArguments)]
    [string[]]$Remaining
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot

# Locate analyzeHeadless.bat
$analyzeHeadless = & (Join-Path $scriptDir 'find-ghidra.ps1')
if (-not $analyzeHeadless) { throw 'find-ghidra.ps1 returned no path' }
$ghidraHome = Split-Path -Parent (Split-Path -Parent $analyzeHeadless)
$env:GHIDRA_HOME = $ghidraHome

if (-not (Test-Path -LiteralPath $Binary)) {
    throw "Binary file not found: $Binary"
}
$binaryFull = (Resolve-Path -LiteralPath $Binary).Path

if (-not (Test-Path -LiteralPath $Output)) {
    New-Item -ItemType Directory -Path $Output -Force | Out-Null
}
$outputFull = (Resolve-Path -LiteralPath $Output).Path
$env:GHIDRA_OUTPUT_DIR = $outputFull

if (-not $ProjectName) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($binaryFull) -replace '[^A-Za-z0-9_]', '_'
    $ProjectName = "ghidra_${base}_$PID"
}

# Combine built-in script dir with user-supplied path(s)
$builtinScripts = Join-Path $scriptDir 'ghidra_scripts'
$fullScriptPath = if ($ScriptPath) { "$builtinScripts;$ScriptPath" } else { $builtinScripts }

# Build argument list for analyzeHeadless.bat
$args = @($ProjectDir, $ProjectName, '-import', $binaryFull, '-scriptPath', $fullScriptPath)

# -postScript pairs. Each entry in $Script gets its own -postScript flag.
# $ScriptArgs entries are formatted as "<scriptIndex>:<argstring>" (1-based to match .sh).
for ($i = 0; $i -lt $Script.Count; $i++) {
    $args += '-postScript'
    $args += $Script[$i]
    foreach ($entry in $ScriptArgs) {
        if ($entry -match '^(\d+):(.*)$') {
            $idx = [int]$Matches[1]
            if ($idx -eq ($i + 1)) {
                # Word-split args.
                $args += ($Matches[2] -split '\s+' | Where-Object { $_ })
            }
        }
    }
}

if ($Processor)            { $args += @('-processor', $Processor) }
if ($Cspec)                { $args += @('-cspec', $Cspec) }
if ($NoAnalysis)           { $args += '-noanalysis' }
if ($Timeout -gt 0)        { $args += @('-analysisTimeoutPerFile', $Timeout.ToString()) }
if (-not $KeepProject)     { $args += '-deleteProject' }
if ($Loader)               { $args += @('-loader', $Loader) }
if ($LibrarySearchPath)    { $args += @('-librarySearchPaths', ($LibrarySearchPath -join ';')) }
if ($MaxCpu -gt 0)         { $args += @('-max-cpu', $MaxCpu.ToString()) }
$logFile = Join-Path $outputFull 'ghidra_analysis.log'
$args += @('-log', $logFile)
if ($Remaining) { $args += $Remaining }

# MAXMEM is read by support/launch.bat as %MAXMEM%, scoped to the child process.
if ($MaxMemory) { $env:MAXMEM = $MaxMemory }

Write-Verbose "Running: $analyzeHeadless $($args -join ' ')"

$outputLog = Join-Path $outputFull 'ghidra_output.log'
& $analyzeHeadless @args 2>&1 | Tee-Object -FilePath $outputLog
$exitCode = $LASTEXITCODE

if ($MaxMemory) { Remove-Item Env:\MAXMEM -ErrorAction SilentlyContinue }

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "Analysis complete. Output files in: $outputFull"
    Get-ChildItem -LiteralPath $outputFull | Format-Table Mode, LastWriteTime, Length, Name -AutoSize
}
else {
    Write-Error "Analysis failed with exit code $exitCode. See $logFile"
}
exit $exitCode
