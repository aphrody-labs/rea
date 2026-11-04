#!/usr/bin/env bun
import { resolve } from "node:path";

function bunreCandidates(): string[] {
  const executable = process.platform === "win32" ? "bunre.exe" : "bunre";
  return [
    process.env.BUNRE_BIN,
    ...(process.env.CARGO_TARGET_DIR ? [resolve(process.env.CARGO_TARGET_DIR, "debug", executable)] : []),
    resolve(import.meta.dir, "../../../target/debug", executable),
    executable,
  ].filter((value): value is string => Boolean(value));
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log("usage: bun run re steam <scan [--appid <id>] | map <appid> [--out <json-file>] [--cpk-index]>");
    return 0;
  }
  const failures: string[] = [];
  for (const binary of bunreCandidates()) {
    try {
      const child = Bun.spawn([binary, "steam", ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (stdout) process.stdout.write(stdout);
      if (status === 0) return 0;
      failures.push(stderr.trim() || `${binary} exited with status ${status}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  console.error(`bunre steam failed: ${failures.join("; ") || "no bunre binary found"}`);
  return 1;
}

if (import.meta.main) process.exit(await main());
