import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameWorker, listEntries } from "../../src/game/native.js";

const dir = await mkdtemp(join(tmpdir(), "rea-list-process-"));
const previousCwd = process.cwd();
const previousBinary = process.env.BUNRE_BIN;

beforeAll(async () => {
  await writeFile(
    join(dir, "game"),
    `
    const mode = process.argv[3];
    if (process.argv[2] === "worker") {
      await Bun.write(mode, String(process.pid));
      console.log(JSON.stringify({id:0,ok:false,len:0}));
      setInterval(() => {}, 1000);
    } else if (mode === "noisy") {
      await Bun.write(Bun.stderr, "e".repeat(1024 * 1024));
      console.log(JSON.stringify({path:"a",size:1,container:"loose",kind:"binary",format:"bin"}));
    } else {
      await Bun.write(mode, String(process.pid));
      console.log(JSON.stringify({path:"a",size:1,container:"loose",kind:"binary",format:"bin"}));
      setInterval(() => {}, 1000);
    }
  `,
  );
  process.chdir(dir);
  process.env.BUNRE_BIN = process.execPath;
}, 30000);

afterAll(async () => {
  process.chdir(previousCwd);
  if (previousBinary === undefined) delete process.env.BUNRE_BIN;
  else process.env.BUNRE_BIN = previousBinary;
  await rm(dir, { recursive: true, force: true });
}, 30000);

test("drains stderr while streaming the listing", async () => {
  const entries = [];
  for await (const entry of listEntries("noisy", {}, 0)) entries.push(entry);
  expect(entries.map((entry) => entry.path)).toEqual(["a"]);
}, 10000);

test("stops the child when the caller stops the listing early", async () => {
  const pidFile = join(dir, "child.pid");
  for await (const _entry of listEntries(pidFile, {}, 0)) break;
  const pid = Number(await readFile(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
}, 10000);

test("stops the child after a failed worker handshake", async () => {
  const pidFile = join(dir, "worker.pid");
  await expect(GameWorker.start(pidFile, {})).rejects.toThrow("did not start");
  const pid = Number(await readFile(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
}, 10000);
