#!/usr/bin/env bun
import { getGameBananaMod, searchGameBanana } from "./client.js";

function option(args: string[], name: string, fallback: number): number {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = Number(args[at + 1]);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} requires an integer value`);
  args.splice(at, 2);
  return value;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const [command, ...rest] = args;
    if (command === "search") {
      const page = option(rest, "--page", 1);
      const perPage = option(rest, "--limit", 20);
      const gameId = option(rest, "--game-id", 0);
      const query = rest.join(" ").trim();
      if (!query) throw new Error("usage: bun run re gamebanana search <query> [--page N] [--limit N]");
      console.log(JSON.stringify(await searchGameBanana(query, { page, perPage, ...(gameId ? { gameId } : {}) }), null, 2));
      return 0;
    }
    if (command === "mod") {
      const id = Number(rest[0]);
      if (!Number.isSafeInteger(id)) throw new Error("usage: bun run re gamebanana mod <mod-id>");
      console.log(JSON.stringify(await getGameBananaMod(id), null, 2));
      return 0;
    }
    throw new Error("usage: bun run re gamebanana <search <query> | mod <id>>");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exit(await main());
