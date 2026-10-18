import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initializeReplicaInput,
  inspectReplicaInput,
} from "../../src/replica/input.js";

function crc16(bytes: Uint8Array, initial = 0xffff): number {
  let crc = initial;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xa001 : 0);
  }
  return crc;
}

function syntheticRom(): Uint8Array {
  const bytes = new Uint8Array(0x800);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("ORIGINAL DEMO".slice(0, 12)), 0);
  bytes.set(new TextEncoder().encode("TEST"), 12);
  view.setUint32(0x20, 0x200, true);
  view.setUint32(0x2c, 0x100, true);
  view.setUint32(0x30, 0x300, true);
  view.setUint32(0x3c, 0x100, true);
  view.setUint32(0x80, bytes.length, true);
  view.setUint32(0x84, 0x200, true);
  // A synthetic CRC-colliding logo field, never proprietary Nintendo logo bytes.
  const prefixCrc = crc16(bytes.subarray(0xc0, 0x15a));
  for (let value = 0; value <= 0xffff; value++) {
    bytes[0x15a] = value & 0xff;
    bytes[0x15b] = value >>> 8;
    if (crc16(bytes.subarray(0x15a, 0x15c), prefixCrc) === 0xcf56) break;
  }
  view.setUint16(0x15c, 0xcf56, true);
  view.setUint16(0x15e, crc16(bytes.subarray(0, 0x15e)), true);
  return bytes;
}

async function withFixture(
  run: (root: string, source: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "bun-engine-replica-"));
  try {
    const source = join(root, "synthetic.nds");
    await Bun.write(source, syntheticRom());
    await run(root, source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("Replica Nintendo DS input provenance", () => {
  test("records bounded header metadata and the whole-file fingerprint without ROM bytes", async () => {
    await withFixture(async (_root, source) => {
      const evidence = await inspectReplicaInput(source);
      expect(evidence).toMatchObject({
        schema: 1,
        format: "nintendo-ds",
        size: 0x800,
        gameCode: "TEST",
        validation: { valid: true },
      });
      expect(evidence.sha256).toBe(
        new Bun.CryptoHasher("sha256").update(syntheticRom()).digest("hex"),
      );
      expect(evidence.sections[0]).toMatchObject({
        kind: "arm9",
        offset: 0x200,
        size: 0x100,
        withinFile: true,
      });
      expect(JSON.stringify(evidence)).not.toContain('"data"');
      expect(evidence.scope).toBe("header-and-fingerprint-only");
    });
  });

  test("rejects truncated input and reports corrupt header and logo checksums", async () => {
    await withFixture(async (_root, source) => {
      await Bun.write(source, new Uint8Array(0x100));
      await expect(inspectReplicaInput(source)).rejects.toThrow("truncated");
      const bytes = syntheticRom();
      bytes[0xc0] = (bytes[0xc0] ?? 0) ^ 1;
      await Bun.write(source, bytes);
      const evidence = await inspectReplicaInput(source);
      expect(evidence.validation.valid).toBeFalse();
      expect(evidence.validation.issues).toContain("header CRC16 mismatch");
      expect(evidence.validation.issues).toContain("logo CRC16 mismatch");
    });
  });

  test("checks section bounds without unsigned overflow and refuses invalid initialization", async () => {
    await withFixture(async (root, source) => {
      const bytes = syntheticRom();
      const view = new DataView(bytes.buffer);
      view.setUint32(0x20, 0xfffffff0, true);
      view.setUint32(0x2c, 0x100, true);
      view.setUint16(0x15e, crc16(bytes.subarray(0, 0x15e)), true);
      await Bun.write(source, bytes);
      const evidence = await inspectReplicaInput(source);
      expect(evidence.validation.headerCrc.valid).toBeTrue();
      expect(evidence.sections[0]?.withinFile).toBeFalse();
      const output = join(root, "replica");
      await expect(initializeReplicaInput(source, output)).rejects.toThrow(
        "arm9 section",
      );
      expect(await Bun.file(join(output, "input.json")).exists()).toBeFalse();
    });
  });

  test("initializes atomically, is idempotent and preserves concurrent recon artifacts", async () => {
    await withFixture(async (root, source) => {
      const output = join(root, "replica");
      await mkdir(output);
      await Bun.write(join(output, "recon.md"), "Observed independently\n");
      const first = await initializeReplicaInput(source, output);
      expect(first.created).toBeTrue();
      expect(await Bun.file(first.evidencePath).json()).toMatchObject({
        sha256: first.evidence.sha256,
      });
      expect(await Bun.file(first.statusPath).json()).toMatchObject({
        playable: false,
        state: "awaiting-observations",
      });
      const customStatus = '{"schema":1,"state":"observed"}\n';
      await Bun.write(first.statusPath, customStatus);
      const second = await initializeReplicaInput(source, output);
      expect(second.created).toBeFalse();
      expect(await Bun.file(second.statusPath).text()).toBe(customStatus);
      expect(await Bun.file(join(output, "recon.md")).text()).toBe(
        "Observed independently\n",
      );
      expect((await readdir(output)).sort()).toEqual([
        "input.json",
        "recon.md",
        "screens",
        "status.json",
      ]);
    });
  });

  test("does not overwrite a different fingerprint or an active initialization claim", async () => {
    await withFixture(async (root, source) => {
      const output = join(root, "replica");
      const first = await initializeReplicaInput(source, output);
      const originalManifest = await Bun.file(first.evidencePath).text();
      const bytes = syntheticRom();
      bytes[0x700] = 42;
      await Bun.write(source, bytes);
      await expect(initializeReplicaInput(source, output)).rejects.toThrow(
        "fingerprint",
      );
      expect(await Bun.file(first.evidencePath).text()).toBe(originalManifest);
      await mkdir(join(output, ".input-initialize.lock"));
      await expect(initializeReplicaInput(source, output)).rejects.toThrow(
        "already in progress",
      );
      expect(await Bun.file(first.evidencePath).text()).toBe(originalManifest);
    });
  });

  test("preserves an existing status artifact without provenance", async () => {
    await withFixture(async (root, source) => {
      const output = join(root, "replica");
      await mkdir(output);
      await Bun.write(join(output, "status.json"), '{"state":"concurrent"}\n');
      await expect(initializeReplicaInput(source, output)).rejects.toThrow(
        "no matching input.json",
      );
      expect(await Bun.file(join(output, "input.json")).exists()).toBeFalse();
      expect(await Bun.file(join(output, "status.json")).text()).toBe(
        '{"state":"concurrent"}\n',
      );
    });
  });
});
