// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { Stage, TargetKind } from "../pipeline/contract.js";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { listAdapters, recompile, runPipeline } from "../pipeline/runner.js";
import { machineInfo, runMachine } from "../engine/machine.js";
import { disassembleFormat, inspectFormat } from "../engine/formats.js";
import { inspectBinary } from "../binary/inspect.js";
import { recordReplay, replayReplay } from "../replica/replay.js";
import { inspectNdsReplica } from "../replica/nds.js";
import { initializeReplicaInput } from "../replica/input.js";
import { probeBunOsGhidra } from "../composition/bunOsGhidra.js";
import { identifyTreeWithMagika, identifyWithMagika } from "../ml/magika.js";
import {
  type CommonOptions,
  openSteamDb,
  opClassify,
  opScan,
  opSql,
  opStats,
  parseAppInfo,
  parseDepotManifest,
  resolveSteamRoot,
  syncApiCatalog,
} from "@aphrody/bun-steam";
import { opRea } from "../steamRea.js";

type ToolText = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const json = (value: unknown): string =>
  typeof value === "string"
    ? value
    : JSON.stringify(value, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );

const run = async (work: () => unknown): Promise<ToolText> => {
  try {
    return { content: [{ type: "text", text: json(await work()) }] };
  } catch (cause) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: cause instanceof Error ? cause.message : String(cause),
        },
      ],
    };
  }
};

const steamDatabase = {
  db: z.string().optional().describe("Steam SQLite database path"),
  root: z.string().optional().describe("Steam install root"),
};

const common = (args: {
  db?: string | undefined;
  root?: string | undefined;
}): CommonOptions => ({
  db: args.db,
  root: args.root,
});

type Register = <Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  handler: (args: z.infer<z.ZodObject<Shape>>) => unknown,
) => void;

const registrar =
  (server: EvidenceMcpServer): Register =>
  (name, description, shape, handler) => {
    server.registerTool(
      name,
      { description, inputSchema: z.object(shape) } as never,
      ((args: Parameters<typeof handler>[0]) =>
        run(() => handler(args))) as never,
    );
  };

/** Static recompilation of console images and Bun Engine machine runs. */
const registerEngineTools = (tool: Register): void => {
  tool(
    "re_recompile",
    "Statically recompile a console image (GBA ROM with its BIOS, PlayStation BIOS or PS-EXE, NES cartridge) to a native executable or WebAssembly module over the Bun Engine core, then verify the frame buffer and console output against the interpreter and `bun-engine run`. Returns the PipelineReport; the recompile-verify stage lists the checks and execution counters.",
    {
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
    },
    (a) =>
      recompile(a.input, {
        target: a.target ?? "exe",
        outdir: a.outdir,
        machine: a.machine,
        bios: a.bios,
        frames: a.frames,
        noBuild: a.noBuild,
        input: a.keys,
      }),
  );
  tool(
    "engine_run",
    "Run a console image headless on the Bun Engine cores (`bun-engine run`: nds, 3ds, switch, gba, nes, psx, wii, gc, arm, x86, linux) for a bounded number of frames, optionally with scripted pad input and a per-frame screen digest trace; writes screen<i>.ppm dumps to `out` and returns the guest console output.",
    {
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
    },
    (a) => runMachine(a),
  );
  tool(
    "engine_info",
    "Validate a Nintendo DS/DSi cartridge header with the native Bun Engine inspector (title, codes, CRCs, regions) without running it.",
    { rom: z.string().describe("Path of the .nds image") },
    (a) => machineInfo(a.rom),
  );
};

/**
 * Steam indexer, cross-OS RE pipeline, static recompilation and Bun Engine machine tools, served
 * by the one RE MCP server.
 */
