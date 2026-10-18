// SPDX-License-Identifier: Apache-2.0
// `re game index`: the mounted view of an install in `bun:sqlite` (entries, kinds, FTS5 over
// paths), with Magika labels for the files that neither the extension table nor the native
// magic sniffers recognise (bounded sample).
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identifyWithMagika } from "../ml/magika.js";
import {
  GameWorker,
  listEntries,
  type NativeOptions,
  runJson,
  type VfsEntry,
} from "./native.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE COLLATE NOCASE,
  dir TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  container TEXT NOT NULL,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  magika TEXT
);
CREATE INDEX IF NOT EXISTS entries_dir ON entries(dir);
CREATE INDEX IF NOT EXISTS entries_kind ON entries(kind);
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(path, content='entries', content_rowid='id');
`;

export interface IndexResult {
  db: string;
  entries: number;
  kinds: Record<string, number>;
  magika: { sampled: number; labelled: number; skipped: string | null };
  millis: { mount: number; insert: number; magika: number };
}

const dirOf = (path: string) => {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
};

/** Mount `root` natively and (re)build the SQLite index at `dbPath`. */
export async function buildIndex(
  root: string,
  dbPath: string,
  opts: NativeOptions,
  magikaSample = 32,
): Promise<IndexResult> {
  const begun = performance.now();
  const report = await runJson<Record<string, unknown>>({
    command: "mount",
    root,
    opts,
  });
  const mounted = performance.now();
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;");
  db.exec(
    "DROP TABLE IF EXISTS entries_fts; DROP TABLE IF EXISTS entries; DROP TABLE IF EXISTS meta;",
  );
  db.exec(SCHEMA);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO entries (path, dir, name, size, container, kind, format) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const kinds: Record<string, number> = {};
  let batch: VfsEntry[] = [];
  const flush = db.transaction((rows: VfsEntry[]) => {
    for (const e of rows) {
      insert.run(
        e.path,
        dirOf(e.path),
        e.path.slice(e.path.lastIndexOf("/") + 1),
        e.size,
        e.container,
        e.kind,
        e.format,
      );
    }
  });
  let total = 0;
  for await (const entry of listEntries(root, opts, 256)) {
    kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
    batch.push(entry);
    total++;
    if (batch.length >= 5000) {
      flush(batch);
      batch = [];
    }
  }
  flush(batch);
  db.exec("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')");
  const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  meta.run("root", root);
  meta.run("report", JSON.stringify(report));
  meta.run("indexedAt", new Date().toISOString());
  const inserted = performance.now();

  const magika = await labelUnknown(db, root, opts, magikaSample);
  db.close();
  return {
    db: dbPath,
    entries: total,
    kinds,
    magika,
    millis: {
      mount: Math.round(mounted - begun),
      insert: Math.round(inserted - mounted),
      magika: Math.round(performance.now() - inserted),
    },
  };
}

async function labelUnknown(
  db: Database,
  root: string,
  opts: NativeOptions,
  sample: number,
): Promise<IndexResult["magika"]> {
  const unknown = db
    .query<{ id: number; path: string }, [number]>(
      "SELECT id, path FROM entries WHERE kind = 'unknown' ORDER BY path LIMIT ?",
    )
    .all(sample);
  if (unknown.length === 0) return { sampled: 0, labelled: 0, skipped: null };
  const scratch = mkdtempSync(join(tmpdir(), "re-game-magika-"));
  const worker = await GameWorker.start(root, opts);
  const update = db.prepare("UPDATE entries SET magika = ? WHERE id = ?");
  let labelled = 0;
  let skipped: string | null = null;
  try {
    for (const row of unknown) {
      const head = await worker.request("head", row.path);
      if (!head.ok) continue;
      const file = join(scratch, `${row.id}.bin`);
      await Bun.write(file, head.bytes);
      try {
        const prediction = await identifyWithMagika(file);
        if (prediction.ok && prediction.prediction) {
          update.run(prediction.prediction.label, row.id);
          labelled++;
        }
      } catch (error) {
        skipped = error instanceof Error ? error.message : String(error);
        break;
      }
    }
  } finally {
    await worker.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  return { sampled: unknown.length, labelled, skipped };
}

/** Query helpers shared by the server. */
export class GameIndex {
  readonly db: Database;
  constructor(path: string) {
    this.db = new Database(path, { readonly: true });
  }
  meta(key: string): string | null {
    return (
      this.db
        .query<{ value: string }, [string]>(
          "SELECT value FROM meta WHERE key = ?",
        )
        .get(key)?.value ?? null
    );
  }
  stat(path: string): VfsEntry | null {
    return this.db
      .query<VfsEntry, [string]>(
        "SELECT path, size, container, kind, format FROM entries WHERE path = ?",
      )
      .get(path);
  }
  ls(dir: string, limit: number, offset: number) {
    const prefix = dir.replace(/^\/+|\/+$/g, "");
    const files = this.db
      .query<VfsEntry & { name: string }, [string, number, number]>(
        "SELECT name, path, size, container, kind, format FROM entries WHERE dir = ? ORDER BY name LIMIT ? OFFSET ?",
      )
      .all(prefix, limit, offset);
    const fileTotal =
      this.db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM entries WHERE dir = ?",
        )
        .get(prefix)?.n ?? 0;
    const cut = prefix ? prefix.length + 2 : 1;
    const dirs = this.db
      .query<{ name: string; count: number }, [number, string, number]>(
        `SELECT substr(rest, 1, instr(rest, '/') - 1) AS name, COUNT(*) AS count
         FROM (SELECT substr(path, ?1) AS rest FROM entries
               WHERE ?2 = '' OR substr(path, 1, ?3) = ?2 || '/')
         WHERE instr(rest, '/') > 0 GROUP BY name ORDER BY name`,
      )
      .all(cut, prefix, prefix.length + 1);
    return { dir: prefix, dirs, files, fileTotal, fileOffset: offset };
  }
  find(q: string, ext: string | null, limit: number, offset: number) {
    const terms = q
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replaceAll('"', '""')}"*`)
      .join(" ");
    const extClause = ext ? " AND e.format = ?" : "";
    const params: (string | number)[] = terms ? [terms] : [];
    if (ext) params.push(ext);
    const base = terms
      ? `FROM entries_fts f JOIN entries e ON e.id = f.rowid WHERE entries_fts MATCH ?${extClause}`
      : `FROM entries e WHERE 1=1${extClause}`;
    const total =
      this.db
        .query<{ n: number }, (string | number)[]>(
          `SELECT COUNT(*) AS n ${base}`,
        )
        .get(...params)?.n ?? 0;
    const files = this.db
      .query<VfsEntry & { name: string }, (string | number)[]>(
        `SELECT e.name, e.path, e.size, e.container, e.kind, e.format ${base} ORDER BY e.path LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return { query: q, count: files.length, total, offset, files };
  }
  stats() {
    const kinds = this.db
      .query<{ kind: string; n: number; bytes: number }, []>(
        "SELECT kind, COUNT(*) AS n, SUM(size) AS bytes FROM entries GROUP BY kind ORDER BY n DESC",
      )
      .all();
    const containers =
      this.db
        .query<{ n: number }, []>(
          "SELECT COUNT(DISTINCT container) AS n FROM entries",
        )
        .get()?.n ?? 0;
    const total =
      this.db
        .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM entries")
        .get()?.n ?? 0;
    const loose =
      this.db
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM entries WHERE container = 'loose'",
        )
        .get()?.n ?? 0;
    return { total, containerCount: containers, looseCount: loose, kinds };
  }
}
