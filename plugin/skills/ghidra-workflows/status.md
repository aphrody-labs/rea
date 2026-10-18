---
description: Show the state of the Ghidra Suite — install, MCP server, plugins enabled, processes, currently loaded program
allowed-tools:
  - Bash
  - Read
---

# /ghidra:status

Print a concise status table for the entire Ghidra Suite stack. No agent needed — just direct probes.

## What to check

Run these in parallel and assemble a single status table:

1. **Ghidra install** — `Get-GhidraInstallation` (PS module) returns version, build date, install path. If the module isn't loaded yet, fall back to reading `$env:GHIDRA_INSTALL_DIR\Ghidra\application.properties`.
2. **Java** — `java -version` (parse to major version; check ≥ 21).
3. **Ghidra running?** — `Get-Process javaw,java -ErrorAction SilentlyContinue` filtered by `MainWindowTitle -like 'Ghidra*' -or 'CodeBrowser*'`. Report PID + StartTime + window title.
4. **MCP server** — `curl -m 2 http://localhost:8080/sse` (200 = up). If up, also try `/mcp` POST init for full handshake confirmation.
5. **Codex → MCP** — confirm this task exposes the `mcp__ghidra__*` tool family. A plugin update requires a new Codex task to refresh tools.
6. **Installed plugins** — `Get-GhidraExtension` lists `Installed` vs `Available` extensions.
7. **Loaded program** (if Ghidra is running and MCP is connected) — `mcp__ghidra__get_binary_info` and `mcp__ghidra__list_binaries`.
8. **Skills** — list `<plugin>/skills/*` so the user knows what's bundled.

## Output shape

```
GHIDRA SUITE — status

Installation
  Version       12.0.4 PUBLIC (2026-Mar-03)
  Path          $env:GHIDRA_INSTALL_DIR
  Java          21.0.10 LTS  (≥21 ✓)
  Module        Ghidra PS module loaded (15 cmdlets)

Runtime
  Process       javaw PID 5736  (started 05:43:56)
  Window        CodeBrowser: claude:/veadotube-mini.exe.1
  MCP server    listening on :8080  (sse 200, mcp 400→OK)
  Codex link    mcp__ghidra__*: available

Plugins (enabled)
  GhidrAssist 12.0
  GhidrAssistMCP 12.0  →  38 tools, 6 resources, 7 prompts

Loaded programs
  veadotube-mini.exe.1   (PE, x86_64, MSVC)

Bundled skills
  ghidra-headless  (Win32 PS + bash; 6 export Java scripts)
  ghidra-mcp-live  (live tool driver)

Bundled skills
  binary-triage · malware-analyst · vulnerability-hunter
  decompile-cleaner · firmware-analyst · ctf-solver

Bundled commands
  /ghidra:triage · /ghidra:decompile · /ghidra:vulns
  /ghidra:status · /ghidra:batch
```

If anything is degraded, mark it with ✗ and a one-line hint. Examples:

- MCP server unreachable → "Open Ghidra and enable GhidrAssistMCP via Window menu."
- Java < 21 → "Install JDK 21+ — Ghidra 12 won't launch otherwise."
- Ghidra tools missing in Codex — "Install or update this plugin, then start a new Codex task."

## Implementation hint

A single PowerShell run can collect almost everything. Use parallel collection where possible:

```powershell
$ghidra = Get-Process javaw -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'Ghidra|CodeBrowser' }
$mcp = try { (Invoke-WebRequest -Uri http://localhost:8080/sse -TimeoutSec 2 -UseBasicParsing -SkipHttpErrorCheck).StatusCode } catch { 0 }
# The Codex MCP availability check happens through the tool inventory, not a shell command.
# ...
```

Print the formatted table. Done.
