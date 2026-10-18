// SPDX-License-Identifier: Apache-2.0
/** `re steam-rea`: the RE pipeline over the executable of an app indexed by `bun-steam scan`. */
import { mkdirSync } from "node:fs";
import { type CommonOptions, withDb } from "@aphrody/bun-steam";
import { statePath } from "@aphrody/paths";
import { runPipeline } from "./pipeline/runner.js";

/** Runs the RE pipeline (`bunre pipeline`) on the executable of an installed app. */
export async function opRea(o: CommonOptions, appid: number, outdir?: string) {
  const row = withDb(
    o.db,
    (db) =>
      db.query("SELECT name, exe_path FROM app WHERE appid = ?").get(appid) as {
        name: string;
        exe_path: string | null;
      } | null,
  );
  if (!row?.exe_path)
    throw new Error(`app ${appid}: no scanned executable (run scan first)`);
  const out = outdir ?? statePath("re", "steam", String(appid));
  mkdirSync(out, { recursive: true });
  const report = await runPipeline(row.exe_path, {
    target: "os",
    outdir: out,
    trace: false,
  });
  return { appid, name: row.name, exe: row.exe_path, outdir: out, report };
}

/** Entry point for `re steam-rea <appid> [--db path] [--out dir]`. */
export async function main(argv: string[]): Promise<number> {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const appid = Number(argv.find((a) => /^\d+$/.test(a)));
  if (!Number.isInteger(appid)) {
    console.error("usage: re steam-rea <appid> [--db path] [--out dir]");
    return 2;
  }
  try {
    console.log(
      JSON.stringify(
        await opRea({ db: flag("--db") }, appid, flag("--out")),
        null,
        2,
      ),
    );
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
