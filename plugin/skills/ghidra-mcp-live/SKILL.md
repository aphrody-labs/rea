---
name: ghidra-mcp-live
description: Drive an interactive Ghidra GUI session through the live GhidrAssistMCP server (port 8080) to decompile, rename, list cross-references, define structures, and patch the program currently open in CodeBrowser. Use when the user has a binary loaded in Ghidra and wants real-time analysis on it, not batch processing of arbitrary files.
---

# Live Ghidra MCP

This skill drives the **GhidrAssistMCP** server embedded in a running Ghidra session via the `ghidra` MCP server (`http://localhost:8080/mcp`). It is the _interactive_ counterpart to `ghidra-headless` — work happens against whatever program is currently focused in Ghidra's CodeBrowser, not against a file on disk.

## When to use this skill

- The user is reverse-engineering a binary they already opened in Ghidra GUI.
- They want decompilation, renaming, structure recovery, xref hunting, or patching applied **in place** so changes persist in their project.
- They ask things like "what does this function do", "rename these locals", "find all callers of …", "show me the strings", "patch this jump".

## When NOT to use this skill

- No live Ghidra session — use the `ghidra-headless` skill instead.
- The user wants results saved to disk as JSON/text — `ghidra-headless` produces those.
- The MCP server is not connected or its `mcp__ghidra__*` tools are unavailable — see Preflight below.

## Preflight check

Before invoking any `mcp__ghidra__*` tool, verify the server is reachable. The user's setup:

- Ghidra install: `$env:GHIDRA_INSTALL_DIR` (Ghidra 12.x)
- MCP server: `http://localhost:8080/mcp` (Streamable HTTP) and `/sse` (SSE)
- Plugin: GhidrAssistMCP, auto-starts when a CodeBrowser opens (preferences pre-set)

If the server is offline:

1. Confirm Ghidra is running and a CodeBrowser tool is open with a program loaded.
2. Confirm `Window → GhidrAssistMCP` shows the server enabled.
3. `curl http://localhost:8080/sse` should return a 200.
4. Codex must expose the `mcp__ghidra__*` tools in this task. Start a new Codex task after an install or update if they are missing.

## Tool surface (38 tools)

Tools are exposed as `mcp__ghidra__<tool_name>`. Categories:

### Discovery

- `get_binary_info`, `list_binaries` — what's loaded
- `get_imports`, `get_exports`, `get_segments`, `get_namespaces`, `get_relocations`, `get_entry_points`
- `get_functions` (paginated, pattern filter), `search_functions_by_name`, `get_function_statistics`
- `get_strings`, `search_strings`
- `get_data_vars`, `get_data_at`, `get_current_address`, `get_current_function`

### Code retrieval (consolidated)

- `get_code` with `format` ∈ `{"decompiler","disassembly","pcode"}` (and `raw` boolean for pcode)
- `get_function_stack_layout`, `get_basic_blocks`

### Analysis

- `analyze_function` (signature, variables, complexity)
- `xrefs` parametrized by `address` or `function`, optional `include_calls`
- `classes` action ∈ `{"list","get_info"}` — C++ classes, vtables, virtual methods

### Modification (use with care — these write to the program)

- `rename_symbol` with `target_type` ∈ `{"function","data","variable"}`
- `struct` action ∈ `{"create","modify","merge","set_field","name_gap","auto_create","rename_field","field_xrefs"}`
- `create_data_var`
- `assemble_code` (assembles instruction text + optionally patches it in)
- `patch_bytes`

### Disabled by default (filesystem-touching)

- `import_file`, `export_program` — enable in the GhidrAssistMCP control panel only when explicitly needed

### Tasks

- `get_task_status`, `list_tasks`, `cancel_task` — for long-running operations that go async

## Multi-program / multi-window

A single MCP server is shared across all CodeBrowser windows. The currently focused window is auto-detected and tool responses include a context hint with the active program's name. Every program-aware tool also accepts an optional `program_name` parameter to target a specific open program (exact, case-insensitive, or partial-name match).

## Workflow patterns

### Identify and rename a function

1. `get_current_function` → get the address and current name
2. `get_code` with `format="decompiler"` for the function's address
3. Read the C, infer purpose
4. `rename_symbol` with `target_type="function"` and a meaningful name

### Recover a structure from usage

1. `analyze_function` to see how a struct pointer is used
2. `xrefs` on the struct's allocation site to find every access
3. `struct` with `action="auto_create"` (best effort) or `action="create"` with a hand-written C definition
4. Iterate: `set_field` / `rename_field` / `name_gap` to fill in missing offsets

### Find security-sensitive code paths

1. `get_imports` — look for `gets`, `strcpy`, `system`, `WinExec`, `LoadLibrary`, etc.
2. `xrefs` on each dangerous import to find call sites
3. `get_code` (decompiler) on each caller, look for tainted input flow

### Patch a check

1. `get_code` (disassembly) at the conditional-jump address to confirm the instruction
2. `assemble_code` with the new instruction (e.g. `JMP <target>` to skip a check, or `NOP NOP` to neuter)
3. Verify with another `get_code` (disassembly) at the same address

## Tool naming convention in this skill

When calling, use the full Codex prefix: `mcp__ghidra__get_binary_info`, `mcp__ghidra__get_code`, etc. The `mcp__ghidra__` prefix corresponds to the `ghidra` server in this plugin's `.mcp.json`.

## Known issues (upstream)

- `get_imports` paginates poorly above ~100 imports (issue #45). Filter or use `xrefs` directly when the import list is huge.
- No `is_data_or_code` tool yet (issue #14) — disambiguate via `get_data_at` vs trying `get_code(format="disassembly")`.
- Returned data isn't currently size-limited (issue #20) — be specific in queries to avoid huge dumps.

## Tip

For real-time diagnostics, the GhidrAssistMCP plugin's **Log** tab in Ghidra streams every `REQ:` and `RES:` line. Watch it while invoking tools to catch parameter mistakes quickly.
