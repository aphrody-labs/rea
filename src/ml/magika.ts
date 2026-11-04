import { delimiter, dirname, join, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkoutRoot } from "../pipeline/runner.js";

const root = checkoutRoot();
const project = join(root, "vendor", "magika", "python");
const environment = join(project, ".venv");
const bridge = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "python",
);

export interface MagikaPrediction {
  engine: "magika";
  version: string;
  path: string;
  ok: boolean;
  status: string;
  prediction?: {
    label: string;
    mimeType: string;
    group: string;
    description: string;
    extensions: string[];
    isText: boolean;
    score: number;
  };
}

export function magikaSetupCommand(): string[] {
  return ["uv", "sync", "--project", project, "--locked", "--no-dev"];
}

export async function setupMagika(): Promise<number> {
  const uv = Bun.which("uv");
  if (!uv) {
    console.error(
      "Magika setup requires uv (https://docs.astral.sh/uv/); install uv and rerun `bun run re magika setup`.",
    );
    return 127;
  }

  // This is the upstream Google Magika Python project, pinned by vendor/magika's
  // Git submodule commit and its own uv.lock. On Windows maturin uses the
  // caller's installed Rust/MSVC toolchain; yolo-re does not install one.
  const [executable, ...args] = magikaSetupCommand();
  const child = Bun.spawn([uv, ...args], {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function sitePackages(): Promise<string> {
  const windows = join(environment, "Lib", "site-packages");
  try {
    await readdir(windows);
    return windows;
  } catch {
    // Non-Windows environments use lib/pythonX/site-packages below.
  }

  for await (const path of new Bun.Glob("lib/python*/site-packages").scan({
    cwd: environment,
    absolute: true,
    onlyFiles: false,
  })) {
    return path;
  }
  throw new Error("Magika is not built; run `re magika setup`");
}

/** Files of a folder identified by one Magika session (bounded, regular files only). */
export interface MagikaTree {
  engine: "magika";
  root: string;
  files: number;
  truncated: boolean;
  labels: Record<string, number>;
  results: MagikaPrediction[];
  seconds: number;
}

/** One Magika session: a venv Python subprocess classifies the paths and prints one JSON object per line. */
async function withMagika<T>(
  paths: string[],
  work: (results: MagikaPrediction[]) => T,
): Promise<T> {
  const executable = join(
    environment,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (!(await Bun.file(executable).exists()))
    throw new Error("Magika is not built; run `re magika setup`");

  const packages = await sitePackages();
  const script = [
    "import json, site, sys",
    `site.addsitedir(${JSON.stringify(packages)})`,
    `sys.path.insert(0, ${JSON.stringify(bridge)})`,
    "import magika_bridge",
    "for line in sys.stdin:",
    "    path = json.loads(line)",
    "    print(magika_bridge.identify_path_json(path), flush=True)",
  ].join("\n");
  const child = Bun.spawn([executable, "-c", script], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      VIRTUAL_ENV: environment,
      PYTHONPATH: [bridge, process.env.PYTHONPATH]
        .filter(Boolean)
        .join(delimiter),
    },
  });
  child.stdin.write(paths.map((path) => JSON.stringify(path)).join("\n") + (paths.length ? "\n" : ""));
  void child.stdin.end();
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Magika failed (${code}): ${err.trim()}`);
  const results = out
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as MagikaPrediction);
  if (results.length !== paths.length)
    throw new Error(`Magika returned ${results.length} results for ${paths.length} paths`);
  return work(results);
}

export async function identifyWithMagika(
  path: string,
): Promise<MagikaPrediction> {
  const absolute = resolve(path);
  if (!(await Bun.file(absolute).exists()))
    throw new Error(`file not found: ${path}`);
  return withMagika([absolute], (results) => results[0]!);
}

/** Identify every regular file under `dir` (depth-first, at most `limit` files). */
export async function identifyTreeWithMagika(
  dir: string,
  limit = 500,
): Promise<MagikaTree> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000)
    throw new RangeError("Magika file limit must be an integer from 1 to 10000");
  const absolute = resolve(dir);
  const started = performance.now();
  const paths: string[] = [];
  let truncated = false;
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: absolute,
    absolute: true,
    dot: false,
    onlyFiles: true,
  })) {
    if (paths.length === limit) {
      truncated = true;
      break;
    }
    paths.push(path);
  }
  paths.sort();
  const results = await withMagika(paths, (identified) => identified);
  const labels: Record<string, number> = {};
  for (const r of results) {
    const label = r.prediction?.label ?? r.status;
    labels[label] = (labels[label] ?? 0) + 1;
  }
  return {
    engine: "magika",
    root: absolute,
    files: results.length,
    truncated,
    labels,
    results,
    seconds: (performance.now() - started) / 1000,
  };
}
