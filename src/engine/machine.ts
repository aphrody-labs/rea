// SPDX-License-Identifier: Apache-2.0
// `re engine`: headless Bun Engine machine runs and DS header validation through the native
// `bun-engine` CLI (crates/bun-engine-core), the one owner of the emulation cores.
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { runEngine } from "../pipeline/runner.js";

export interface MachineRunOptions {
  /** nds, 3ds, switch, gba, nes, psx, wii, gc, arm, x86, linux (or a C++ host core). */
  system: string;
  image: string;
  frames?: number | undefined;
  bios?: string | undefined;
  /** Directory receiving `screen<i>.ppm`. */
  out?: string | undefined;
  /** Scripted pad input `key@first[-last],...` (keys a b select start right left up down r l x y). */
  input?: string | undefined;
  /** JSON Lines file receiving one `{frame, keys, screens}` digest per frame. */
  trace?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface MachineRun {
  system: string;
  image: string;
  frames: number;
  machine: string | null;
  console: string;
  stopped: string | null;
  out: string | null;
  trace: string | null;
  seconds: number;
}

/** Run one image headless for a bounded number of frames and return its console output. */
export async function runMachine(o: MachineRunOptions): Promise<MachineRun> {
  const frames = o.frames ?? 60;
  const args = [
    "run",
    o.system,
    resolve(o.image),
    "--headless",
    "--frames",
    String(frames),
  ];
  if (o.bios) args.push("--bios", resolve(o.bios));
  if (o.out) args.push("--out", resolve(o.out));
  if (o.input) args.push("--input", o.input);
  if (o.trace) args.push("--trace", resolve(o.trace));
  const started = performance.now();
  const { code, out, err } = await runEngine(args, o.timeoutMs);
  if (code !== 0) throw new Error(`bun-engine exited ${code}: ${err.trim()}`);
  // The CLI ends with `<machine>: <n> frames`; everything before it is guest console output.
  const tail = /\n?([\w .()/-]+): (\d+) frames\s*$/.exec(out);
  return {
    system: o.system,
    image: resolve(o.image),
    frames: tail ? Number(tail[2]) : frames,
    machine: tail?.[1]?.trim() ?? null,
    console: tail ? out.slice(0, tail.index) : out,
    stopped: /stopped: (.*)/.exec(err)?.[1] ?? null,
    out: o.out ? resolve(o.out) : null,
    trace: o.trace ? resolve(o.trace) : null,
    seconds: (performance.now() - started) / 1000,
  };
}

/** `bun-engine info <rom.nds> --json`: read-only DS/DSi header and region validation. */
export async function machineInfo(rom: string): Promise<unknown> {
  const { code, out, err } = await runEngine(
    ["info", resolve(rom), "--json"],
    60_000,
  );
  if (!out.trim()) throw new Error(`bun-engine info exited ${code}: ${err}`);
  return JSON.parse(out);
}

const USAGE = `re engine run <system> <image> [--frames N] [--bios FILE] [--out DIR]
                [--input key@first[-last],...] [--trace FILE.jsonl] [--json]
re engine info <rom.nds> [--json]`;

/** Entry point of \`re engine ...\`. Returns the exit code. */
export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      frames: { type: "string" },
      bios: { type: "string" },
      out: { type: "string" },
      input: { type: "string" },
      trace: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, first, second] = positionals;
  if (command === "info" && first) {
    console.log(JSON.stringify(await machineInfo(first), null, 2));
    return 0;
  }
  if (command !== "run" || !first || !second || values.help) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const run = await runMachine({
    system: first,
    image: second,
    frames: values.frames ? Number(values.frames) : undefined,
    bios: values.bios,
    out: values.out,
    input: values.input,
    trace: values.trace,
  });
  if (values.json) console.log(JSON.stringify(run, null, 2));
  else {
    process.stdout.write(run.console);
    console.log(
      `${run.machine ?? run.system}: ${run.frames} frames in ${run.seconds.toFixed(2)}s${run.out ? ` -> ${run.out}` : ""}`,
    );
    if (run.stopped) console.error(`stopped: ${run.stopped}`);
  }
  return 0;
}
