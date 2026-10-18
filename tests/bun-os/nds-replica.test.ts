import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectNdsReplica } from "../../src/replica/nds.js";

test("replica intake identifies both DS executables without copying the ROM", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bun-engine-nds-"));
  const path = join(directory, "fixture.nds");
  const bytes = new Uint8Array(0x4000);
  bytes.set(new TextEncoder().encode("REPLICA TEST"), 0);
  bytes.set(new TextEncoder().encode("RPL1"), 12);
  bytes.set(new TextEncoder().encode("01"), 16);
  bytes.set(
    [
      0x00, 0x02, 0x00, 0x00, 0x00, 0x40, 0x00, 0x02, 0x00, 0x40, 0x00, 0x02,
      0x00, 0x01, 0x00, 0x00,
    ],
    0x20,
  );
  bytes.set(
    [
      0x00, 0x03, 0x00, 0x00, 0x00, 0x80, 0x00, 0x03, 0x00, 0x80, 0x00, 0x03,
      0x80, 0x00, 0x00, 0x00,
    ],
    0x30,
  );
  bytes.set(
    [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a],
    0xc0,
  );
  await writeFile(path, bytes);
  try {
    const report = await inspectNdsReplica(path);
    expect(report.cartridge).toMatchObject({
      title: "REPLICA TEST",
      gameCode: "RPL1",
      makerCode: "01",
      arm9: {
        romOffset: 0x200,
        entry: 0x02004000,
        ramAddress: 0x02004000,
        bytes: 0x100,
      },
      arm7: {
        romOffset: 0x300,
        entry: 0x03008000,
        ramAddress: 0x03008000,
        bytes: 0x80,
      },
    });
    expect(report.input.sha256).toHaveLength(64);
    expect(report.owners.dust.sourceReady).toBe(true);
    expect(report.owners.dust.executableReady).toBe(false);
    expect(report.owners.bunRe.ready).toBe(true);
    expect(await Bun.file(report.outputs.recon).exists()).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
