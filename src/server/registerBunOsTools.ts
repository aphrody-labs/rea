// SPDX-License-Identifier: Apache-2.0
import {
  BUN_OS_TOOL_CONTRACTS,
  type BunOsToolName,
  type BunOsToolInput,
} from "../contracts/bunOsToolContracts.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import { TARGET_CONTENT_RESULT_META } from "./toolResultEncoding.js";
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
  structuredContent?: { result: unknown };
  _meta: typeof TARGET_CONTENT_RESULT_META;
};

const json = (value: unknown): string =>
  typeof value === "string"
    ? value
    : JSON.stringify(value, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      );

const run = async (work: () => unknown): Promise<ToolText> => {
  try {
    const value = await work();
    const text = json(value);
    return {
      _meta: TARGET_CONTENT_RESULT_META,
      content: [{ type: "text", text }],
      structuredContent: {
        result: typeof value === "string" ? value : JSON.parse(text),
      },
    };
  } catch (cause) {
    return {
      _meta: TARGET_CONTENT_RESULT_META,
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

const common = (args: {
  db?: string | undefined;
  root?: string | undefined;
}): CommonOptions => ({
  db: args.db,
  root: args.root,
});

type Register = <Name extends BunOsToolName>(
  name: Name,
  handler: (args: BunOsToolInput<Name>) => unknown,
) => void;
const registrar =
  (server: EvidenceMcpServer): Register =>
  (name, handler) => {
    const contract = BUN_OS_TOOL_CONTRACTS.find((item) => item.name === name)!;
    server.registerTool(
      name,
      toolRegistrationOptions(contract) as never,
      ((args: Parameters<typeof handler>[0]) =>
        run(() => handler(args))) as never,
    );
  };

/** Static recompilation of console images and Bun Engine machine runs. */
const registerEngineTools = (tool: Register): void => {
  tool("re_recompile", (a) =>
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
  tool("engine_run", (a) => runMachine(a));
  tool("engine_info", (a) => machineInfo(a.rom));
};

/**
 * Steam indexer, cross-OS RE pipeline, static recompilation and Bun Engine machine tools, served
 * by the one RE MCP server.
 */
export const registerBunOsTools = (server: EvidenceMcpServer): void => {
  const tool = registrar(server);
  registerEngineTools(tool);
  tool("steam_scan", (a) => opScan({ ...common(a), hashMax: a.hashMax }));
  tool("steam_stats", (a) => opStats(common(a)));
  tool("steam_sql", (a) => opSql(common(a), a.sql));
  tool("steam_api_sync", async (a) => {
    const db = openSteamDb(a.db);
    try {
      return await syncApiCatalog(db);
    } finally {
      db.close();
    }
  });
  tool("steam_classify", (a) => opClassify(a.path));
  tool("steam_rea", (a) => opRea(common(a), a.appid, a.outdir));
  tool("re_pipeline_run", (a) =>
    runPipeline(a.input, {
      target: (a.target ?? "os") as TargetKind,
      outdir: a.outdir,
      external: a.external ?? false,
      trace: a.trace ?? false,
    }),
  );
  tool("re_pipeline_adapters", (a) =>
    listAdapters(a.stage as Stage | undefined),
  );
  registerFormatTools(tool);
  registerBinaryTools(tool);
  registerReplicaTools(tool);
  registerSteamFileTools(tool);
};

/** Console image identification and disassembly (Bun Engine formats plugin, in process). */
const registerFormatTools = (tool: Register): void => {
  tool("formats_inspect", (a) =>
    inspectFormat(a.path, {
      files: a.files ?? false,
      digest: a.digest ?? false,
      magika: a.magika ?? false,
    }),
  );
  tool("formats_disasm", (a) => disassembleFormat(a.path, a));
};

/** Static binary triage, Ghidra readiness and Magika file typing. */
const registerBinaryTools = (tool: Register): void => {
  tool("binary_inspect", (a) =>
    inspectBinary(a.path, {
      strings: a.strings,
      importsPerModule: a.imports,
      host: a.host,
    }),
  );
  tool("ghidra_probe", () => probeBunOsGhidra());
  tool("magika_identify", async (a) =>
    (await stat(a.path)).isDirectory()
      ? identifyTreeWithMagika(a.path, a.limit)
      : identifyWithMagika(a.path),
  );
};

/** Replica intake and deterministic input recordings of Bun Engine machines. */
const registerReplicaTools = (tool: Register): void => {
  tool("replica_record", (a) => recordReplay(a));
  tool("replica_replay", (a) => replayReplay(a.replay));
  tool("replica_nds", (a) =>
    a.out ? initializeReplicaInput(a.rom, a.out) : inspectNdsReplica(a.rom),
  );
};

/** Steam client files decoded by the bun-steam owner (read-only). */
const registerSteamFileTools = (tool: Register): void => {
  tool("steam_appinfo", async (a) => {
    const file = join(resolveSteamRoot(a.root), "appcache", "appinfo.vdf");
    const info = parseAppInfo(await Bun.file(file).bytes());
    const app = info.apps.find((entry) => entry.appid === a.appid);
    if (!app) throw new Error(`app ${a.appid} is not in ${file}`);
    return { file, version: info.version, app };
  });
  tool("steam_manifest", async (a) => {
    const manifest = parseDepotManifest(await Bun.file(a.path).bytes());
    return {
      metadata: manifest.metadata,
      files: manifest.files.length,
      list: manifest.files.slice(0, a.limit ?? 200),
    };
  });
};
