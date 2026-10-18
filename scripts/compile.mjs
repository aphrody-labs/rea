import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Transpile src/**/*.ts into dist/**/*.js one-to-one with Bun's native
// transpiler. Type checking belongs to `bun check`.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const transpiler = new Bun.Transpiler({
  loader: "ts",
  target: "bun",
  trimUnusedImports: false,
});
const glob = new Bun.Glob("**/*.ts");
const sources = [];
for await (const path of glob.scan({ cwd: join(root, "src") })) {
  if (/\.(test|fixture)\.ts$/u.test(path) || path.endsWith(".d.ts")) continue;
  sources.push(path);
}
await Promise.all(
  sources.map(async (path) => {
    const code = await readFile(join(root, "src", path), "utf8");
    const out = join(root, "dist", path.replace(/\.ts$/u, ".js"));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, transpiler.transformSync(code));
  }),
);
console.log(
  `Compiled ${sources.length} modules into ${relative(root, join(root, "dist"))}`,
);
