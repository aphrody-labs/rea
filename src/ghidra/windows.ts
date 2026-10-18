import { dirname, join } from "node:path";
import windows from "bun:windows";
import { checkoutRoot } from "../pipeline/runner.js";

const root = checkoutRoot();
export const ghidraRoot = join(root, "vendor", "ghidra");
export const ntrGhidraRoot = join(root, "vendor", "ntr-ghidra");

function requireWindows(): void {
  if (!windows.isSupported)
    throw new Error("Ghidra Win32 integration requires Windows");
}

async function resolveJava(): Promise<string | null> {
  const pathJava = Bun.which("java");
  if (pathJava) return pathJava;
  if (process.env.JAVA_HOME) {
    const configured = join(process.env.JAVA_HOME, "bin", "java.exe");
    if (await Bun.file(configured).exists()) return configured;
  }
  const microsoft = "C:\\Program Files\\Microsoft";
  const candidates = Array.fromAsync(
    new Bun.Glob("jdk-*/bin/java.exe").scan({ cwd: microsoft, absolute: true }),
  );
  return (await candidates).sort().at(-1) ?? null;
}

async function probeGhidraInstall() {
  const dir = process.env.GHIDRA_INSTALL_DIR ?? null;
  const properties = dir
    ? Bun.file(join(dir, "Ghidra", "application.properties"))
    : null;
  const version =
    properties && (await properties.exists())
      ? (/application\.version=(.+)/
          .exec(await properties.text())?.[1]
          ?.trim() ?? null)
      : null;
  const javaHome = process.env.JAVA_HOME ?? null;
  const javaHomeValid = javaHome
    ? await Bun.file(join(javaHome, "bin", "java.exe")).exists()
    : false;
  const java = await resolveJava();
  return {
    dir,
    version,
    analyzeHeadless: dir
      ? await Bun.file(join(dir, "support", "analyzeHeadless.bat")).exists()
      : false,
    javaHome,
    javaHomeValid,
    remediation: javaHomeValid
      ? null
      : java
        ? `JAVA_HOME does not hold bin\\java.exe; run Ghidra consumers with JAVA_HOME=${dirname(dirname(java))}`
        : "install JDK 21 or newer and set JAVA_HOME",
  };
}

export async function probeGhidraWindows() {
  requireWindows();
  const toolchain = windows.toolchain();
  return {
    source: ghidraRoot,
    ntrExtension: ntrGhidraRoot,
    sourceReady: await Bun.file(join(ghidraRoot, "build.gradle")).exists(),
    ntrExtensionReady: await Bun.file(
      join(ntrGhidraRoot, "Module.manifest"),
    ).exists(),
    java: await resolveJava(),
    // The installed Ghidra used by `re pipeline --external` and the rea Ghidra provider; both
    // take Java from JAVA_HOME, so a stale JAVA_HOME disables them even with a JDK on PATH.
    install: await probeGhidraInstall(),
    windows: windows.version(),
    conpty: windows.conpty.info(),
    msvc: toolchain.msvc?.version ?? null,
    windowsSdk: toolchain.sdk?.version ?? null,
  };
}

export async function inspectPeForGhidra(path: string) {
  requireWindows();
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  if (!windows.pe.looksLikePe(bytes))
    throw new TypeError(`not a PE image: ${path}`);
  const image = windows.pe.parse(bytes, path);
  if (!image) throw new TypeError(`invalid PE image: ${path}`);
  return {
    path,
    kind: image.kind,
    machine: image.machine,
    sections: image.sections.length,
    imports: image.imports.reduce(
      (count, item) => count + item.functions.length,
      0,
    ),
    exports: image.exports.length,
    authenticode: image.authenticode,
  };
}

export async function buildGhidraWindows(): Promise<number> {
  requireWindows();
  const java = await resolveJava();
  if (!java) throw new Error("Ghidra build requires JDK 25 on PATH");
  const launcher = join(ghidraRoot, "gradlew.bat");
  if (!(await Bun.file(launcher).exists()))
    throw new Error(`missing Ghidra Gradle launcher: ${launcher}`);
  const job = new windows.Job({
    name: "BunEngine.GhidraBuild",
    killOnClose: true,
  });
  try {
    const env = {
      ...process.env,
      BUN_ENGINE_ROOT: root,
      JAVA: java,
      JAVA_HOME: dirname(dirname(java)),
    };
    const run = async (args: string[]) => {
      const child = job.spawn(
        ["cmd.exe", "/d", "/s", "/c", launcher, ...args],
        {
          cwd: ghidraRoot,
          env,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      return await child.exited;
    };
    const flatRepoReady =
      (
        await Array.fromAsync(
          new Bun.Glob("*").scan({
            cwd: join(ghidraRoot, "dependencies", "flatRepo"),
            onlyFiles: false,
          }),
        )
      ).length > 0;
    if (!flatRepoReady) {
      const fetched = await run([
        "-I",
        "gradle/support/fetchDependencies.gradle",
        "init",
      ]);
      if (fetched !== 0) return fetched;
    }
    return await run(["buildGhidra"]);
  } finally {
    job.close();
  }
}
