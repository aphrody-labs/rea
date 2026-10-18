// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { ToolContract } from "./toolContractTypes.js";
import { toolContractMetadata } from "./toolEffects.js";
const steamDatabase = {
  db: z.string().optional().describe("Steam SQLite database path"),
  root: z.string().optional().describe("Steam install root"),
};
export const BUN_OS_TOOL_CONTRACTS = [
  {
    name: "re_recompile",
    ...toolContractMetadata("re_recompile"),
    kind: "application",
    description:
      "Statically recompile a console image (GBA ROM with its BIOS, PlayStation BIOS or PS-EXE, NES cartridge) to a native executable or WebAssembly module over the Bun Engine core, then verify the frame buffer and console output against the interpreter and `bun-engine run`. Returns the PipelineReport; the recompile-verify stage lists the checks and execution counters.",
    inputSchema: z.object({
      input: z
        .string()
        .describe("Path of the GBA ROM, PS-EXE, PlayStation BIOS or iNES file"),
      target: z.enum(["exe", "wasm"]).optional(),
      outdir: z
        .string()
        .describe("Output directory (crate, build, verification dumps)"),
      machine: z
        .enum(["gba", "psx", "nes"])
        .optional()
        .describe("Override the identified machine"),
      bios: z
        .string()
        .optional()
        .describe(
          "GBA BIOS (default: free Normmatt BIOS) or PlayStation BIOS (required for a PS-EXE)",
        ),
      frames: z
        .number()
        .optional()
        .describe("Frames run by the verification (default 300)"),
      noBuild: z
        .boolean()
        .optional()
        .describe("Stop after emitting the Rust crate"),
      keys: z
        .string()
        .optional()
        .describe(
          "Scripted input of the verification runs, e.g. start@120-125,right@200-400 (executables)",
        ),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "engine_run",
    ...toolContractMetadata("engine_run"),
    kind: "application",
    description:
      "Run a console image headless on the Bun Engine cores (`bun-engine run`: nds, 3ds, switch, gba, nes, psx, wii, gc, arm, x86, linux) for a bounded number of frames, optionally with scripted pad input and a per-frame screen digest trace; writes screen<i>.ppm dumps to `out` and returns the guest console output.",
    inputSchema: z.object({
      system: z
        .string()
        .describe(
          "Machine: nds, 3ds, switch, gba, nes, psx, wii, gc, arm, x86 or linux",
        ),
      image: z.string().describe("ROM, executable, disc or firmware image"),
      frames: z.number().optional().describe("Frames to run (default 60)"),
      bios: z.string().optional().describe("Firmware (GBA, PlayStation)"),
      out: z.string().optional().describe("Directory for screen dumps"),
      input: z
        .string()
        .optional()
        .describe("Scripted pad input, e.g. start@60-65,right@100-200"),
      trace: z
        .string()
        .optional()
        .describe("JSON Lines file receiving one screen digest per frame"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "engine_info",
    ...toolContractMetadata("engine_info"),
    kind: "application",
    description:
      "Validate a Nintendo DS/DSi cartridge header with the native Bun Engine inspector (title, codes, CRCs, regions) without running it.",
    inputSchema: z.object({
      rom: z.string().describe("Path of the .nds image"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "steam_scan",
    ...toolContractMetadata("steam_scan"),
    kind: "application",
    description: "Index the local Steam install into SQLite",
    inputSchema: z.object({ ...steamDatabase, hashMax: z.number().optional() }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "steam_stats",
    ...toolContractMetadata("steam_stats"),
    kind: "application",
    description: "Row counts per table of the Steam database",
    inputSchema: z.object(steamDatabase),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "steam_sql",
    ...toolContractMetadata("steam_sql"),
    kind: "application",
    description: "Run a read-only SELECT on the Steam database",
    inputSchema: z.object({ ...steamDatabase, sql: z.string() }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "steam_api_sync",
    ...toolContractMetadata("steam_api_sync"),
    kind: "application",
    description:
      "Index Steam Web API interfaces, methods, parameters and endpoints",
    inputSchema: z.object(steamDatabase),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "steam_classify",
    ...toolContractMetadata("steam_classify"),
    kind: "application",
    description: "Detect the file type of a path",
    inputSchema: z.object({ path: z.string() }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "steam_rea",
    ...toolContractMetadata("steam_rea"),
    kind: "application",
    description: "Run the RE pipeline on an installed Steam app executable",
    inputSchema: z.object({
      ...steamDatabase,
      appid: z.number(),
      outdir: z.string().optional(),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "re_pipeline_run",
    ...toolContractMetadata("re_pipeline_run"),
    kind: "application",
    description:
      "Run the cross-OS/BIOS/firmware RE pipeline (acquire, identify, unpack, analyze, lift, decompile, rebuild, verify) on a local file. Returns the typed PipelineReport; unavailable stages list candidate adapters.",
    inputSchema: z.object({
      input: z.string().describe("Path of the binary, ROM, firmware or image"),
      target: z.enum(["os", "bios", "firmware"]).optional(),
      outdir: z.string().describe("Output directory"),
      external: z
        .boolean()
        .optional()
        .describe("Enable heavy external adapters (Ghidra headless)"),
      trace: z
        .boolean()
        .optional()
        .describe("Execute the rebuilt binary for a bounded trace"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "re_pipeline_adapters",
    ...toolContractMetadata("re_pipeline_adapters"),
    kind: "application",
    description:
      "List registered pipeline stage adapters with live availability (ready, registered, unavailable) and owners.",
    inputSchema: z.object({ stage: z.string().optional() }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "formats_inspect",
    ...toolContractMetadata("formats_inspect"),
    kind: "application",
    description:
      "Identify a console ROM, BIOS, firmware dump, disc or executable (NES, GB/GBC, GBA, NDS, N64, GameCube/Wii, PlayStation, 3DS, Switch, Genesis, ELF...) and return the parsed header, sections, entry point and known-firmware matches (public hashes and the free firmware registry); optionally the embedded file system and CRC-32/MD5/SHA-1/SHA-256 digests.",
    inputSchema: z.object({
      path: z.string().describe("Image path"),
      files: z
        .boolean()
        .optional()
        .describe("List embedded file system entries"),
      digest: z
        .boolean()
        .optional()
        .describe("Stream CRC-32/MD5/SHA-1/SHA-256"),
      magika: z
        .boolean()
        .optional()
        .describe("Also ask Magika for a content type"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "formats_disasm",
    ...toolContractMetadata("formats_disasm"),
    kind: "application",
    description:
      "Disassemble a window of a console image (6502, ARM/Thumb, LR35902, R3000/MIPS, PowerPC, AArch64, m68k); defaults to 16 instructions at the entry point.",
    inputSchema: z.object({
      path: z.string().describe("Image path"),
      arch: z.string().optional().describe("Instruction set override"),
      at: z.number().optional().describe("Guest address"),
      offset: z.number().optional().describe("File offset (raw window)"),
      count: z
        .number()
        .optional()
        .describe("Instructions (default 16, max 4096)"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "binary_inspect",
    ...toolContractMetadata("binary_inspect"),
    kind: "application",
    description:
      "Static read-only first pass over a PE or ELF binary (emulator release, Steam client or game executable, Proton/Wine build): format, SHA-256, sections with entropy, imported libraries and symbols, exports, PE version resource and Authenticode, a bounded string sample and provenance (bep release, Steam app). `host` reads a remote file through `ssh HOST cat`.",
    inputSchema: z.object({
      path: z.string().describe("Binary path (remote path with host)"),
      strings: z
        .number()
        .optional()
        .describe("String sample size (default 64)"),
      imports: z
        .number()
        .optional()
        .describe("Functions listed per imported DLL (default 16)"),
      host: z.string().optional().describe("SSH host, e.g. vps"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "ghidra_probe",
    ...toolContractMetadata("ghidra_probe"),
    kind: "application",
    description:
      "Report the Windows Ghidra integration: installed Ghidra (GHIDRA_INSTALL_DIR, version, analyzeHeadless), JAVA_HOME validity with remediation, the vendored Ghidra and NTRGhidra sources, MSVC and Windows SDK.",
    inputSchema: z.object({}),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "magika_identify",
    ...toolContractMetadata("magika_identify"),
    kind: "application",
    description:
      "Classify a file, or every file of a folder (one Magika session, bounded by `limit`), with the Magika deep-learning content-type model; folders also return label counts.",
    inputSchema: z.object({
      path: z.string().describe("File or folder"),
      limit: z.number().optional().describe("Folder file limit (default 500)"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "replica_record",
    ...toolContractMetadata("replica_record"),
    kind: "application",
    description:
      "Record a deterministic replay of a Bun Engine machine: run the image headless with scripted pad input and store the image/BIOS SHA-256, the input script and the per-frame screen digests in a replay JSON file.",
    inputSchema: z.object({
      system: z.string().describe("Machine: gba, nes, psx, nds, ..."),
      image: z.string().describe("ROM or executable"),
      frames: z.number().optional().describe("Frames (default 600)"),
      input: z.string().optional().describe("Pad script key@first[-last],..."),
      bios: z.string().optional().describe("Firmware"),
      out: z
        .string()
        .optional()
        .describe("Replay file (default var/replica/replays)"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "replica_replay",
    ...toolContractMetadata("replica_replay"),
    kind: "application",
    description:
      "Replay a recording on the same pinned image and report whether every frame and the console output are identical, with the first diverging frame.",
    inputSchema: z.object({ replay: z.string().describe("Replay JSON file") }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "replica_nds",
    ...toolContractMetadata("replica_nds"),
    kind: "application",
    description:
      "Read-only intake of a user-owned Nintendo DS image for a Replica project: cartridge header, ARM9/ARM7 layout, SHA-256 and readiness of the DS owners; with `out`, record the input provenance (input.json, status.json).",
    inputSchema: z.object({
      rom: z.string().describe("Path of the .nds image"),
      out: z
        .string()
        .optional()
        .describe("Replica project directory to initialize"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "steam_appinfo",
    ...toolContractMetadata("steam_appinfo"),
    kind: "application",
    description:
      "Decode one app from the local Steam appinfo.vdf (PICS cache): change number, tokens and the full key/value tree (common, config, depots, branches).",
    inputSchema: z.object({
      appid: z.number().describe("Steam app id"),
      root: z.string().optional().describe("Steam install root"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
  {
    name: "steam_manifest",
    ...toolContractMetadata("steam_manifest"),
    kind: "application",
    description:
      "Decode a Steam depot manifest (depotcache/*.manifest or a downloaded manifest): depot id, gid, creation time, sizes and the file list with flags and SHA-1.",
    inputSchema: z.object({
      path: z.string().describe("Manifest file"),
      limit: z.number().optional().describe("Files returned (default 200)"),
    }),
    outputSchema: z.object({ result: z.unknown() }),
    examples: [],
  },
] as const satisfies readonly ToolContract[];
export type BunOsToolName = (typeof BUN_OS_TOOL_CONTRACTS)[number]["name"];
export type BunOsToolInput<Name extends BunOsToolName> = z.infer<
  Extract<
    (typeof BUN_OS_TOOL_CONTRACTS)[number],
    { readonly name: Name }
  >["inputSchema"]
>;
