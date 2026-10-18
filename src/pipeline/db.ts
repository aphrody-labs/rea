// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { PipelineReport } from "./contract.js";

/** Analysis database (bun:sqlite) recording every pipeline run, stage result and artifact. */
export function openAnalysisDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY, input TEXT NOT NULL, sha256 TEXT, target TEXT NOT NULL,
    summary TEXT NOT NULL, outdir TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS stages (
    run_id INTEGER NOT NULL REFERENCES runs(id), stage TEXT NOT NULL, adapter TEXT NOT NULL,
    status TEXT NOT NULL, detail TEXT NOT NULL, output TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS artifacts (
    run_id INTEGER NOT NULL REFERENCES runs(id), stage TEXT NOT NULL, kind TEXT NOT NULL,
    path TEXT NOT NULL, bytes INTEGER NOT NULL)`);
  return db;
}

export function recordRun(db: Database, report: PipelineReport): number {
  const acquire = report.stages.find((s) => s.stage === "acquire")?.output as {
    sha256?: string;
  } | null;
  const tx = db.transaction(() => {
    const { lastInsertRowid } = db
      .query(
        "INSERT INTO runs (input, sha256, target, summary, outdir) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        report.input,
        acquire?.sha256 ?? null,
        report.target,
        report.summary,
        report.outdir,
      );
    const id = Number(lastInsertRowid);
    for (const s of report.stages) {
      db.query("INSERT INTO stages VALUES (?, ?, ?, ?, ?, ?)").run(
        id,
        s.stage,
        s.adapter,
        s.status,
        s.detail,
        s.output == null ? null : JSON.stringify(s.output),
      );
      for (const a of s.artifacts) {
        db.query("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?)").run(
          id,
          s.stage,
          a.kind,
          a.path,
          a.bytes,
        );
      }
    }
    return id;
  });
  return tx();
}

export const defaultDbPath = (outdir: string): string =>
  join(outdir, "analysis.db");
