// SPDX-License-Identifier: Apache-2.0
import type { TargetKind } from "./contract.js";
import { listAdapters, runPipeline } from "./runner.js";

/** Local JSON API: GET /adapters, POST /run {input, target, outdir}. Binds to loopback only. */
export function servePipeline(port = 0) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      try {
        if (req.method === "GET" && url.pathname === "/adapters")
          return Response.json(await listAdapters());
        if (req.method === "POST" && url.pathname === "/run") {
          const b = (await req.json()) as {
            input: string;
            target?: TargetKind;
            outdir: string;
          };
          return Response.json(
            await runPipeline(b.input, {
              target: b.target ?? "os",
              outdir: b.outdir,
            }),
          );
        }
        return new Response("not found", { status: 404 });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  });
}
