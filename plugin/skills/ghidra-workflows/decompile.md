---
description: Clean up Ghidra's decompiled output for a function — recover types, rename locals, identify library calls
argument-hint: <function-name-or-address> [--write] [--just-print]
allowed-tools:
  - Agent
  - Read
  - Bash
  - mcp__ghidra__*
---

# /ghidra:decompile

Apply the **`decompile-cleaner`** skill to the requested function.

## Routing logic

This command requires the **live MCP server** (`http://localhost:8080/mcp`). Decompile-cleaner edits the program in place via `mcp__ghidra__rename_symbol` / `struct` / `create_data_var` — those tools don't exist in the headless skill.

If the MCP server is offline, refuse:

> The `decompile-cleaner` skill needs the live Ghidra MCP server. Open your binary in Ghidra,
> enable GhidrAssistMCP (`Window → GhidrAssistMCP`), and try again. Or use
> `/ghidra:triage` for a static report first.

## Argument parsing

- First positional arg: the function. Accept either:
  - A symbol name (`parse_header`, `main`, `FUN_140012a0`)
  - A hex address (`0x140012a0`, `140012a0`)
- `--write` (default ON for decompile-cleaner): apply renames and structs to the program.
- `--just-print` / `--read-only`: don't modify the program, just produce the cleaned-up pseudo-C in chat.

## What to do

1. Probe the MCP server. If unreachable, return the refusal text above.

   **PowerShell (Windows):**

   ```powershell
   try { (Invoke-WebRequest -Uri http://localhost:8080/sse -TimeoutSec 2 -UseBasicParsing -SkipHttpErrorCheck).StatusCode } catch { 0 }
   ```

   **bash (Unix):**

   ```bash
   curl -s -o /dev/null -w "%{http_code}" -m 2 http://localhost:8080/sse
   ```

2. Resolve the function — call `mcp__ghidra__search_functions_by_name` if it's a name, or pass the address directly. If ambiguous, list candidates and ask the user.
3. Apply `decompile-cleaner` with:
   - The function reference (address or name).
   - The mode (write vs read-only).
   - A reminder to produce the rename / struct list in its summary so the user can audit.

## Examples

```
/ghidra:decompile parse_header
/ghidra:decompile 0x140012a0
/ghidra:decompile FUN_140013ab --just-print
```
