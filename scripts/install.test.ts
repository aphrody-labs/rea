import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./install.js";

const root = await mkdtemp(join(tmpdir(), "rea-skills-install-"));
afterAll(() => rm(root, { recursive: true, force: true }));

test("help never inspects sources or changes an agent home", async () => {
  const home = join(root, "help-home");
  await mkdir(home);
  let text = "";
  expect(
    await main(["--help"], {
      home,
      packageRoot: join(root, "missing-source"),
      output: (value) => {
        text = value;
      },
    }),
  ).toBe(0);
  expect(text).toContain("--dry-run");
  expect(await readdir(home)).toEqual([]);
});

test("planning is read-only and explicit Codex apply writes only bundled skills", async () => {
  const home = join(root, "apply-home");
  const packageRoot = join(root, "package");
  const source = join(packageRoot, "plugin", "skills", "owned-skill");
  await mkdir(source, { recursive: true });
  await mkdir(join(home, ".codex"), { recursive: true });
  await Bun.write(join(source, "SKILL.md"), "# Owner skill\n");
  const config = join(home, ".codex", "config.toml");
  await Bun.write(config, "# existing configuration\n");
  const context = { home, packageRoot, output: () => {} };
  await main(["--codex"], context);
  expect(await readdir(join(home, ".codex"))).toEqual(["config.toml"]);
  await expect(main(["--apply", "--codex"], context)).rejects.toThrow(
    "--skills-only",
  );
  await main(["--apply", "--skills-only", "--codex"], context);
  expect(
    await Bun.file(
      join(home, ".codex", "skills", "owned-skill", "SKILL.md"),
    ).text(),
  ).toBe("# Owner skill\n");
  expect(await Bun.file(config).text()).toBe("# existing configuration\n");
  expect(await readdir(home)).toEqual([".codex"]);
  await expect(main(["--mcp"], context)).rejects.toThrow(
    "Unknown install option",
  );
  await mkdir(join(packageRoot, "plugin", "skills", "retained-skill"));
  await Bun.write(
    join(packageRoot, "plugin", "skills", "retained-skill", "SKILL.md"),
    "# source\n",
  );
  const retained = join(home, ".codex", "skills", "retained-skill");
  await Bun.write(retained, "existing user-owned file\n");
  await main(["--apply", "--skills-only", "--codex"], context);
  expect(await Bun.file(retained).text()).toBe("existing user-owned file\n");
});
