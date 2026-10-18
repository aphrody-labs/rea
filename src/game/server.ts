// SPDX-License-Identifier: Apache-2.0
// `re game serve`: the HTTP API of `aphrody-nie-model-serve`, game-agnostic. Listings come from
// the `bun:sqlite` index; bytes and conversions from one long-lived `bunre game worker`.
//
//   GET /health                                   ok
//   GET /vfs/ls?path=&limit=&offset=              folder view (dirs + paginated files)
//   GET /vfs/find?q=&ext=&limit=&offset=          FTS5 search over paths
//   GET /vfs/stat?path=                           metadata + export formats
//   GET /vfs/stats                                counts per kind and container
//   GET /raw/<path>                               original bytes (bearer token)
//   GET /export/<path>?format=raw|png|wav|glb|json|mp4|webm   (raw needs the token)
//   GET /tex/<path>.png  /audio/<path>.wav  /model/<path>.glb  /table/<path>.json
//
// The game's own bytes (`/raw`, `/export?format=raw`) answer only to
// `Authorization: Bearer $RE_GAME_RAW_TOKEN` (32+ characters) and otherwise 404, like the NIE
// server's NIE_RAW_VFS_TOKEN rule. Derived formats are public on the bound interface, which
// defaults to 127.0.0.1.
import { timingSafeEqual } from "node:crypto";
import { GameIndex } from "./index.js";
import { GameWorker, type NativeOptions } from "./native.js";

const TOKEN_ENV = "RE_GAME_RAW_TOKEN";

export interface ServeOptions extends NativeOptions {
  root: string;
  db: string;
  port: number;
  hostname: string;
}

function rawAllowed(request: Request): boolean {
  const token = process.env[TOKEN_ENV]?.trim() ?? "";
  if (token.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const [scheme, value] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });

const ALIASES: Record<string, [string, string]> = {
  "/tex/": [".png", "png"],
  "/audio/": [".wav", "wav"],
  "/model/": [".glb", "glb"],
  "/table/": [".json", "json"],
};

const int = (v: string | null, d: number, max: number) =>
  Math.min(Math.max(Number.parseInt(v ?? "", 10) || d, 0), max);

async function vfsRoute(
  index: GameIndex,
  worker: GameWorker,
  path: string,
  q: URLSearchParams,
) {
  switch (path) {
    case "/vfs/ls":
      return json(
        index.ls(
          q.get("path") ?? "",
          int(q.get("limit"), 1000, 20_000),
          int(q.get("offset"), 0, 1e9),
        ),
      );
    case "/vfs/find":
      return json(
        index.find(
          q.get("q") ?? "",
          q.get("ext") || null,
          int(q.get("limit"), 200, 20_000),
          int(q.get("offset"), 0, 1e9),
        ),
      );
    case "/vfs/stats":
      return json(index.stats());
    case "/vfs/stat": {
      const entry = index.stat(q.get("path") ?? "");
      if (!entry) return text("path not in the index", 404);
      const formats = await worker.request("formats", entry.path);
      return json({
        ...entry,
        readable: formats.ok,
        formats: formats.ok
          ? JSON.parse(new TextDecoder().decode(formats.bytes))
          : [],
      });
    }
    default:
      return text("unknown /vfs route", 404);
  }
}

export async function serve(opts: ServeOptions) {
  const index = new GameIndex(opts.db);
  const worker = await GameWorker.start(opts.root, opts);

  async function exported(path: string, format: string, request: Request) {
    if (path.includes("..")) return text("invalid path", 400);
    if (format === "raw" && !rawAllowed(request)) return text("not found", 404);
    const formats = await worker.request("formats", path);
    if (!formats.ok) return text(formats.error ?? "not found", 404);
    const offered = JSON.parse(new TextDecoder().decode(formats.bytes)) as {
      id: string;
    }[];
    if (!offered.some((f) => f.id === format))
      return text(
        `format "${format}" unavailable for this file (offered: ${offered.map((f) => f.id).join(", ")})`,
        400,
      );
    const reply = await worker.request("convert", path, format);
    if (!reply.ok) return text(`conversion failed: ${reply.error}`, 500);
    const name = `${path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "")}.${reply.ext}`;
    return new Response(reply.bytes, {
      headers: {
        "content-type": reply.mime,
        "content-disposition": `inline; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"`,
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=3600",
      },
    });
  }

  async function raw(path: string, request: Request) {
    if (!rawAllowed(request)) return text("not found", 404);
    const reply = await worker.request("read", path);
    if (!reply.ok) return text(reply.error ?? "not found", 404);
    return new Response(reply.bytes, {
      headers: { "content-type": "application/octet-stream" },
    });
  }

  function route(request: Request) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);
    const q = url.searchParams;
    if (request.method !== "GET" && request.method !== "HEAD")
      return text("GET, HEAD only", 405);
    if (path === "/health") return text("ok", 200);
    if (path.startsWith("/vfs/")) return vfsRoute(index, worker, path, q);
    if (path.startsWith("/raw/")) return raw(path.slice(5), request);
    if (path.startsWith("/export/"))
      return exported(path.slice(8), q.get("format") ?? "raw", request);
    for (const [prefix, [suffix, format]] of Object.entries(ALIASES)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const source = rest.endsWith(suffix)
        ? rest.slice(0, -suffix.length)
        : rest;
      return exported(source, format, request);
    }
    return text("not found", 404);
  }

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.hostname,
    fetch: route,
  });
  return { server, worker, index };
}
