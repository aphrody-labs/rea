// SPDX-License-Identifier: Apache-2.0
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterInfo,
  PipelineOptions,
  PipelineReport,
  RecompileOptions,
  Stage,
} from "./contract.js";

// Only `import.meta.url` survives the runtime bundle (scripts/bundle-runtime.mjs).
const here = dirname(fileURLToPath(import.meta.url));
const SUFFIX = process.platform === "win32" ? ".exe" : "";

/** Bun OS checkout root: BUN_OS_ROOT or the nearest ancestor holding AGENTS.md and crates/. */
export function findRoot(from = process.cwd()): string | undefined {
  if (process.env.BUN_OS_ROOT && existsSync(process.env.BUN_OS_ROOT))
    return process.env.BUN_OS_ROOT;
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "AGENTS.md")) && existsSync(join(dir, "crates")))
      return dir;
    const up = resolve(dir, "..");
    if (up === dir) return undefined;
    dir = up;
  }
}

/**
 * The Bun OS checkout this package runs from (`BUN_OS_ROOT` overrides); outside a checkout, the
 * directory that would hold `packages/re`.
 */
export function checkoutRoot(): string {
  return findRoot(here) ?? resolve(here, "..", "..", "..", "..");
}

/**
 * Locate a native Bun OS binary built from this checkout: the `env` override, then
 * `target/{,slot-N/}{release,debug}` of the checkout and the shared Aphrody Cargo target directories
 * (newest build wins), then
 * `PATH`. The one lookup used for `bunre` and the `bun-engine` machine CLI.
 */
export async function findNative(
  name: string,
  env: string,
  from?: string,
): Promise<string | undefined> {
  // A bare name is an executable; a name with an extension (`x.dll`) is taken as is.
  const file = /\.\w+$/.test(name) ? name : `${name}${SUFFIX}`;
  const override = process.env[env];
  if (override && existsSync(override)) return override;
  const root = findRoot(from) ?? findRoot(here);
  const roots = [
    root && join(root, "target"),
    process.env.CARGO_TARGET_DIR,
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, "Aphrody", "cache", "cargo-target"),
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, "aphrody", "target"),
  ].filter(Boolean) as string[];
  // The serialized Cargo wrapper builds in parallel slots: slot 0 is `target/`, slot N is
  // `target/slot-N/`. The most recently built binary wins, whichever slot and profile built it.
  let best: { path: string; mtime: number } | undefined;
  for (const base of roots) {
    if (!existsSync(base)) continue;
    const bases = [base];
    for (const slot of new Bun.Glob("slot-*").scanSync({
      cwd: base,
      onlyFiles: false,
    }))
      bases.push(join(base, slot));
    for (const dir of bases)
      for (const profile of ["release", "debug"]) {
        const hit = join(dir, profile, file);
        if (!existsSync(hit)) continue;
        const mtime = statSync(hit).mtimeMs;
        if (!best || mtime > best.mtime) best = { path: hit, mtime };
      }
  }
  return best?.path ?? Bun.which(name) ?? undefined;
}

/** Build command of a native owner through the serialized wrapper (AGENTS.md). */
export const nativeBuildHint = (pkg: string, bin: string): string =>
  `bun msvc exec --toolset 14.44 -- bun scripts/cargo.ts exec -- build --release -p ${pkg} --bin ${bin}`;

/** Locate the Rust `bunre` binary (`BUNRE_BIN` overrides). */
export async function findBinary(): Promise<string> {
  const bin = await findNative("bunre", "BUNRE_BIN");
  if (bin) return bin;
  throw new Error(
    `bunre not found. Build it with \`${nativeBuildHint("bun-re", "bunre")}\`, or set BUNRE_BIN.`,
  );
}

/** Locate the native Bun Engine machine CLI (`BUN_ENGINE_NATIVE` overrides). */
export async function findEngine(): Promise<string | undefined> {
  return findNative("bun-engine", "BUN_ENGINE_NATIVE");
}

