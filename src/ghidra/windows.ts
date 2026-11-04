import { dirname, join } from "node:path";
import { checkoutRoot } from "../pipeline/runner.js";
import { inspectGhidraInstallation } from "./GhidraInstallation.js";

const root = checkoutRoot();
export const ghidraRoot = join(root, "vendor", "ghidra");
export const ntrGhidraRoot = join(root, "vendor", "ntr-ghidra");

const requireWindows = (): void => {
  if (process.platform !== "win32")
    throw new Error("Ghidra Windows build and PE inspection require Windows");
};

async function resolveJava(): Promise<string | null> {
  const pathJava = Bun.which("java");
  if (pathJava) return pathJava;
  if (process.env.JAVA_HOME) {
    const configured = join(process.env.JAVA_HOME, "bin", "java.exe");
    if (await Bun.file(configured).exists()) return configured;
  }
  const microsoft = "C:\\Program Files\\Microsoft";
  if (!(await Bun.file(microsoft).exists())) return null;
  const candidates = await Array.fromAsync(
    new Bun.Glob("jdk-*/bin/java.exe").scan({ cwd: microsoft, absolute: true }),
  );
  return candidates.sort().at(-1) ?? null;
}

export async function probeGhidraWindows() {
  const java = await resolveJava();
  const inspection = inspectGhidraInstallation({
    environment: process.env,
    ...(process.env.GHIDRA_INSTALL_DIR === undefined
      ? {}
      : { installDir: process.env.GHIDRA_INSTALL_DIR }),
    ...(process.env.JAVA_HOME === undefined
      ? {}
      : { javaHome: process.env.JAVA_HOME }),
  });
  return {
    source: ghidraRoot,
    sourceReady: await Bun.file(join(ghidraRoot, "build.gradle")).exists(),
    extensionSource: ntrGhidraRoot,
    extensionSourceReady: await Bun.file(join(ntrGhidraRoot, "Module.manifest")).exists(),
    java,
    install: inspection,
  };
}

/** Delegate PE parsing to the native yolo-re CLI, which owns the PE parser. */
export async function inspectPeForGhidra(path: string) {
  requireWindows();
  const executable = Bun.which("bunre") ?? join(root, "target", "debug", "bunre.exe");
  if (!(await Bun.file(executable).exists()))
    throw new Error("bunre is required for PE inspection; build yolo-re's native CLI first");
  const child = Bun.spawn([executable, "pipeline", "triage", path], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `bunre exited ${exitCode}`);
  return JSON.parse(stdout) as unknown;
}

/** Build official upstream Ghidra source with its own Gradle wrapper. */
export async function buildGhidraWindows(): Promise<number> {
  requireWindows();
  const java = await resolveJava();
  if (!java) throw new Error("Ghidra source build requires a JDK on PATH or JAVA_HOME");
  const launcher = join(ghidraRoot, "gradlew.bat");
  if (!(await Bun.file(launcher).exists()))
    throw new Error(`Ghidra source is not initialized; missing ${launcher}`);
  const env = {
    ...process.env,
    JAVA: java,
    JAVA_HOME: dirname(dirname(java)),
  };
  const run = async (args: string[]): Promise<number> => {
    const child = Bun.spawn(["cmd.exe", "/d", "/s", "/c", launcher, ...args], {
      cwd: ghidraRoot,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return child.exited;
  };
  const flatRepo = join(ghidraRoot, "dependencies", "flatRepo");
  const flatRepoReady =
    (await Array.fromAsync(
      new Bun.Glob("*").scan({ cwd: flatRepo, onlyFiles: false }),
    )).length > 0;
  if (!flatRepoReady) {
    const fetched = await run(["-I", "gradle/support/fetchDependencies.gradle", "init"]);
    if (fetched !== 0) return fetched;
  }
  return run(["buildGhidra"]);
}
