import { resolve } from "node:path";

function bunreCandidates(): string[] {
  const executable = process.platform === "win32" ? "bunre.exe" : "bunre";
  return [
    process.env.BUNRE_BIN,
    resolve(import.meta.dir, "../../../../target/debug", executable),
    ...(process.env.CARGO_TARGET_DIR ? [resolve(process.env.CARGO_TARGET_DIR, "debug", executable)] : []),
    executable,
  ].filter((value): value is string => Boolean(value));
}

export async function runIeFormatCommand(args: string[]): Promise<string> {
  const failures: string[] = [];
  for (const binary of bunreCandidates()) {
    try {
      const processHandle = Bun.spawn([binary, "formats", ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, status] = await Promise.all([
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
        processHandle.exited,
      ]);
      if (status === 0) return stdout;
      failures.push(stderr.trim() || `${binary} exited with status ${status}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`bunre formats failed: ${failures.join("; ") || "no bunre binary found"}`);
}

export function parseIeFormatArgs(args: string[]): string[] {
  const [command, input, member, output, ...extra] = args;
  if (extra.length || !command || !input) {
    throw new Error("usage: bun run re ie-format <inspect|cpk-list> <input> | cpk-extract <input> <member> <output> | cpk-extract-all <input> <output-dir> | cpk-pack <input-dir> <output.cpk> | cri-audio <input> <output.wav>");
  }
  if (command === "inspect" || command === "cpk-list") {
    if (member !== undefined || output !== undefined) throw new Error(`${command} accepts exactly one input file`);
    return [command, input];
  }
  if (command === "cpk-extract" && member && output) return [command, input, member, output];
  if (["cpk-extract-all", "cpk-pack", "cri-audio"].includes(command) && member && !output) return [command, input, member];
  throw new Error("usage: bun run re ie-format <inspect|cpk-list> <input> | cpk-extract <input> <member> <output> | cpk-extract-all <input> <output-dir> | cpk-pack <input-dir> <output.cpk> | cri-audio <input> <output.wav>");
}
