import { validateModManifest } from "./validateManifest.js";

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args[0] !== "validate" || !args[1] || args.length !== 2) {
    console.error("usage: bun run re mod validate <manifest.json>");
    return 2;
  }
  try {
    const result = await validateModManifest(args[1]);
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exit(await main());
