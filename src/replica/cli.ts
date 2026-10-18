// `re replica`, `re ghidra-win` and `re magika`: the Bun OS RE commands formerly hosted by bun-engine.
// Every command prints JSON; `--json` is accepted everywhere for a uniform `re` surface.
import { stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkoutRoot } from "../pipeline/runner.js";
import {
  buildGhidraWindows,
  inspectPeForGhidra,
  probeGhidraWindows,
} from "../ghidra/windows.js";
import {
  identifyTreeWithMagika,
  identifyWithMagika,
  setupMagika,
} from "../ml/magika.js";
import { initializeReplicaInput } from "./input.js";
import { inspectNdsReplica } from "./nds.js";
import { replicaPipeline } from "./pipeline.js";
import { recordReplay, replayReplay } from "./replay.js";
import { listReplicaSkills, readReplicaSkill } from "./skills.js";

const varReplica = join(checkoutRoot(), "var", "replica");

function print(value: unknown): number {
  console.log(
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
  return 0;
}

const REPLICA_USAGE = `usage: re replica skills | skill <name> | pipeline | nds <rom.nds> | init <rom.nds> [output]
       re replica record <system> <image> [--frames N] [--input key@first[-last],...] [--bios FILE] [--out replay.json]
       re replica replay <replay.json>`;

/** `re replica ...` */
export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      frames: { type: "string" },
      input: { type: "string" },
      bios: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const [command, input, output] = positionals;
  if (command === "skills") return print(await listReplicaSkills());
  if (command === "skill" && input) return print(await readReplicaSkill(input));
  if (command === "pipeline") return print(await replicaPipeline());
  if (command === "nds" && input) return print(await inspectNdsReplica(input));
  if (command === "init" && input)
    return print(
      await initializeReplicaInput(
        input,
        output ?? resolve(varReplica, basename(input, extname(input))),
      ),
    );
  if (command === "record" && input && output) {
    const { path, replay, seconds } = await recordReplay({
      system: input,
      image: output,
      frames: values.frames ? Number(values.frames) : undefined,
      input: values.input,
      bios: values.bios,
      out: values.out,
    });
    return print({
      replay: path,
      system: replay.system,
      image: replay.image,
      frames: replay.frames,
      input: replay.input,
      finalScreens: replay.frameDigests.at(-1) ?? null,
      seconds,
    });
  }
  if (command === "replay" && input) {
    const result = await replayReplay(input);
    print(result);
    return result.identical ? 0 : 1;
  }
  console.error(REPLICA_USAGE);
  return 2;
}

/** `re ghidra-win probe | inspect <pe> | build` */
export async function ghidraMain(argv: string[]): Promise<number> {
  const [command, input] = argv.filter((a) => a !== "--json");
  if (command === "probe") return print(await probeGhidraWindows());
  if (command === "inspect" && input)
    return print(await inspectPeForGhidra(input));
  if (command === "build") return buildGhidraWindows();
  console.error("usage: re ghidra-win probe | inspect <pe> | build");
  return 2;
}

/** `re magika setup | identify <file|dir> [--limit N]` */
export async function magikaMain(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      limit: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const [command, input] = positionals;
  if (command === "setup") return setupMagika();
  if (command === "identify" && input)
    return print(
      (await stat(input)).isDirectory()
        ? await identifyTreeWithMagika(
            input,
            values.limit ? Number(values.limit) : undefined,
          )
        : await identifyWithMagika(input),
    );
  console.error("usage: re magika setup | identify <file|dir> [--limit N]");
  return 2;
}
