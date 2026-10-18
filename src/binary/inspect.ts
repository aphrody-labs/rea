// SPDX-License-Identifier: Apache-2.0
// `re bin`: static, read-only first pass over a native binary (emulator release in usr/, Steam
// client or game executable, Proton/Wine build on a remote host). Each fact comes from its owner:
// `bunre pipeline triage` (crates/re: format, hashes, sections with entropy, imports, libraries,
// exports, string sample), `bun:windows` PE parsing (imports per DLL, version resource,
// Authenticode, subsystem) and provenance from the bep release database (`usr/`) or the Steam
// libraries (`@aphrody/bun-steam`). Nothing is executed, patched or written beside the target.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import windows from "bun:windows";
import { installedGames, norm, resolveSteamRoot } from "@aphrody/bun-steam";
import { installedRelease, usrRoot } from "@aphrody/bun-engine/usr";
import { findBinary, spawnCaptured } from "../pipeline/runner.js";

/** Remote reads stay bounded: binaries only, never whole game installs. */
const MAX_REMOTE_BYTES = 256 * 1024 * 1024;

export interface BinaryInspectOptions {
  /** Strings kept in the sample (default 64, 0 disables extraction). */
  strings?: number | undefined;
  /** Functions listed per imported DLL (default 16; the count is always complete). */
  importsPerModule?: number | undefined;
  /** SSH host to read the file from (read-only `cat`), e.g. `vps`. */
  host?: string | undefined;
}

export interface BinaryReport {
  source: { host: string | null; path: string };
  triage: Record<string, unknown>;
  pe: Record<string, unknown> | null;
  provenance: Record<string, unknown>;
  seconds: number;
}

const bigints = (_: string, v: unknown) =>
  typeof v === "bigint" ? `0x${v.toString(16)}` : v;

/** `bunre pipeline triage`: the analyze-stage triage of crates/re, without lifting. */
async function triage(
  path: string,
  strings: number,
): Promise<Record<string, unknown>> {
  const { code, out, err } = await spawnCaptured(
    [
      await findBinary(),
      "pipeline",
      "triage",
      path,
      "--strings",
      String(strings),
    ],
    300_000,
  );
  if (code !== 0 || !out.trim())
    throw new Error(`bunre pipeline triage exited ${code}: ${err.trim()}`);
  return JSON.parse(out) as Record<string, unknown>;
}

function peFacts(
  bytes: Uint8Array,
  path: string,
  perModule: number,
): Record<string, unknown> | null {
  if (!windows.pe.looksLikePe(bytes)) return null;
  const image = windows.pe.parse(bytes, path);
  if (!image) return null;
  return JSON.parse(
    JSON.stringify(
      {
        kind: image.kind,
        machine: image.machine,
        bits: image.bits,
        subsystem: image.subsystem,
        timestamp: new Date(Number(image.timestamp) * 1000).toISOString(),
        imageBase: image.imageBase,
        entryRva: `0x${Number(image.entryRva).toString(16)}`,
        isDotnet: image.isDotnet,
        version: image.version,
        authenticode: image.authenticode,
        imports: image.imports.map((item) => ({
          module: item.module,
          delay: item.delay,
          count: item.functions.length,
          functions: item.functions.slice(0, perModule),
        })),
        exports: {
          name: image.exportName,
          count: image.exports.length,
        },
        warnings: image.warnings,
      },
      bigints,
    ),
  ) as Record<string, unknown>;
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** Who installed the file: a bep upstream release, a Steam app or the Steam client. */
async function provenance(path: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const lib = join(usrRoot(), "lib");
  if (inside(path, lib)) {
    const id = relative(lib, path).split(sep)[0]!;
    const release = await installedRelease(id);
    out.bep = release
      ? {
          id,
          version: release.version,
          url: release.url,
          asset: release.asset,
          assetSha256: release.sha256,
          installedAt: release.installedAt,
        }
      : { id, installed: false };
  }
  const file = norm(path).toLowerCase();
  const game = installedGames().find((g) =>
    file.startsWith(`${g.installDir.toLowerCase()}/`),
  );
  if (game)
    out.steam = {
      appId: game.appId,
      name: game.name,
      buildId: game.buildId,
      installDir: game.installDir,
    };
  else if (file.startsWith(`${norm(resolveSteamRoot()).toLowerCase()}/`))
    out.steam = { client: true, root: resolveSteamRoot() };
  return out;
}

/** Copy a remote file through `ssh <host> cat` into a private temporary directory. */
async function fetchRemote(
  host: string,
  path: string,
): Promise<{ local: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "re-bin-"));
  const local = join(dir, path.split("/").at(-1) || "binary");
  const quoted = `'${path.replaceAll("'", `'\\''`)}'`;
  const proc = Bun.spawn(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      host,
      `head -c ${MAX_REMOTE_BYTES + 1} -- ${quoted}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [bytes, err, code] = await Promise.all([
    proc.stdout.bytes(),
    proc.stderr.text(),
    proc.exited,
  ]);
  const cleanup = () => rm(dir, { recursive: true, force: true });
  if (code !== 0 || bytes.byteLength > MAX_REMOTE_BYTES) {
    await cleanup();
    throw new Error(
      code !== 0
        ? `ssh ${host}: exited ${code}: ${err.trim()}`
        : `${host}:${path} exceeds ${MAX_REMOTE_BYTES} bytes`,
    );
  }
  await Bun.write(local, bytes);
  return { local, cleanup };
}

