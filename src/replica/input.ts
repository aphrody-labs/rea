import { link, mkdir, rm, rmdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const minimumHeaderBytes = 0x200;
const expectedLogoCrc = 0xcf56;

export interface ReplicaRomSection {
  kind:
    | "arm9"
    | "arm7"
    | "file-names"
    | "file-allocation"
    | "arm9-overlays"
    | "arm7-overlays";
  offset: number;
  size: number;
  withinFile: boolean;
}

export interface ReplicaInputEvidence {
  schema: 1;
  selectedPath: string;
  absolutePath: string;
  size: number;
  sha256: string;
  format: "nintendo-ds";
  headerTitle: string;
  gameCode: string;
  unitCode: number;
  declaredRomSize: number;
  declaredHeaderSize: number;
  sections: ReplicaRomSection[];
  validation: {
    valid: boolean;
    issues: string[];
    headerCrc: { stored: number; computed: number; valid: boolean };
    logoCrc: {
      stored: number;
      computed: number;
      expected: number;
      valid: boolean;
    };
  };
  scope: "header-and-fingerprint-only";
}

export interface ReplicaInputInitialization {
  evidence: ReplicaInputEvidence;
  evidencePath: string;
  statusPath: string;
  screensPath: string;
  created: boolean;
}

function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xa001 : 0);
    }
  }
  return crc;
}

function headerText(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) =>
    byte === 0
      ? "\0"
      : byte >= 0x20 && byte <= 0x7e
        ? String.fromCharCode(byte)
        : "?",
  )
    .join("")
    .split("\0", 1)[0]!
    .trimEnd();
}

const sectionFields: readonly [ReplicaRomSection["kind"], number, number][] = [
  ["arm9", 0x20, 0x2c],
  ["arm7", 0x30, 0x3c],
  ["file-names", 0x40, 0x44],
  ["file-allocation", 0x48, 0x4c],
  ["arm9-overlays", 0x50, 0x54],
  ["arm7-overlays", 0x58, 0x5c],
];

/** Header section table; records an issue for every required or non-empty section outside the file. */
function romSections(
  view: DataView,
  fileSize: number,
  declaredHeaderSize: number,
  issues: string[],
): ReplicaRomSection[] {
  return sectionFields.map(
    ([kind, offsetField, sizeField]): ReplicaRomSection => {
      const offset = view.getUint32(offsetField, true);
      const size = view.getUint32(sizeField, true);
      const required = kind === "arm9" || kind === "arm7";
      const withinFile =
        size === 0
          ? !required && (offset === 0 || offset <= fileSize)
          : offset >= Math.max(minimumHeaderBytes, declaredHeaderSize) &&
            offset <= fileSize &&
            size <= fileSize - offset;
      if (!withinFile)
        issues.push(`${kind} section is empty or outside the input file`);
      return { kind, offset, size, withinFile };
    },
  );
}

