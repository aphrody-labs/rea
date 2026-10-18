---
description: Hunt for security vulnerabilities (memory safety, injection, auth bypass) in a compiled binary
argument-hint: <path-or-running-program> [--scope=<imports|exports|all>] [--severity=<critical|high|all>]
allowed-tools:
  - Agent
  - Bash
  - Read
  - Grep
---

# /ghidra:vulns

Apply the **`vulnerability-hunter`** skill.

## Routing logic

Both modes work:

- **Live MCP** — when the binary is open in Ghidra. The agent uses `mcp__ghidra__xrefs` and `get_code(format="decompiler")` to walk dangerous-API call sites in place.
- **Headless** — the agent runs the `ghidra-headless` skill's `ExportAll.java`, then greps `*_decompiled.c` and `*_interesting.txt` for the bug-class patterns.

Auto-detect via the live-server probe (same as `/ghidra:triage`). Live is preferred when available because reachability analysis is faster against the live database.

## Argument parsing

- Positional arg #1: binary path on disk OR (omitted) — use the program currently loaded in Ghidra.
- `--scope=imports` (default): walk dangerous imports, find their callers.
- `--scope=exports`: walk exports, audit each one as an attacker entry point.
- `--scope=all`: both, plus broader patterns (recursive parsers, custom format readers).
- `--severity=critical|high|all`: filter the final report. Default `high`.

## What to do

1. Determine source (live program vs file path). Fail clearly if neither is available.
2. Pre-compute the dangerous-API set the agent should focus on. Default list:
   ```
   strcpy strcat sprintf gets scanf vsprintf
   memcpy memmove strncpy (when dst size is attacker-derived)
   system WinExec ShellExecute CreateProcess
   LoadLibrary GetProcAddress (with attacker-controlled name)
   ```
   Adjust if user passes a custom list.
3. Apply `vulnerability-hunter` with:
   - The binary reference.
   - Mode (live / headless).
   - Scope and severity filter.
   - Reminder to produce findings in the skill's standard finding-block format.
4. Surface the report. If high-severity findings exist, offer to **rank them by exploitability** in a follow-up message rather than auto-generating a wall of text.

## Examples

```
/ghidra:vulns C:\samples\service.exe
/ghidra:vulns                                 (current Ghidra program)
/ghidra:vulns ./router.bin --scope=all --severity=critical
```

## Note on authorization

Run this only against binaries you're authorized to test. The skill does not generate exploitation code for unauthorized targets.