/** Static first pass over one binary; see the module comment for the owners of each fact. */
export async function inspectBinary(
  path: string,
  o: BinaryInspectOptions = {},
): Promise<BinaryReport> {
  const started = performance.now();
  const remote = o.host ? await fetchRemote(o.host, path) : undefined;
  const local = remote?.local ?? resolve(path);
  try {
    const bytes = await Bun.file(local).bytes();
    const report: BinaryReport = {
      source: { host: o.host ?? null, path: o.host ? path : local },
      triage: await triage(local, o.strings ?? 64),
      pe: peFacts(bytes, local, o.importsPerModule ?? 16),
      provenance: o.host
        ? { remote: { host: o.host, path } }
        : await provenance(local),
      seconds: 0,
    };
    report.seconds = (performance.now() - started) / 1000;
    return report;
  } finally {
    await remote?.cleanup();
  }
}

const USAGE = `re bin <file> [--strings N] [--imports N] [--host SSH_HOST] [--json]

Static first pass over a PE or ELF binary: format, SHA-256, sections with entropy, imported
libraries and symbols, exports, PE version resource and Authenticode, a bounded string sample and
provenance (bep release in usr/, Steam app or client). --host reads a remote file read-only
through \`ssh HOST cat\` (bounded to 256 MiB) and deletes the local temporary copy.`;

/** Entry point of `re bin ...`. Returns the exit code. */
export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      strings: { type: "string" },
      imports: { type: "string" },
      host: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const file = positionals[0];
  if (!file || values.help) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const report = await inspectBinary(file, {
    strings: values.strings ? Number(values.strings) : undefined,
    importsPerModule: values.imports ? Number(values.imports) : undefined,
    host: values.host,
  });
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  const t = report.triage as {
    format: string;
    arch: string | null;
    size: number;
    sha256: string;
    libraries: string[];
    imports: string[];
    exports: string[];
    strings_sample: string[];
  };
  const pe = report.pe as {
    version?: { strings?: Record<string, string> };
    authenticode?: unknown;
  } | null;
  console.log(
    `${report.source.host ? `${report.source.host}:` : ""}${report.source.path}\n  ${t.format} ${t.arch ?? "?"} ${t.size} bytes sha256 ${t.sha256}`,
  );
  console.log(
    `  libraries (${t.libraries.length}): ${t.libraries.slice(0, 12).join(", ")}`,
  );
  console.log(`  imports ${t.imports.length}, exports ${t.exports.length}`);
  if (pe?.version?.strings)
    console.log(
      `  version: ${Object.entries(pe.version.strings)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")}`,
    );
  if (pe)
    console.log(`  authenticode: ${pe.authenticode ? "present" : "none"}`);
  console.log(`  provenance: ${JSON.stringify(report.provenance)}`);
  console.log(`  strings: ${t.strings_sample.slice(0, 8).join(" | ")}`);
  return 0;
}
