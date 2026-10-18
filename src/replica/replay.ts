// SPDX-License-Identifier: Apache-2.0
// `re replica record|replay`: deterministic input recordings of a Bun Engine machine. A recording
// pins the image (and BIOS) by SHA-256, the scripted pad input and the per-frame digest of every
// screen produced by `bun-engine run --input --trace`; a replay runs the same machine again and
// reports the first frame whose screens differ. Used for Replica parity, regression and
// determinism checks of the cores and of recompiled builds.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { runMachine } from "../engine/machine.js";
import { checkoutRoot } from "../pipeline/runner.js";

export interface ReplayFile {
  schema: 1;
  kind: "bun-engine-replay";
  system: string;
  image: { path: string; bytes: number; sha256: string };
  bios: { path: string; sha256: string } | null;
  frames: number;
  /** Scripted pad input, `key@first[-last],...`; empty for no input. */
  input: string;
  machine: string | null;
  createdAt: string;
  console: { bytes: number; sha256: string };
  /** One entry per frame: the FNV-1a 64 digests of its screens joined with `+`. */
  frameDigests: string[];
}

export interface ReplayResult {
  replay: string;
  identical: boolean;
  frames: { expected: number; actual: number };
  firstDivergence: { frame: number; expected: string; actual: string } | null;
  consoleIdentical: boolean;
  seconds: number;
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

async function traced(o: {
  system: string;
  image: string;
  frames: number;
  input: string;
  bios?: string | undefined;
}) {
  const dir = await mkdtemp(join(tmpdir(), "re-replay-"));
  try {
    const trace = join(dir, "trace.jsonl");
    const run = await runMachine({
      system: o.system,
      image: o.image,
      frames: o.frames,
      bios: o.bios,
      input: o.input || undefined,
      trace,
    });
    const digests = (await Bun.file(trace).text())
      .split("\n")
      .filter(Boolean)
      .map((line) =>
        (JSON.parse(line) as { screens: string[] }).screens.join("+"),
      );
    return { run, digests };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run a machine with scripted input and write its replay file. */
export async function recordReplay(o: {
  system: string;
  image: string;
  frames?: number | undefined;
  input?: string | undefined;
  bios?: string | undefined;
  out?: string | undefined;
}): Promise<{ path: string; replay: ReplayFile; seconds: number }> {
  const image = resolve(o.image);
  const frames = o.frames ?? 600;
  const { run, digests } = await traced({
    system: o.system,
    image,
    frames,
    input: o.input ?? "",
    bios: o.bios,
  });
  const consoleBytes = new TextEncoder().encode(run.console);
  const replay: ReplayFile = {
    schema: 1,
    kind: "bun-engine-replay",
    system: o.system,
    image: {
      path: image,
      bytes: Bun.file(image).size,
      sha256: await sha256(image),
    },
    bios: o.bios
      ? { path: resolve(o.bios), sha256: await sha256(resolve(o.bios)) }
      : null,
    frames: run.frames,
    input: o.input ?? "",
    machine: run.machine,
    createdAt: new Date().toISOString(),
    console: {
      bytes: consoleBytes.byteLength,
      sha256: new Bun.CryptoHasher("sha256").update(consoleBytes).digest("hex"),
    },
    frameDigests: digests,
  };
  const path = resolve(
    o.out ??
      join(
        checkoutRoot(),
        "var",
        "replica",
        "replays",
        `${basename(image, extname(image))}-${o.system}-${Date.now()}.json`,
      ),
  );
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(replay, null, 2)}\n`);
  return { path, replay, seconds: run.seconds };
}

/** Replay a recording on the same pinned image and compare it frame by frame. */
export async function replayReplay(file: string): Promise<ReplayResult> {
  const path = resolve(file);
  const replay = (await Bun.file(path).json()) as ReplayFile;
  if (replay.schema !== 1 || replay.kind !== "bun-engine-replay")
    throw new Error(`${path}: not a Bun Engine replay`);
  if ((await sha256(replay.image.path)) !== replay.image.sha256)
    throw new Error(`${replay.image.path}: image changed since the recording`);
  if (replay.bios && (await sha256(replay.bios.path)) !== replay.bios.sha256)
    throw new Error(`${replay.bios.path}: BIOS changed since the recording`);
  const { run, digests } = await traced({
    system: replay.system,
    image: replay.image.path,
    frames: replay.frames,
    input: replay.input,
    bios: replay.bios?.path,
  });
  const frame = replay.frameDigests.findIndex((d, i) => digests[i] !== d);
  const shorter =
    frame < 0 && digests.length !== replay.frameDigests.length
      ? Math.min(digests.length, replay.frameDigests.length)
      : -1;
  const at = frame >= 0 ? frame : shorter;
  const consoleSha = new Bun.CryptoHasher("sha256")
    .update(new TextEncoder().encode(run.console))
    .digest("hex");
  return {
    replay: path,
    identical: at < 0 && consoleSha === replay.console.sha256,
    frames: { expected: replay.frameDigests.length, actual: digests.length },
    firstDivergence:
      at < 0
        ? null
        : {
            frame: at,
            expected: replay.frameDigests[at] ?? "(none)",
            actual: digests[at] ?? "(none)",
          },
    consoleIdentical: consoleSha === replay.console.sha256,
    seconds: run.seconds,
  };
}