/** Spawn a native binary with a deadline and capture its output. */
export async function spawnCaptured(
  argv: string[],
  timeoutMs: number,
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(argv, {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [out, err, code] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    return { code, out, err };
  } finally {
    clearTimeout(timer);
  }
}

async function exec(
  args: string[],
  timeoutMs: number,
  command = "pipeline",
): Promise<{ code: number; out: string; err: string }> {
  return spawnCaptured([await findBinary(), command, ...args], timeoutMs);
}

/**
 * Statically recompile a console BIOS/ROM image (GBA, PlayStation, NES) to a native executable or
 * WebAssembly module over the Bun Engine core, and verify it against the interpreter.
 */
export async function recompile(
  input: string,
  opts: RecompileOptions,
): Promise<PipelineReport> {
  const args = [input, "--target", opts.target, "--out", resolve(opts.outdir)];
  if (opts.machine) args.push("--machine", opts.machine);
  if (opts.bios) args.push("--bios", resolve(opts.bios));
  if (opts.frames) args.push("--frames", String(opts.frames));
  if (opts.noBuild) args.push("--no-build");
  if (opts.input) args.push("--input", opts.input);
  if (opts.timeoutSecs) args.push("--timeout", String(opts.timeoutSecs));
  // Cargo waits for the host's single native build slot, so allow hours.
  const { code, out, err } = await exec(
    args,
    ((opts.timeoutSecs ?? 3600) * 4 + 120) * 1000,
    "recompile",
  );
  if (!out.trim())
    throw new Error(`bunre recompile exited ${code}: ${err.trim()}`);
  return JSON.parse(out) as PipelineReport;
}

/** Captured run of the native Bun Engine CLI (`run <system> <image> --headless ...`). */
export async function runEngine(
  args: string[],
  timeoutMs = 600_000,
): Promise<{ code: number; out: string; err: string }> {
  const bin = await findEngine();
  if (!bin)
    throw new Error(
      `bun-engine not found. Build it with \`${nativeBuildHint("bun-engine", "bun-engine")}\`, or set BUN_ENGINE_NATIVE.`,
    );
  return spawnCaptured([bin, ...args], timeoutMs);
}

export async function runPipeline(
  input: string,
  opts: PipelineOptions,
): Promise<PipelineReport> {
  const args = [
    "run",
    input,
    "--target",
    opts.target,
    "--out",
    resolve(opts.outdir),
  ];
  if (opts.external) args.push("--external");
  if (opts.trace) args.push("--trace");
  if (opts.maxFunctions)
    args.push("--max-functions", String(opts.maxFunctions));
  if (opts.maxInsns) args.push("--max-insns", String(opts.maxInsns));
  if (opts.timeoutSecs) args.push("--timeout", String(opts.timeoutSecs));
  const { code, out, err } = await exec(
    args,
    ((opts.timeoutSecs ?? 600) * 8 + 60) * 1000,
  );
  if (!out.trim())
    throw new Error(`bunre pipeline exited ${code}: ${err.trim()}`);
  return JSON.parse(out) as PipelineReport;
}

export async function listAdapters(stage?: Stage): Promise<AdapterInfo[]> {
  const { code, out, err } = await exec(
    stage ? ["adapters", "--stage", stage] : ["adapters"],
    60_000,
  );
  if (code !== 0)
    throw new Error(`bunre pipeline adapters exited ${code}: ${err.trim()}`);
  return JSON.parse(out) as AdapterInfo[];
}

export async function emitSchemas(dir: string): Promise<void> {
  const { code, err } = await exec(["schema", resolve(dir)], 60_000);
  if (code !== 0)
    throw new Error(`bunre pipeline schema exited ${code}: ${err.trim()}`);
}

/** Run several inputs with bounded concurrency; each run is its own process. */
export async function runBatch(
  inputs: string[],
  opts: PipelineOptions,
  concurrency = Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 2)),
): Promise<PipelineReport[]> {
  const results: PipelineReport[] = [];
  results.length = inputs.length;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      for (let i = next++; i < inputs.length; i = next++) {
        const tag = Bun.hash(inputs[i]!).toString(16);
        results[i] = await runPipeline(inputs[i]!, {
          ...opts,
          outdir: join(opts.outdir, `${i}-${tag}`),
        });
      }
    }),
  );
  return results;
}
