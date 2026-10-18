// SPDX-License-Identifier: Apache-2.0
// `re recompile` (also `bun-engine recompile`): static recompilation of console BIOS and ROM
// images through `bunre recompile` (crates/re, pipeline::recomp) over the Bun Engine cores.
import { parseArgs } from "node:util";
import type {
  PipelineReport,
  RecompileMachine,
  RecompileTarget,
  VerifyOutput,
} from "./contract.js";
import { recompile } from "./runner.js";

const USAGE = `re recompile <image> --target <exe|wasm> [--out DIR] [--machine gba|psx|nes]
             [--bios FILE] [--frames N] [--input key@first[-last],...]
             [--no-build] [--timeout SECS] [--json]

Lifts a GBA ROM (ARMv4T ARM/Thumb, with the GBA BIOS), a PlayStation BIOS or PS-EXE (MIPS
R3000A) or an NES cartridge (6502) to the bun-re IR, emits a Rust crate over the matching Bun
Engine core (RustBoyAdvance-NG, StarPSX, TetaNES), builds it for the host or wasm32 and checks
its frame buffer and console output against the interpreter and \`bun-engine run\`.`;

function printReport(r: PipelineReport): void {
  for (const s of r.stages) {
    if (["acquire", "identify", "unpack", "analyze"].includes(s.stage))
      continue;
    console.log(
      `  ${s.stage.padEnd(9)} ${s.status.padEnd(11)} ${s.adapter.padEnd(20)} ${s.detail.split("\n")[0]}`,
    );
    if (s.adapter === "recompile-verify") {
      for (const c of (s.output as VerifyOutput).checks ?? [])
        console.log(
          `    ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.name === "translated-code-ran" || !c.ok ? `: ${c.detail}` : ""}`,
        );
    }
  }
  console.log(`recompiled -> ${r.outdir}`);
}

/** Whether the report proves a successful recompilation. */
export function recompileSucceeded(r: PipelineReport, built: boolean): boolean {
  const adapter = built ? "recompile-verify" : "emit-console-rust";
  return r.stages.some((s) => s.adapter === adapter && s.status === "ok");
}

/** Entry point of `re recompile ...` and `bun-engine recompile ...`. Returns the exit code. */
export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: "string", default: "exe" },
      out: { type: "string" },
      machine: { type: "string" },
      bios: { type: "string" },
      frames: { type: "string" },
      "no-build": { type: "boolean", default: false },
      input: { type: "string" },
      timeout: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const input = positionals[0];
  if (values.help || !input) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  if (!["exe", "wasm"].includes(values.target))
    throw new Error("--target must be exe or wasm");
  if (values.machine && !["gba", "psx", "nes"].includes(values.machine))
    throw new Error("--machine must be gba, psx or nes");
  const report = await recompile(input, {
    target: values.target as RecompileTarget,
    outdir: values.out ?? `bunre-recompile/${Bun.hash(input).toString(16)}`,
    machine: values.machine as RecompileMachine | undefined,
    bios: values.bios,
    frames: values.frames ? Number(values.frames) : undefined,
    noBuild: values["no-build"],
    input: values.input,
    timeoutSecs: values.timeout ? Number(values.timeout) : undefined,
  });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return recompileSucceeded(report, !values["no-build"]) ? 0 : 1;
}
