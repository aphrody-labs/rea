---
description: Run headless analysis across a directory of binaries — produces JSON exports per binary
argument-hint: <directory> [--script=ExportAll.java] [--processor=<id>] [--out=<dir>] [--parallel=<N>]
allowed-tools:
  - Bash
  - Read
  - Glob
---

# /ghidra:batch

Run the `ghidra-headless` skill across every binary in a directory. No agent needed — this is a direct skill orchestration.

## Argument parsing

- Positional arg #1: directory containing binaries. Required.
- `--script=<name>` (default `ExportAll.java`): which export(s) to run. Repeat for multiple.
- `--processor=<id>` (default: auto-detect per file): force a processor (e.g. `ARM:LE:32:v7` for a firmware fleet of identical chips).
- `--out=<dir>` (default `./batch-results`): root output directory; one subdir per binary.
- `--parallel=<N>` (default 1): number of concurrent analyses. Each `analyzeHeadless` JVM eats ≥1 GB; respect available RAM.
- `--include=<glob>` (default: all files): filter the input dir.
- `--exclude=<glob>`: exclude pattern.
- `--timeout=<seconds>` (default 600): per-binary analysis timeout.
- `--max-memory=<2G|4G|...>` (default `2G`): per-JVM heap.

## What to do

1. Resolve the input directory and enumerate files matching `--include` / `--exclude`.
2. Plan the run — print a summary: `N binaries × M scripts = K analyses, ETA ≈ ...`. Ask for confirmation if N > 50.
3. For each binary, dispatch:

   **PowerShell (Windows):**

   ```powershell
   <plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.ps1 `
     -Binary <path> `
     -Output (Join-Path $outRoot $binBaseName) `
     -Script <script> `
     -Processor <proc> `
     -Timeout <timeout> `
     -MaxMemory <maxmem>
   ```

   **bash (Unix):**

   ```bash
   <plugin-root>/skills/ghidra-headless/scripts/ghidra-analyze.sh \
     -s <script> \
     -o "$outRoot/$base" \
     -p <proc> \
     --timeout <timeout> \
     "$bin"
   ```

   With `--parallel > 1`, use `ForEach-Object -Parallel` (PS 7+) or GNU `parallel` / xargs `-P`.

4. After all jobs complete, generate a roll-up:
   - Total binaries analyzed, succeeded, failed.
   - Aggregate string hits (URLs, IPs, suspicious tokens).
   - Per-binary one-line summary derived from `<name>_summary.txt`.
   - Path to the per-binary subdirs.
5. Save the roll-up to `<out>/INDEX.md` and surface it to the user.

## Output shape

```
Batch analysis complete — 24 binaries

✓ 22 succeeded
✗  2 failed (timeout):
   - hard_packed.exe   (>600s analysis time)
   - encrypted.dll     (parse error in PE loader)

Aggregate findings:
  3 binaries reference http://*.evil.com   (IoC alert)
  17 binaries import VirtualAlloc + VirtualProtect
  5 binaries appear UPX-packed

Per-binary results: ./batch-results/INDEX.md
```

## Use cases

- **Malware corpus triage** — point at a directory, get summaries per sample.
- **Vendor firmware fleet** — same chip, dozens of versions. Diff the `*_functions.json` output across versions.
- **Bug-bounty target sweep** — point at a unzipped vendor SDK, find the parser binaries.

## Example

```
/ghidra:batch C:\samples --script=ExportAll.java --parallel=4 --max-memory=2G
/ghidra:batch ./firmware-versions --processor=ARM:LE:32:v7 --include=*.bin --out=./diff-results
```

## Note

Each analysis spawns a JVM. Memory pressure is real — keep `--parallel × --max-memory` under available system RAM minus a comfortable margin.
