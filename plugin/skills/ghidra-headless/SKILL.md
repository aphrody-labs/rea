---
name: ghidra-headless
description: >-
  Reverse engineers binaries using Ghidra's headless analyzer. Use when
  decompiling executables, extracting functions, strings, symbols, or
  analyzing call graphs from compiled binaries without the Ghidra GUI.
  Provides Windows-native PowerShell scripts AND bash scripts (for Linux/macOS).
---

# Ghidra Headless Analysis

Resolve `<plugin-root>` to the installed plugin directory before running an example; do not rely on Claude-specific environment variables.

Wraps Ghidra's `analyzeHeadless.bat` (Windows) / `analyzeHeadless` (Unix) so you can import a binary, run auto-analysis, and run post-scripts that emit JSON / text / decompiled C — all without opening the GUI.

Two equivalent script sets ship with this skill:

- **`*.ps1`** — pure PowerShell, Win32-native, no bash dependency. **Use these on Windows.**
- **`*.sh`** — bash, identical option surface. **Use these on Linux / macOS.**

The Java GhidraScripts in `scripts/ghidra_scripts/*.java` are platform-agnostic — Ghidra runs them via JVM on every OS.

## On Bun OS

- `re ghidra-win probe` (MCP `ghidra_probe`) checks the installed Ghidra (`GHIDRA_INSTALL_DIR`, version, `analyzeHeadless`) and whether `JAVA_HOME` holds a JDK; Ghidra and the rea Ghidra provider take Java from `JAVA_HOME` only, so follow its `remediation` when it reports a stale value.
- `re pipeline <binary> --target os --out DIR --external` (MCP `re_pipeline_run` with `external: true`) runs the `ghidra-headless` adapter: import, auto-analysis and decompiled C export beside the built-in lift, emit and rebuild stages; the report is `DIR/report.json`.

## When to Use

- Decompiling a binary to C pseudocode for review
- Extracting function signatures, strings, or symbols from executables
- Analyzing call graphs to understand binary control flow
- Triaging unknown binaries or firmware images
- Batch-analyzing multiple binaries for comparison
- Security auditing compiled code without source access

## When NOT to Use

- Source code is available — read it directly instead
- The binary is already loaded in a running Ghidra GUI session and the user wants
  interactive analysis — use the **`ghidra-mcp-live`** skill instead.
- The binary is a .NET assembly — use dnSpy or ILSpy
- The binary is Java bytecode — use jadx or cfr
- Dynamic analysis is required — use a debugger or sandbox

## Quick Reference

### Windows (PowerShell — recommended)

| Task                           | Command                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Full analysis with all exports | `<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportAll.java -Output .\output <binary>`        |
| Decompile to C code            | `<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportDecompiled.java -Output .\output <binary>` |
| List functions                 | `<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportFunctions.java -Output .\output <binary>`  |
| Extract strings                | `<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportStrings.java -Output .\output <binary>`    |
| Get call graph                 | `<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportCalls.java -Output .\output <binary>`      |
| Export symbols                 | `<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportSymbols.java -Output .\output <binary>`    |
| Find Ghidra path               | `<plugin-root>/skills/ghidra-headless/scripts/find-ghidra.ps1`                                                            |

### Linux / macOS (bash)

| Task                           | Command                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Full analysis with all exports | `<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.sh -s ExportAll.java -o ./output <binary>` |
| Find Ghidra path               | `<plugin-root>/skills/ghidra-headless/scripts/find-ghidra.sh`                                           |

(All other tasks: same script names, swap `.ps1` for `.sh` and `-Script` for `-s`, `-Output` for `-o`.)

## Prerequisites

- **Ghidra** must be installed.
  - Windows: extract the release zip anywhere; the PS scripts auto-detect common locations and honor `$env:GHIDRA_INSTALL_DIR` or `$env:GHIDRA_HOME`.
  - macOS: `brew install --cask ghidra`
  - Linux: extract release zip; set `GHIDRA_HOME` if non-standard.
- **Java 21+** must be on `PATH` or located via `JAVA_HOME`.

The PS `find-ghidra.ps1` searches in this order:

1. `$env:GHIDRA_INSTALL_DIR`
2. `$env:GHIDRA_HOME`
3. `%USERPROFILE%\ghidra`, `%LOCALAPPDATA%\Programs\ghidra`, `C:\ghidra`, `C:\Tools\ghidra`, `C:\Program Files\ghidra`, `%USERPROFILE%\Tools\ghidra`
4. Versioned dirs (`ghidra*`) under common parents
5. `analyzeHeadless.bat` on `PATH`

## Wrapper Script (PowerShell)

```powershell
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 [options] -Binary <path>
```

**Parameters:**

- `-Binary <path>` (positional, mandatory) — the binary to analyze.
- `-Output <dir>` (alias `-o`) — output directory (default: cwd).
- `-Script <name[]>` (alias `-s`) — post-script(s) to run; pass an array or repeat the flag.
- `-ScriptArgs <"N:args"[]>` (alias `-a`) — args for the Nth script (1-based).
- `-ScriptPath <dir>` — additional script search path.
- `-Processor <id>` (alias `-p`) — e.g. `x86:LE:64:default`.
- `-Cspec <id>` (alias `-c`) — compiler spec.
- `-NoAnalysis` — skip auto-analysis (faster, less info).
- `-Timeout <seconds>` — analysis timeout per file.
- `-KeepProject` — keep the Ghidra project after analysis.
- `-ProjectDir <dir>` — project parent dir (default: `$env:TEMP`).
- `-ProjectName <name>` — project name (default: derived from binary).
- `-Loader <name>` — force a specific loader (PeLoader, ElfLoader, etc.).
- `-LibrarySearchPath <dirs[]>` — library search paths.
- `-MaxCpu <int>` — limit GC + JIT threads.
- `-MaxMemory <"2G"|"4G"|...>` — set MAXMEM for the JVM child only.
- `-Verbose` — verbose output (built-in PS).