export const registerBunOsTools = (server: EvidenceMcpServer): void => {
  const tool = registrar(server);
  registerEngineTools(tool);
  tool(
    "steam_scan",
    "Index the local Steam install into SQLite",
    { ...steamDatabase, hashMax: z.number().optional() },
    (a) => opScan({ ...common(a), hashMax: a.hashMax }),
  );
  tool(
    "steam_stats",
    "Row counts per table of the Steam database",
    steamDatabase,
    (a) => opStats(common(a)),
  );
  tool(
    "steam_sql",
    "Run a read-only SELECT on the Steam database",
    { ...steamDatabase, sql: z.string() },
    (a) => opSql(common(a), a.sql),
  );
  tool(
    "steam_api_sync",
    "Index Steam Web API interfaces, methods, parameters and endpoints",
    steamDatabase,
    async (a) => {
      const db = openSteamDb(a.db);
      try {
        return await syncApiCatalog(db);
      } finally {
        db.close();
      }
    },
  );
  tool(
    "steam_classify",
    "Detect the file type of a path",
    { path: z.string() },
    (a) => opClassify(a.path),
  );
  tool(
    "steam_rea",
    "Run the RE pipeline on an installed Steam app executable",
    { ...steamDatabase, appid: z.number(), outdir: z.string().optional() },
    (a) => opRea(common(a), a.appid, a.outdir),
  );
  tool(
    "re_pipeline_run",
    "Run the cross-OS/BIOS/firmware RE pipeline (acquire, identify, unpack, analyze, lift, decompile, rebuild, verify) on a local file. Returns the typed PipelineReport; unavailable stages list candidate adapters.",
    {
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
    },
    (a) =>
      runPipeline(a.input, {
        target: (a.target ?? "os") as TargetKind,
        outdir: a.outdir,
        external: a.external ?? false,
        trace: a.trace ?? false,
      }),
  );
  tool(
    "re_pipeline_adapters",
    "List registered pipeline stage adapters with live availability (ready, registered, unavailable) and owners.",
    { stage: z.string().optional() },
    (a) => listAdapters(a.stage as Stage | undefined),
  );
  registerFormatTools(tool);
  registerBinaryTools(tool);
  registerReplicaTools(tool);
  registerSteamFileTools(tool);
};

/** Console image identification and disassembly (Bun Engine formats plugin, in process). */
const registerFormatTools = (tool: Register): void => {
  tool(
    "formats_inspect",
    "Identify a console ROM, BIOS, firmware dump, disc or executable (NES, GB/GBC, GBA, NDS, N64, GameCube/Wii, PlayStation, 3DS, Switch, Genesis, ELF...) and return the parsed header, sections, entry point and known-firmware matches (public hashes and the free firmware registry); optionally the embedded file system and CRC-32/MD5/SHA-1/SHA-256 digests.",
    {
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
    },
    (a) =>
      inspectFormat(a.path, {
        files: a.files ?? false,
        digest: a.digest ?? false,
        magika: a.magika ?? false,
      }),
  );
  tool(
    "formats_disasm",
    "Disassemble a window of a console image (6502, ARM/Thumb, LR35902, R3000/MIPS, PowerPC, AArch64, m68k); defaults to 16 instructions at the entry point.",
    {
      path: z.string().describe("Image path"),
      arch: z.string().optional().describe("Instruction set override"),
      at: z.number().optional().describe("Guest address"),
      offset: z.number().optional().describe("File offset (raw window)"),
      count: z
        .number()
        .optional()
        .describe("Instructions (default 16, max 4096)"),
    },
    (a) => disassembleFormat(a.path, a),
  );
};

