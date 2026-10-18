// SPDX-License-Identifier: Apache-2.0
// Native half of `re game`: target resolution through the Steam owner and the `bunre game`
// binary (one-shot commands and the framed worker used by `re game serve`).
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { installedGames } from "@aphrody/bun-steam";
import { findBinary, nativeBuildHint } from "../pipeline/runner.js";

/** Options forwarded to every `bunre game` command. */
export interface NativeOptions {
  profile?: string | undefined;
  only?: string[] | undefined;
  noLoose?: boolean | undefined;
  maxFiles?: number | undefined;
}

export interface ResolvedTarget {
  root: string;
  appId: number | null;
  name: string | null;
}

/** `<appid|path>`: an app id is looked up in the local Steam libraries (`@aphrody/bun-steam`). */
export function resolveTarget(target: string): ResolvedTarget {
  if (/^\d+$/.test(target)) {
    const appId = Number(target);
    const game = installedGames().find((g) => g.appId === appId);
    if (!game)
      throw new Error(
        `Steam app ${appId} is not installed in a local Steam library; pass its install path instead`,
      );
    return { root: game.installDir, appId, name: game.name };
  }
  const root = resolve(target);
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new Error(`${target}: not a directory`);
  return { root, appId: null, name: null };
}

export function nativeArgs(opts: NativeOptions): string[] {
  const out: string[] = [];
  if (opts.profile) out.push("--profile", opts.profile);
  for (const glob of opts.only ?? []) out.push("--only", glob);
  if (opts.noLoose) out.push("--no-loose");
  if (opts.maxFiles) out.push("--max-files", String(opts.maxFiles));
  return out;
}

async function bunre(): Promise<string> {
  try {
    return await findBinary();
  } catch {
    throw new Error(
      `bunre not found. Build it with \`${nativeBuildHint("bun-re", "bunre")} --features assets\`, or set BUNRE_BIN.`,
    );
  }
}

/** One `bunre game` invocation. */
export interface NativeCall {
  command: string;
  root: string;
  extra?: string[];
  opts: NativeOptions;
  timeoutMs?: number;
}

/** Run one `bunre game` command and parse its JSON stdout. */
export async function runJson<T>(call: NativeCall): Promise<T> {
  const proc = Bun.spawn(
    [
      await bunre(),
      "game",
      call.command,
      call.root,
      ...nativeArgs(call.opts),
      ...(call.extra ?? []),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), call.timeoutMs ?? 600_000);
  try {
    const [out, err, code] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    if (code !== 0)
      throw new Error(
        `bunre game ${call.command}: ${err.trim() || `exit ${code}`}`,
      );
    return JSON.parse(out) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Stream `bunre game ls` as parsed NDJSON entries. */
export async function* listEntries(
  root: string,
  opts: NativeOptions,
  sniffUnknown: number,
): AsyncGenerator<VfsEntry> {
  const proc = Bun.spawn(
    [
      await bunre(),
      "game",
      "ls",
      root,
      ...nativeArgs(opts),
      "--sniff-unknown",
      String(sniffUnknown),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of proc.stdout) {
    pending += decoder.decode(chunk, { stream: true });
    let at = pending.indexOf("\n");
    while (at >= 0) {
      const line = pending.slice(0, at);
      pending = pending.slice(at + 1);
      if (line.trim()) yield JSON.parse(line) as VfsEntry;
      at = pending.indexOf("\n");
    }
  }
  if (pending.trim()) yield JSON.parse(pending) as VfsEntry;
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(`bunre game ls: ${(await proc.stderr.text()).trim()}`);
}

export interface VfsEntry {
  path: string;
  size: number;
  container: string;
  kind: string;
  format: string;
  sniffed?: boolean;
}

export interface WorkerReply {
  ok: boolean;
  bytes: Uint8Array;
  mime: string;
  ext: string;
  error: string | null;
}

interface Header {
  id: number;
  ok: boolean;
  len: number;
  mime?: string;
  ext?: string;
  error?: string;
  ready?: boolean;
  entries?: number;
  profile?: string;
}

/**
 * Long-lived `bunre game worker`: the install is mounted once, then each request is one JSON
 * line and each reply one JSON header line followed by `len` raw bytes. Requests are serialized.
 */
export class GameWorker {
  #proc: ReturnType<typeof Bun.spawn> | null = null;
  #reader: {
    read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  } | null = null;
  #buffer = new Uint8Array(0);
  #queue: Promise<unknown> = Promise.resolve();
  #next = 1;
  entries = 0;
  profile = "";

  static async start(root: string, opts: NativeOptions): Promise<GameWorker> {
    const worker = new GameWorker();
    const proc = Bun.spawn(
      [await bunre(), "game", "worker", root, ...nativeArgs(opts)],
      { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
    );
    worker.#proc = proc;
    worker.#reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const ready = await worker.#header();
    if (!ready.ready) throw new Error("bunre game worker did not start");
    worker.entries = ready.entries ?? 0;
    worker.profile = ready.profile ?? "";
    return worker;
  }

  async #fill(min: number): Promise<void> {
    while (this.#buffer.length < min) {
      const chunk = await this.#reader?.read();
      if (!chunk || chunk.done || !chunk.value)
        throw new Error("bunre game worker exited");
      const merged = new Uint8Array(this.#buffer.length + chunk.value.length);
      merged.set(this.#buffer);
      merged.set(chunk.value, this.#buffer.length);
      this.#buffer = merged;
    }
  }

  async #header(): Promise<Header> {
    for (;;) {
      const at = this.#buffer.indexOf(10);
      if (at >= 0) {
        const line = new TextDecoder().decode(this.#buffer.subarray(0, at));
        this.#buffer = this.#buffer.slice(at + 1);
        return JSON.parse(line) as Header;
      }
      await this.#fill(this.#buffer.length + 1);
    }
  }

  async #take(len: number): Promise<Uint8Array> {
    await this.#fill(len);
    const out = this.#buffer.slice(0, len);
    this.#buffer = this.#buffer.slice(len);
    return out;
  }

  request(op: string, path = "", format?: string): Promise<WorkerReply> {
    const run = async (): Promise<WorkerReply> => {
      const id = this.#next++;
      const stdin = this.#proc?.stdin;
      if (!stdin || typeof stdin === "number")
        throw new Error("worker stdin unavailable");
      stdin.write(`${JSON.stringify({ id, op, path, format })}\n`);
      stdin.flush();
      const header = await this.#header();
      const bytes = await this.#take(header.len);
      return {
        ok: header.ok,
        bytes,
        mime: header.mime ?? "application/octet-stream",
        ext: header.ext ?? "",
        error: header.error ?? null,
      };
    };
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    const stdin = this.#proc?.stdin;
    if (stdin && typeof stdin !== "number") stdin.end();
    await this.#proc?.exited;
  }
}
