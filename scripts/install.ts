// SPDX-License-Identifier: Apache-2.0
/** `re install`: installs the RE plugin skills and registers the `re` MCP server for the local agent. */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const root = resolve(packageRoot, "../..");

/** Entry point for `re install`. Returns the process exit code. */
export async function main(_argv: string[]): Promise<number> {
  const skillsDir = join(homedir(), ".claude", "skills");
  const pluginSkills = join(packageRoot, "plugin", "skills");
  const sources: [string, string][] = readdirSync(pluginSkills, {
    withFileTypes: true,
  })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(pluginSkills, entry.name, "SKILL.md")),
    )
    .map((entry) => [entry.name, join(pluginSkills, entry.name)]);
  for (const [name, rel] of [
    ["steamcmd", "vendor/steam/steam-claude-skills/steamcmd"],
    ["steamos-maintenance", "vendor/steam/steamos-claude-skill"],
    ["idapython", "vendor/re/ida-pro-mcp/skills/idapython"],
  ] as const)
    if (existsSync(join(root, rel, "SKILL.md")))
      sources.push([name, join(root, rel)]);

  mkdirSync(skillsDir, { recursive: true });
  for (const [name, src] of sources) {
    const dest = join(skillsDir, name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
  }

  // The MCP runtime is served from the bundled build.
  if (!existsSync(join(packageRoot, "dist", "mcp", "main.js")))
    await Bun.$`bun run build`.cwd(packageRoot);
  await Bun.$`claude mcp remove -s user re`.quiet().nothrow();
  await Bun.$`claude mcp add -s user re -- bun ${join(packageRoot, "scripts", "rea.mjs")} mcp`.quiet();
  console.log(
    `skills: ${sources.map((source) => source[0]).join(", ")}\nmcp: re`,
  );
  return 0;
}
