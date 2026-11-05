import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./atomicWrite.js";

describe("writeFileAtomic", () => {
  test("creates, replaces and leaves no temp file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rea-atomic-"));
    try {
      const target = join(dir, "config.json");
      await writeFileAtomic(target, "first", { encoding: "utf8" });
      expect(await readFile(target, "utf8")).toBe("first");
      await writeFile(target, "old");
      await writeFileAtomic(target, new TextEncoder().encode("second"));
      expect(await readFile(target, "utf8")).toBe("second");
      expect(await readdir(dir)).toEqual(["config.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")("applies mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rea-atomic-"));
    try {
      const target = join(dir, "secret");
      await writeFileAtomic(target, "x", { mode: 0o600 });
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")("keeps an existing file's mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rea-atomic-"));
    try {
      const target = join(dir, "script.sh");
      await writeFile(target, "old", { mode: 0o750 });
      await chmod(target, 0o750);
      await writeFileAtomic(target, "new");
      expect((await stat(target)).mode & 0o777).toBe(0o750);
      expect(await readFile(target, "utf8")).toBe("new");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing directory rejects without leaving files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rea-atomic-"));
    try {
      await expect(writeFileAtomic(join(dir, "nope", "f"), "x")).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