## Wrapper Script (bash) — same options, different syntax

```bash
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.sh [options] <binary>
```

`-o, -s, -a, -p, -c, --no-analysis, --timeout, --keep-project, --project-dir, --project-name, -v, --verbose, -h`

## Built-in Export Scripts (Java GhidraScripts)

Located under `scripts/ghidra_scripts/` (not in repo). Run via `-Script <Name>.java` (PS) or `-s <Name>.java` (bash).

### ExportAll.java

Runs summary + decompile + functions + strings + interesting-pattern exports. Best first pass.

**Output:**

- `<name>_summary.txt` — architecture, sections, function count
- `<name>_decompiled.c` — every function in C
- `<name>_functions.json` — signatures + calls
- `<name>_strings.txt` — all strings
- `<name>_interesting.txt` — flagged patterns (crypto / network / dangerous APIs)

### ExportDecompiled.java

All functions → C pseudocode. **Output:** `<name>_decompiled.c`

### ExportFunctions.java

Function list → JSON with addresses, signatures, parameters, calls/calledBy.
**Output:** `<name>_functions.json`

### ExportStrings.java

All strings (ASCII + Unicode) with addresses → JSON.
**Output:** `<name>_strings.json`

### ExportCalls.java

Call graph + entry-point candidates + most-called functions.
**Output:** `<name>_calls.json`

### ExportSymbols.java

Imports, exports, internal symbols.
**Output:** `<name>_symbols.json`

## Common Workflows (PowerShell)

### Triage an unknown binary

```powershell
$out = ".\analysis"
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportAll.java -Output $out -Binary .\unknown.exe
Get-Content "$out\unknown_summary.txt"
Get-Content "$out\unknown_interesting.txt"
```

### Firmware (specific arch)

```powershell
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 `
  -Processor 'ARM:LE:32:v7' `
  -Script ExportAll.java `
  -Output .\firmware_analysis `
  -Binary .\firmware.bin
```

### Quick function listing (no auto-analysis)

```powershell
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -NoAnalysis -Script ExportFunctions.java -Output . -Binary .\program.exe
Get-Content .\program_functions.json | ConvertFrom-Json | Select-Object -ExpandProperty functions | ForEach-Object { "$($_.address): $($_.name)" }
```

### Pattern hunting after decompilation

```powershell
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportDecompiled.java -Output . -Binary .\target.exe
Select-String -Path .\target_decompiled.c -Pattern 'password|secret|key|strcpy|sprintf|gets|system\b'
```

### Batch analysis

```powershell
Get-ChildItem .\samples\*.exe | ForEach-Object {
  $out = ".\results\$($_.BaseName)"
  <plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Script ExportAll.java -Output $out -Binary $_.FullName
}
```

## Common Workflows (bash)

```bash
# Same intent, different syntax
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.sh -s ExportAll.java -o ./analysis ./unknown
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.sh -p "ARM:LE:32:v7" -s ExportAll.java -o ./firmware_analysis ./firmware.bin
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.sh --no-analysis -s ExportFunctions.java -o . ./program | jq '.functions[] | "\(.address): \(.name)"'
```

## Architecture / Processor IDs

| Architecture | Processor ID                     |
| ------------ | -------------------------------- |
| x86 32-bit   | `x86:LE:32:default`              |
| x86 64-bit   | `x86:LE:64:default`              |
| ARM 32-bit   | `ARM:LE:32:v7`                   |
| ARM 64-bit   | `AARCH64:LE:64:v8A`              |
| MIPS 32-bit  | `MIPS:BE:32:default` (or `:LE:`) |
| PowerPC      | `PowerPC:BE:32:default`          |
| Z80          | `z80:LE:16:default`              |
| 6502         | `6502:LE:16:default`             |
| AVR8         | `avr8:LE:16:default`             |

To enumerate every processor ID Ghidra knows about (181 on a stock 12.0.4 install):

```powershell
Import-Module Ghidra
Get-GhidraProcessor | Select-Object Id, Description
```

(Or scan `<GhidraInstallDir>/Ghidra/Processors/*/data/languages/*.ldefs` directly.)

## Troubleshooting

### "Could not find Ghidra's analyzeHeadless"

```powershell
[Environment]::SetEnvironmentVariable('GHIDRA_INSTALL_DIR','C:\path\to\ghidra','User')
# Open a new pwsh session to pick up the change
```

### Analysis hangs / takes too long

```powershell
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Timeout 300 -Script ExportAll.java -Binary <bin>
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -NoAnalysis -Script ExportSymbols.java -Binary <bin>
```

### Out of memory

```powershell
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -MaxMemory 4G -Script ExportAll.java -Binary <bin>
```

### Wrong architecture detected

```powershell
<plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 -Processor 'ARM:LE:32:v7' -Script ExportAll.java -Binary <bin>
```

## Tips

1. **Start with `ExportAll.java`** — gives everything; the summary helps orient.
2. **Check `interesting.txt`** — flags security-relevant functions automatically.
3. **JSON outputs are pipeline-friendly** — `ConvertFrom-Json` (PS) or `jq` (bash).
4. **Decompilation isn't perfect** — use as a guide, cross-reference with disassembly.
5. **For interactive work, switch to the `ghidra-mcp-live` skill** — it talks to the running GUI.
