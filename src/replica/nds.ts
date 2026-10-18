import { basename, join, resolve } from "node:path";
import { checkoutRoot } from "../pipeline/runner.js";

const root = checkoutRoot();
const logoPrefix = Uint8Array.from([
  0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a,
]);

function text(bytes: Uint8Array): string {
  return new TextDecoder("ascii").decode(bytes).replaceAll("\0", "").trim();
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}

async function sha256(path: string): Promise<string> {
  const digest = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) digest.update(chunk);
  return digest.digest("hex");
}

export interface NdsReplicaReport {
  input: { name: string; path: string; bytes: number; sha256: string };
  cartridge: {
    title: string;
    gameCode: string;
    makerCode: string;
    arm9: {
      romOffset: number;
      entry: number;
      ramAddress: number;
      bytes: number;
    };
    arm7: {
      romOffset: number;
      entry: number;
      ramAddress: number;
      bytes: number;
    };
  };
  owners: {
    dust: { source: string; sourceReady: boolean; executableReady: boolean };
    ghidra: {
      source: string;
      ntrExtension: string;
      sourceReady: boolean;
      executableReady: boolean;
    };
    libnds: { source: string; sourceReady: boolean; toolchainReady: boolean };
    bunRe: { owner: string; ready: boolean };
  };
  outputs: { windows: string; web: string; recon: string };
}

/** Read-only intake for a user-owned DS image. The ROM is never copied into the workspace. */
export async function inspectNdsReplica(
  input: string,
): Promise<NdsReplicaReport> {
  const path = resolve(input);
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw new Error(`Nintendo DS image not found: ${path}`);
  if (file.size < 0x200)
    throw new Error(`Nintendo DS image is smaller than its header: ${path}`);
  const header = new Uint8Array(await file.slice(0, 0x200).arrayBuffer());
  if (!logoPrefix.every((byte, index) => header[0xc0 + index] === byte)) {
    throw new TypeError(`Nintendo DS logo signature is missing: ${path}`);
  }

  const dust = join(root, "crates", "aphrody-dust-core");
  const ghidra = join(root, "crates", "ghidra");
  const ntr = join(root, "crates", "ntr-ghidra");
  const libnds = join(root, "crates", "libnds");
  const executable = (offset: number) => ({
    romOffset: u32(header, offset),
    entry: u32(header, offset + 4),
    ramAddress: u32(header, offset + 8),
    bytes: u32(header, offset + 12),
  });

  return {
    input: {
      name: basename(path),
      path,
      bytes: file.size,
      sha256: await sha256(path),
    },
    cartridge: {
      title: text(header.subarray(0, 12)),
      gameCode: text(header.subarray(12, 16)),
      makerCode: text(header.subarray(16, 18)),
      arm9: executable(0x20),
      arm7: executable(0x30),
    },
    owners: {
      dust: {
        source: dust,
        sourceReady: await Bun.file(join(dust, "Cargo.toml")).exists(),
        executableReady: await Bun.file(
          join(root, "build", "nds", "dust-cli.exe"),
        ).exists(),
      },
      ghidra: {
        source: ghidra,
        ntrExtension: ntr,
        sourceReady:
          (await Bun.file(join(ghidra, "build.gradle")).exists()) &&
          (await Bun.file(join(ntr, "Module.manifest")).exists()),
        executableReady:
          Bun.which("java") !== null &&
          (await Bun.file(
            join(root, "build", "ghidra", "support", "analyzeHeadless.bat"),
          ).exists()),
      },
      libnds: {
        source: libnds,
        sourceReady: await Bun.file(join(libnds, "include", "nds.h")).exists(),
        toolchainReady:
          Bun.which("arm-none-eabi-gcc") !== null &&
          Bun.which("ndstool") !== null,
      },
      // The NDS crate was absorbed into bun-engine (`bun-engine info`, cartridge module).
      bunRe: {
        owner: join(root, "crates", "bun-engine-core", "src", "cartridge.rs"),
        ready: await Bun.file(
          join(root, "crates", "bun-engine-core", "src", "cartridge.rs"),
        ).exists(),
      },
    },
    outputs: {
      windows: join(
        root,
        "build",
        "replica",
        "windows",
        "bun-engine-replica.exe",
      ),
      web: join(root, "build", "replica", "web"),
      recon: join(root, "var", "replica", "testt.nds.json"),
    },
  };
}
