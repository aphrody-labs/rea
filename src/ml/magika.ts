import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkoutRoot, findNative } from "../pipeline/runner.js";

const root = process.env.BUN_ENGINE_HOME
  ? resolve(process.env.BUN_ENGINE_HOME)
  : checkoutRoot();
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
  return ["bun", "uv", "sync", "--project", project, "--locked", "--no-dev"];
}

export async function setupMagika(): Promise<number> {
  // The locked project builds Magika's PyO3 core with maturin and Cargo: on Windows it needs the
  // MSVC environment (LIB, INCLUDE) of the pinned toolset.
  const command =
    process.platform === "win32"
      ? [
          "bun",
          "msvc",
          "exec",
          "--toolset",
          "14.44",
          "--",
          ...magikaSetupCommand(),
        ]
      : magikaSetupCommand();
  const child = Bun.spawn(command, {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function sitePackages(): Promise<string> {
  const windows = join(environment, "Lib", "site-packages");
  for await (const _entry of new Bun.Glob("*").scan({
    cwd: windows,
    dot: true,
  }))
    return windows;

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

/**
 * The embedded CPython host library: `BUN_PYTHON_HOST_LIBRARY` when it exists, otherwise the
 * `bun-python-host` build of this checkout (any Cargo slot).
 */
async function pythonHostLibrary(): Promise<void> {
  const configured = process.env.BUN_PYTHON_HOST_LIBRARY;
  if (configured && (await Bun.file(configured).exists())) return;
  const name =
    process.platform === "win32"
      ? "bun_python_host.dll"
      : process.platform === "darwin"
        ? "libbun_python_host.dylib"
        : "libbun_python_host.so";
  const built = await findNative(name, "BUN_PYTHON_HOST_LIBRARY");
  if (built) process.env.BUN_PYTHON_HOST_LIBRARY = built;
}

/** One Magika session in the embedded CPython; the classifier loads once per session. */
async function withMagika<T>(
  work: (
    identify: (absolute: string) => Promise<MagikaPrediction>,
  ) => Promise<T>,
): Promise<T> {
  const executable = join(
    environment,
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
  if (!(await Bun.file(executable).exists()))
    throw new Error("Magika is not built; run `re magika setup`");

  process.env.VIRTUAL_ENV = environment;
  process.env.BUN_PYTHON_EXECUTABLE = executable;
  process.env.PYTHONPATH = [bridge, process.env.PYTHONPATH]
    .filter(Boolean)
    .join(delimiter);
  await pythonHostLibrary();

  const { Python } = await import("bun:python");
  await using py = await Python.async();
  const packages = await sitePackages();
  await py.exec(
    `import site, sys; site.addsitedir(${JSON.stringify(packages)}); sys.path.insert(0, ${JSON.stringify(bridge)})`,
  );
  return await work(
    async (absolute) =>
      JSON.parse(
        await py.call("magika_bridge", "identify_path_json", absolute),
      ) as MagikaPrediction,
  );
}

export async function identifyWithMagika(
  path: string,
): Promise<MagikaPrediction> {
  const absolute = resolve(path);
  if (!(await Bun.file(absolute).exists()))
    throw new Error(`file not found: ${path}`);
  return withMagika((identify) => identify(absolute));
}

/** Identify every regular file under `dir` (depth-first, at most `limit` files). */
export async function identifyTreeWithMagika(
  dir: string,
  limit = 500,
): Promise<MagikaTree> {
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
  const results = await withMagika(async (identify) => {
    const out: MagikaPrediction[] = [];
    for (const path of paths) out.push(await identify(path));
    return out;
  });
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
