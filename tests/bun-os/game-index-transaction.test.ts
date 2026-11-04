import { afterAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "rea-index-transaction-"));
let fail = false;
mock.module("../../src/game/native.js", () => ({
  runJson: async () => ({ mounted: true }),
  listEntries: async function* () {
    yield {
      path: "A.bin",
      size: 1,
      container: "loose",
      kind: "binary",
      format: "bin",
    };
    if (fail) throw new Error("listing failed");
    yield {
      path: "a.bin",
      size: 2,
      container: "loose",
      kind: "other",
      format: "bin",
    };
  },
  GameWorker: class {},
}));
const { buildIndex } = await import("../../src/game/index.js");

afterAll(async () => {
  mock.restore();
  await rm(root, { recursive: true, force: true });
}, 30000);

describe("game index transaction", () => {
  test("rolls back an interrupted rebuild and preserves the previous index", async () => {
    const file = join(root, "existing.sqlite");
    const db = new Database(file);
    db.exec(
      "CREATE TABLE entries (path TEXT); INSERT INTO entries VALUES ('old-evidence');",
    );
    db.close(true);
    fail = true;
    await expect(buildIndex(root, file, {}, 0)).rejects.toThrow(
      "listing failed",
    );
    const read = new Database(file, { readonly: true });
    expect(read.query("SELECT path FROM entries").all()).toEqual([
      { path: "old-evidence" },
    ]);
    read.close(true);
  }, 30000);

  test("reports the rows actually indexed after case-insensitive collisions", async () => {
    fail = false;
    const file = join(root, "complete.sqlite");
    const result = await buildIndex(root, file, {}, 0);
    expect(result.entries).toBe(1);
    expect(result.kinds).toEqual({ binary: 1 });
    const read = new Database(file, { readonly: true });
    expect(read.query("SELECT path FROM entries").all()).toEqual([
      { path: "A.bin" },
    ]);
    expect(
      read
        .query(
          "SELECT count(*) AS n FROM entries_fts WHERE entries_fts MATCH 'A'",
        )
        .get(),
    ).toEqual({ n: 1 });
    read.close(true);
  }, 30000);
});