/** Static binary triage, Ghidra readiness and Magika file typing. */
const registerBinaryTools = (tool: Register): void => {
  tool(
    "binary_inspect",
    "Static read-only first pass over a PE or ELF binary (emulator release, Steam client or game executable, Proton/Wine build): format, SHA-256, sections with entropy, imported libraries and symbols, exports, PE version resource and Authenticode, a bounded string sample and provenance (bep release, Steam app). `host` reads a remote file through `ssh HOST cat`.",
    {
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
    },
    (a) =>
      inspectBinary(a.path, {
        strings: a.strings,
        importsPerModule: a.imports,
        host: a.host,
      }),
  );
  tool(
    "ghidra_probe",
    "Report the Windows Ghidra integration: installed Ghidra (GHIDRA_INSTALL_DIR, version, analyzeHeadless), JAVA_HOME validity with remediation, the vendored Ghidra and NTRGhidra sources, MSVC and Windows SDK.",
    {},
    () => probeBunOsGhidra(),
  );
  tool(
    "magika_identify",
    "Classify a file, or every file of a folder (one Magika session, bounded by `limit`), with the Magika deep-learning content-type model; folders also return label counts.",
    {
      path: z.string().describe("File or folder"),
      limit: z.number().optional().describe("Folder file limit (default 500)"),
    },
    async (a) =>
      (await stat(a.path)).isDirectory()
        ? identifyTreeWithMagika(a.path, a.limit)
        : identifyWithMagika(a.path),
  );
};

/** Replica intake and deterministic input recordings of Bun Engine machines. */
const registerReplicaTools = (tool: Register): void => {
  tool(
    "replica_record",
    "Record a deterministic replay of a Bun Engine machine: run the image headless with scripted pad input and store the image/BIOS SHA-256, the input script and the per-frame screen digests in a replay JSON file.",
    {
      system: z.string().describe("Machine: gba, nes, psx, nds, ..."),
      image: z.string().describe("ROM or executable"),
      frames: z.number().optional().describe("Frames (default 600)"),
      input: z.string().optional().describe("Pad script key@first[-last],..."),
      bios: z.string().optional().describe("Firmware"),
      out: z
        .string()
        .optional()
        .describe("Replay file (default var/replica/replays)"),
    },
    (a) => recordReplay(a),
  );
  tool(
    "replica_replay",
    "Replay a recording on the same pinned image and report whether every frame and the console output are identical, with the first diverging frame.",
    { replay: z.string().describe("Replay JSON file") },
    (a) => replayReplay(a.replay),
  );
  tool(
    "replica_nds",
    "Read-only intake of a user-owned Nintendo DS image for a Replica project: cartridge header, ARM9/ARM7 layout, SHA-256 and readiness of the DS owners; with `out`, record the input provenance (input.json, status.json).",
    {
      rom: z.string().describe("Path of the .nds image"),
      out: z
        .string()
        .optional()
        .describe("Replica project directory to initialize"),
    },
    (a) =>
      a.out ? initializeReplicaInput(a.rom, a.out) : inspectNdsReplica(a.rom),
  );
};

/** Steam client files decoded by the bun-steam owner (read-only). */
const registerSteamFileTools = (tool: Register): void => {
  tool(
    "steam_appinfo",
    "Decode one app from the local Steam appinfo.vdf (PICS cache): change number, tokens and the full key/value tree (common, config, depots, branches).",
    {
      appid: z.number().describe("Steam app id"),
      root: z.string().optional().describe("Steam install root"),
    },
    async (a) => {
      const file = join(resolveSteamRoot(a.root), "appcache", "appinfo.vdf");
      const info = parseAppInfo(await Bun.file(file).bytes());
      const app = info.apps.find((entry) => entry.appid === a.appid);
      if (!app) throw new Error(`app ${a.appid} is not in ${file}`);
      return { file, version: info.version, app };
    },
  );
  tool(
    "steam_manifest",
    "Decode a Steam depot manifest (depotcache/*.manifest or a downloaded manifest): depot id, gid, creation time, sizes and the file list with flags and SHA-1.",
    {
      path: z.string().describe("Manifest file"),
      limit: z.number().optional().describe("Files returned (default 200)"),
    },
    async (a) => {
      const manifest = parseDepotManifest(await Bun.file(a.path).bytes());
      return {
        metadata: manifest.metadata,
        files: manifest.files.length,
        list: manifest.files.slice(0, a.limit ?? 200),
      };
    },
  );
};
