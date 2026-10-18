// Forwards the Rust-owned `dbxv2` subcommand to the `bunre` binary so `re` stays the single
// reverse-engineering CLI. Steam depot operations belong to `bun-steam depot` (packages/bun-steam).
import { findBinary } from "./pipeline/runner.js";

export async function runBunre(args: string[]): Promise<number> {
  const bin = await findBinary();
  return Bun.spawn([bin, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
}

/** `re dbxv2 ...` */
export async function main(argv: string[]): Promise<number> {
  return runBunre(["dbxv2", ...argv]);
}
