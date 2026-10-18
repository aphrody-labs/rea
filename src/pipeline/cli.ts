// SPDX-License-Identifier: Apache-2.0
import { parseArgs } from "node:util";
import {
  type AdapterInfo,
  type PipelineReport,
  type Stage,
  type TargetKind,
  STAGES,
} from "./contract.js";
import { defaultDbPath, openAnalysisDb, recordRun } from "./db.js";
import { emitSchemas, listAdapters, runPipeline } from "./runner.js";

const USAGE = `re pipeline <input> --target <os|bios|firmware> [--out DIR] [--external] [--trace]
                 [--max-functions N] [--max-insns N] [--timeout SECS] [--db] [--json]
re pipeline adapters [--stage <stage>] [--json]
re pipeline schema <dir>`;

function printReport(r: PipelineReport): void {
  console.log(`pipeline ${r.summary}: ${r.input} (${r.target}) -> ${r.outdir}`);
  for (const s of r.stages) {
    console.log(
      `  ${s.stage.padEnd(9)} ${s.status.padEnd(11)} ${s.adapter.padEnd(18)} ${s.detail}`,
    );
  }
}

function printAdapters(list: AdapterInfo[]): void {
  for (const a of list) {
    const why = a.reason ? `  (${a.reason})` : "";
    console.log(
      `${a.stage.padEnd(9)} ${a.status.padEnd(11)} ${a.id.padEnd(22)} ${a.kind.padEnd(8)} ${a.owner}${why}`,
    );
  }
}

/** Entry point for `re pipeline ...`. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: "string", default: "os" },
      out: { type: "string" },
      stage: { type: "string" },
      external: { type: "boolean", default: false },
      trace: { type: "boolean", default: false },
      db: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "max-functions": { type: "string" },
      "max-insns": { type: "string" },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const [first, second] = positionals;
  if (first === "adapters") {
    const stage = values.stage as Stage | undefined;
    if (stage && !STAGES.includes(stage))
      throw new Error(`unknown stage ${stage}`);
    const list = await listAdapters(stage);
    if (values.json) console.log(JSON.stringify(list, null, 2));
    else printAdapters(list);
    return 0;
  }
  if (first === "schema") {
    await emitSchemas(second ?? "schema");
    return 0;
  }
  const target = values.target as TargetKind;
  if (!["os", "bios", "firmware"].includes(target))
    throw new Error("--target must be os, bios or firmware");
  const input = first!;
  const out = values.out ?? `bunre-out/${Bun.hash(input).toString(16)}`;
  const report = await runPipeline(input, {
    target,
    outdir: out,
    external: values.external,
    trace: values.trace,
    maxFunctions: values["max-functions"]
      ? Number(values["max-functions"])
      : undefined,
    maxInsns: values["max-insns"] ? Number(values["max-insns"]) : undefined,
    timeoutSecs: values.timeout ? Number(values.timeout) : undefined,
  });
  if (values.db) {
    const db = openAnalysisDb(defaultDbPath(out));
    recordRun(db, report);
    db.close();
  }
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return report.summary === "failed" ? 1 : 0;
}
