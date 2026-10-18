// SPDX-License-Identifier: Apache-2.0
/** Installs explicitly selected REA skills. MCP registration belongs to Aphrody. */
import { cp, lstat, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface SkillInstallContext {
  home: string;
  packageRoot: string;
  output?: (text: string) => void;
}

async function preserveDestination(destination: string): Promise<boolean> {
  const existing = await lstat(destination).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    },
  );
  return (
    existing !== null && (!existing.isDirectory() || existing.isSymbolicLink())
  );
}

const help = `rea install — install this fork's skills without changing MCP configuration

Usage: rea install [--skills-only] [--codex] [--dry-run | --apply]

  --help          Show help without inspecting or changing user files
  --dry-run       Show the installation plan (default)
  --apply         Apply the explicitly selected skills-only installation
  --skills-only   Select REA's bundled skills; required with --apply
  --codex         Install into ~/.codex/skills (otherwise ~/.claude/skills)

No MCP server, provider, credential, global environment or agent configuration is changed.
`;

export async function main(
  argv: string[],
  context: SkillInstallContext = {
    home: homedir(),
    packageRoot: resolve(import.meta.dir, ".."),
  },
): Promise<number> {
  const output = context.output ?? console.log;
  if (argv.includes("--help") || argv.includes("-h")) {
    output(help);
    return 0;
  }
  const allowed = new Set(["--dry-run", "--apply", "--skills-only", "--codex"]);
  if (argv.some((arg) => !allowed.has(arg)))
    throw new Error("Unknown install option; use rea install --help");
  if (argv.includes("--dry-run") && argv.includes("--apply"))
    throw new Error("Choose --dry-run or --apply");
  const apply = argv.includes("--apply");
  if (apply && !argv.includes("--skills-only"))
    throw new Error("Installation requires --apply --skills-only");
  const sourceRoot = join(context.packageRoot, "plugin", "skills");
  const skillsDir = join(
    context.home,
    argv.includes("--codex") ? ".codex" : ".claude",
    "skills",
  );
  const sources = [];
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z0-9-]+$/.test(entry.name)) continue;
    const source = join(sourceRoot, entry.name);
    if (await Bun.file(join(source, "SKILL.md")).exists()) {
      const destination = join(skillsDir, entry.name);
      const action = (await preserveDestination(destination))
        ? "preserve"
        : "copy";
      sources.push({ name: entry.name, source, destination, action });
    }
  }
  sources.sort((a, b) => a.name.localeCompare(b.name));
  if (apply) {
    await mkdir(skillsDir, { recursive: true });
    for (const item of sources)
      if (item.action === "copy")
        await cp(item.source, item.destination, { recursive: true });
  }
  output(
    JSON.stringify(
      {
        status: apply ? "installed" : "planned",
        skills: sources,
        mcpChanged: false,
      },
      null,
      2,
    ),
  );
  return 0;
}
