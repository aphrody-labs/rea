import { parseIeFormatArgs, runIeFormatCommand } from "./ie.js";

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const output = await runIeFormatCommand(parseIeFormatArgs(args));
    process.stdout.write(output);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exit(await main());
