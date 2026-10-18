---
name: ghidra-workflows
description: "Route common Ghidra tasks in Codex: installation status, binary triage, readable decompilation, vulnerability review, and headless batch analysis."
---

# Ghidra workflows

Choose the smallest appropriate route:

- **Status and setup:** read [status.md](./status.md).
- **First-pass binary orientation:** read [triage.md](./triage.md) and use `binary-triage`.
- **Readability cleanup for an open program:** read [decompile.md](./decompile.md) and use `decompile-cleaner` plus `ghidra-mcp-live`.
- **Authorized static vulnerability assessment:** read [vulns.md](./vulns.md) and use `vulnerability-hunter`.
- **Directory-scale static exports:** read [batch.md](./batch.md) and use `ghidra-headless`.

All routes are static analysis only. Confirm exact output paths before headless batch jobs, and use the live MCP whenever a loaded Ghidra program needs structured access.
