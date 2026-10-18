// SPDX-License-Identifier: Apache-2.0
// `re game <appid|path> <command>`: the game-agnostic asset pipeline. Steam installs resolve
// through `@aphrody/bun-steam`; detection, mounting, conversion and export run in the native
// `bunre game`; the index lives in `bun:sqlite`; `serve` exposes the NIE model-serve HTTP API.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { findNative } from "../pipeline/runner.js";
import { buildIndex } from "./index.js";
import {
  type NativeOptions,
  type ResolvedTarget,
  resolveTarget,
  runJson,
} from "./native.js";
import { serve } from "./server.js";

const USAGE = `Usage: re game <appid|path> <command> [options]
  detect                       engine, containers, anti-cheat (reported only), profile
  mount                        mount report and statistics
  index [--db <file>] [--magika <n>]   bun:sqlite index (default ~/.aphrody/cache/re-game/<id>.sqlite)
  export --out <new-dir> [--kinds texture,model,audio,table] [--per-kind <n>] [--filter <s>]
                               stratified open-format export (PNG, WAV, glTF, JSON, MP4/WebM)
  serve [--port 8793] [--host 127.0.0.1] [--db <file>]   model-serve HTTP API
  view <file.glb> [--out <png>] [--gpu]   render with the native GLB renderer (CPU or wgpu)
Options: --profile <id> --only <glob> --no-loose --max-files <n>
Keys are never embedded: pass --aes-key/--hca-key through BUNRE_GAME_AES_KEY / BUNRE_GAME_HCA_KEY.`;

interface Parsed {
  positional: string[];
  options: Map<string, string[]>;
}

const FLAGS = new Set(["--no-loose", "--gpu", "--raw", "--converted-only"]);

function parse(argv: string[]): Parsed {
  const positional: string[] = [];
  const options = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) positional.push(arg);
    else if (FLAGS.has(arg)) options.set(arg, []);
    else options.set(arg, [...(options.get(arg) ?? []), argv[++i] ?? ""]);
  }
  return { positional, options };
}

const last = (p: Parsed, name: string) => p.options.get(name)?.at(-1);

function nativeOptions(p: Parsed): NativeOptions {
  const maxFiles = last(p, "--max-files");
  return {
    profile: last(p, "--profile"),
    only: p.options.get("--only"),
    noLoose: p.options.has("--no-loose"),
    maxFiles: maxFiles ? Number(maxFiles) : undefined,
  };
}

function defaultDb(id: string): string {
  const dir = join(homedir(), ".aphrody", "cache", "re-game");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${id.replace(/[^\w.-]+/g, "_")}.sqlite`);
}

async function view(p: Parsed): Promise<number> {
  const glb = p.positional.at(-1);
  if (!glb || glb === "view") throw new Error("view <file.glb>");
  const renderer = await findNative("aphrody-nie-render3d", "NIE_RENDER3D_BIN");
  if (!renderer)
    throw new Error(
      "aphrody-nie-render3d not found: build it with `bun msvc exec --toolset 14.44 -- bun scripts/cargo.ts exec -- build --release -p aphrody-nie-render3d --features gpu`",
    );
  const out = resolve(last(p, "--out") ?? `${glb}.png`);
  const args = [renderer, "--glb", resolve(glb), "--out", out];
  if (p.options.has("--gpu")) args.push("--gpu");
  const code = await Bun.spawn(args, { stdout: "inherit", stderr: "inherit" })
    .exited;
  if (code === 0) console.log(out);
  return code;
}

interface Context {
  p: Parsed;
  resolved: ResolvedTarget;
  opts: NativeOptions;
  id: string;
}

async function report({ p, resolved, opts }: Context): Promise<number> {
  const command = p.positional[1] ?? "detect";
  const result = await runJson<Record<string, unknown>>({
    command,
    root: resolved.root,
    opts,
  });
  console.log(JSON.stringify({ target: resolved, ...result }, null, 2));
  return 0;
}

async function index({ p, resolved, opts, id }: Context): Promise<number> {
  const db = resolve(last(p, "--db") ?? defaultDb(id));
  const result = await buildIndex(
    resolved.root,
    db,
    opts,
    Number(last(p, "--magika") ?? 32),
  );
  console.log(JSON.stringify({ target: resolved, ...result }, null, 2));
  return 0;
}

async function exportCommand({ p, resolved, opts }: Context): Promise<number> {
  const out = last(p, "--out");
  if (!out) throw new Error("export --out <new-dir>");
  const extra = ["--out", resolve(out)];
  for (const name of ["--kinds", "--per-kind", "--filter", "--max-mb"]) {
    const value = last(p, name);
    if (value) extra.push(name, value);
  }
  for (const flag of ["--raw", "--converted-only"])
    if (p.options.has(flag)) extra.push(flag);
  const summary = await runJson<Record<string, unknown>>({
    command: "export",
    root: resolved.root,
    extra,
    opts,
    timeoutMs: 3_600_000,
  });
  console.log(JSON.stringify({ target: resolved, ...summary }, null, 2));
  return 0;
}

async function serveCommand({
  p,
  resolved,
  opts,
  id,
}: Context): Promise<number> {
  const db = resolve(last(p, "--db") ?? defaultDb(id));
  if (!existsSync(db)) await buildIndex(resolved.root, db, opts);
  const { server, worker } = await serve({
    ...opts,
    root: resolved.root,
    db,
    port: Number(last(p, "--port") ?? 8793),
    hostname: last(p, "--host") ?? "127.0.0.1",
  });
  console.log(
    JSON.stringify({
      url: server.url.href,
      profile: worker.profile,
      entries: worker.entries,
      db,
    }),
  );
  await new Promise(() => {});
  return 0;
}

const COMMANDS: Record<string, (context: Context) => Promise<number>> = {
  detect: report,
  mount: report,
  index,
  export: exportCommand,
  serve: serveCommand,
  view: ({ p }) => view(p),
};

export async function main(argv: string[]): Promise<number> {
  const p = parse(argv);
  const [target, command] = p.positional;
  if (target === "view") return view(p);
  const handler = command ? COMMANDS[command] : undefined;
  if (!target || !handler) {
    console.error(USAGE);
    return 2;
  }
  const resolved = resolveTarget(target);
  const id = resolved.appId ? String(resolved.appId) : resolved.root;
  return handler({ p, resolved, opts: nativeOptions(p), id });
}