/** Reads the NDS header and a streaming fingerprint; never extracts game content. */
export async function inspectReplicaInput(
  path: string,
): Promise<ReplicaInputEvidence> {
  const absolutePath = resolve(path);
  const before = await stat(absolutePath);
  if (!before.isFile())
    throw new TypeError("Replica input must be a regular file");
  if (before.size < minimumHeaderBytes) {
    throw new RangeError(
      "Nintendo DS input is truncated: a 512-byte header is required",
    );
  }
  const source = Bun.file(absolutePath);
  const header = new Uint8Array(
    await source.slice(0, minimumHeaderBytes).arrayBuffer(),
  );
  if (header.byteLength !== minimumHeaderBytes)
    throw new Error("Replica input changed during inspection");
  const hasher = new Bun.CryptoHasher("sha256");
  let hashedBytes = 0;
  for await (const chunk of source.stream()) {
    hasher.update(chunk);
    hashedBytes += chunk.byteLength;
  }
  const after = await stat(absolutePath);
  if (
    hashedBytes !== before.size ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    after.ino !== before.ino
  ) {
    throw new Error("Replica input changed during inspection");
  }
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  const issues: string[] = [];
  const unitCode = header[0x12]!;
  const gameCode = headerText(header.subarray(0x0c, 0x10));
  // devkitPro ndstool writes `####` for homebrew without an assigned code.
  if (!/^([A-Z0-9]{4}|#{4})$/.test(gameCode))
    issues.push(
      "game code must contain four uppercase ASCII letters or digits (#### for homebrew)",
    );
  if (![0, 2, 3].includes(unitCode))
    issues.push("unsupported Nintendo DS unit code");
  const storedHeaderCrc = view.getUint16(0x15e, true);
  const computedHeaderCrc = crc16(header.subarray(0, 0x15e));
  const storedLogoCrc = view.getUint16(0x15c, true);
  const computedLogoCrc = crc16(header.subarray(0xc0, 0x15c));
  const headerCrcValid = storedHeaderCrc === computedHeaderCrc;
  const logoCrcValid =
    storedLogoCrc === expectedLogoCrc && storedLogoCrc === computedLogoCrc;
  if (!headerCrcValid) issues.push("header CRC16 mismatch");
  if (!logoCrcValid) issues.push("logo CRC16 mismatch");
  const declaredRomSize = view.getUint32(0x80, true);
  const declaredHeaderSize = view.getUint32(0x84, true);
  if (declaredRomSize < minimumHeaderBytes || declaredRomSize > before.size)
    issues.push("declared ROM size is outside the input file");
  if (
    declaredHeaderSize < minimumHeaderBytes ||
    declaredHeaderSize > before.size
  )
    issues.push("declared header size is outside the input file");
  const sections = romSections(view, before.size, declaredHeaderSize, issues);
  return {
    schema: 1,
    selectedPath: path,
    absolutePath,
    size: before.size,
    sha256: hasher.digest("hex"),
    format: "nintendo-ds",
    headerTitle: headerText(header.subarray(0, 12)),
    gameCode,
    unitCode,
    declaredRomSize,
    declaredHeaderSize,
    sections,
    validation: {
      valid: issues.length === 0,
      issues,
      headerCrc: {
        stored: storedHeaderCrc,
        computed: computedHeaderCrc,
        valid: headerCrcValid,
      },
      logoCrc: {
        stored: storedLogoCrc,
        computed: computedLogoCrc,
        expected: expectedLogoCrc,
        valid: logoCrcValid,
      },
    },
    scope: "header-and-fingerprint-only",
  };
}

async function writeExclusiveJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    // Linking a complete file publishes it atomically and fails if the destination exists.
    await link(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/** Creates provenance artifacts only; observations and a playable remake are separate stages. */
export async function initializeReplicaInput(
  path: string,
  outputDir: string,
): Promise<ReplicaInputInitialization> {
  const evidence = await inspectReplicaInput(path);
  if (!evidence.validation.valid)
    throw new Error(
      `invalid Nintendo DS input: ${evidence.validation.issues.join("; ")}`,
    );
  const directory = resolve(outputDir);
  const evidencePath = join(directory, "input.json");
  const statusPath = join(directory, "status.json");
  const screensPath = join(directory, "screens");
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, ".input-initialize.lock");
  try {
    await mkdir(lockPath);
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST")
      throw new Error("Replica input initialization is already in progress", {
        cause: error,
      });
    throw error;
  }
  try {
    const previousFile = Bun.file(evidencePath);
    const statusExists = await Bun.file(statusPath).exists();
    const created = !(await previousFile.exists());
    if (!created) {
      const previous =
        (await previousFile.json()) as Partial<ReplicaInputEvidence>;
      if (
        previous.schema !== 1 ||
        previous.format !== evidence.format ||
        previous.sha256 !== evidence.sha256 ||
        previous.size !== evidence.size
      ) {
        throw new Error(
          "Replica input fingerprint does not match existing input.json",
        );
      }
    } else {
      if (statusExists)
        throw new Error(
          "existing status.json has no matching input.json; artifacts preserved",
        );
      await writeExclusiveJson(evidencePath, evidence);
    }
    if (!statusExists) {
      await writeExclusiveJson(statusPath, {
        schema: 1,
        inputSha256: evidence.sha256,
        stage: "recon",
        state: "awaiting-observations",
        playable: false,
        note: "Input provenance is recorded. No emulation, decompilation, asset extraction or gameplay parity is implied.",
      });
    }
    await mkdir(screensPath, { recursive: true });
    return { evidence, evidencePath, statusPath, screensPath, created };
  } finally {
    await rmdir(lockPath);
  }
}
