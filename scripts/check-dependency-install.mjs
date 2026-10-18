import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REMEDIATION = "Run `bun install`, then retry.";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const directDependencies = (rootPackage) => ({
  ...rootPackage.dependencies,
  ...rootPackage.devDependencies,
});

/** Compare the root manifest's direct dependencies with node_modules. */
export const dependencyInstallProblems = (rootPackage, installedVersions) =>
  Object.entries(directDependencies(rootPackage))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, range]) => {
      const actual = installedVersions[name];
      if (actual === undefined)
        return [`${name}: missing from the installed dependencies`];
      if (/^(?:workspace|npm|file|link|git|https?):/u.test(range)) return [];
      return Bun.semver.satisfies(actual, range)
        ? []
        : [`${name}: installed ${actual}, expected ${range}`];
    });

const installedVersion = async (root, name) => {
  try {
    const manifest = Bun.resolveSync(`${name}/package.json`, root);
    return (await readJson(manifest)).version;
  } catch {
    return undefined;
  }
};

const main = async () => {
  const root = process.cwd();
  try {
    const rootPackage = await readJson(resolve(root, "package.json"));
    const installedVersions = Object.fromEntries(
      await Promise.all(
        Object.keys(directDependencies(rootPackage)).map(async (name) => [
          name,
          await installedVersion(root, name),
        ]),
      ),
    );
    const problems = dependencyInstallProblems(rootPackage, installedVersions);
    if (problems.length === 0) return;
    process.stderr.write(
      `Direct dependency installation is stale:\n${problems.map((problem) => `- ${problem}`).join("\n")}\n${REMEDIATION}\n`,
    );
    process.exitCode = 1;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "unreadable package manifest";
    process.stderr.write(
      `Could not verify the installed direct dependencies: ${reason}\n${REMEDIATION}\n`,
    );
    process.exitCode = 1;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
