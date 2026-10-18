---
description: Run a fast first-pass triage on a binary (architecture, sections, imports, strings of interest, hypothesis)
argument-hint: <path-to-binary> [--mode=auto|live|headless]
allowed-tools:
  - Agent
  - Bash
  - Read
  - Grep
---

# /ghidra:triage

Apply the **`binary-triage`** skill to the requested binary.

## Routing logic

If the user has Ghidra running with the binary already loaded (live MCP server reachable), prefer `mcp__ghidra__*` tools — they operate on the in-GUI program in real time. Otherwise use the `ghidra-headless` skill against the binary on disk.

Detect mode via:

```powershell
try {
  $r = Invoke-WebRequest -Uri http://localhost:8080/sse -Method GET -TimeoutSec 2 -UseBasicParsing -SkipHttpErrorCheck
  if ($r.StatusCode -eq 200) { Write-Output 'live' } else { Write-Output 'headless' }
} catch { Write-Output 'headless' }
```

## What to do

1. Resolve the binary path from `$ARGUMENTS` (positional arg #1). Fail clearly if missing or not found.
2. Decide mode (auto-detect from the live server probe; user can force via `--mode=live` or `--mode=headless`).
3. Apply the `binary-triage` skill with:
   - The binary path (absolute).
   - The detected mode and which tools are available (live MCP vs headless wrapper).
   - The shape of the report you want (the one defined in the agent's system prompt).
4. Surface the agent's report directly to the user — don't re-summarize unless requested.
5. If the report recommends a different skill, offer that next analysis (don't auto-chain without confirmation).

## Examples

```
/ghidra:triage C:\samples\unknown.exe
/ghidra:triage ./firmware.bin --mode=headless
/ghidra:triage  (when a binary is already loaded in Ghidra GUI)
```
