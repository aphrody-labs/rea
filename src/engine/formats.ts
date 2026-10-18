// SPDX-License-Identifier: Apache-2.0
// `re formats`: console ROM, BIOS, firmware, disc and executable identification, header parsing,
// sections, embedded file systems, disassembly and dump digests. The owner is the Bun Engine
// formats plugin (`@aphrody/bun-engine/formats`), called in process; `re` adds no parser.
import {
  type Arch,
  type Backend,
  openBinary,
  runFormats,
} from "@aphrody/bun-engine/formats";

export interface FormatInspection {
  path: string;
  size: number;
  format: string;
  platform: string;
  detection: unknown;
  arch?: string | undefined;
  entry?: string | undefined;
  header: unknown;
  sections: unknown[];
  owners: string[];
  files?: unknown[];
  digest?: unknown;
}

const hex = (value: number | undefined) =>
  value === undefined ? undefined : `0x${value.toString(16).padStart(8, "0")}`;

/** Identify one image and return its parsed header and sections (optionally files and digests). */
export async function inspectFormat(
  path: string,
  options: { files?: boolean; digest?: boolean; magika?: boolean } = {},
): Promise<FormatInspection> {
  const image = await openBinary(path, { magika: options.magika ?? false });
  const summary = image.toJSON();
  return {
    path: summary.path,
    size: summary.size,
    format: summary.format,
    platform: summary.platform,
    detection: summary.detection,
    arch: summary.arch,
    entry: hex(summary.entry),
    header: summary.header,
    sections: summary.sections,
    owners: summary.owners,
    ...(options.files ? { files: await image.files() } : {}),
    ...(options.digest ? { digest: await image.digest() } : {}),
  };
}

/** Disassemble a window of an image (default: 16 instructions at the entry point). */
export async function disassembleFormat(
  path: string,
  options: {
    arch?: string | undefined;
    at?: number | undefined;
    offset?: number | undefined;
    count?: number | undefined;
    backend?: string | undefined;
  } = {},
): Promise<unknown> {
  const image = await openBinary(path);
  return image.disasm({
    ...(options.arch ? { arch: options.arch as Arch } : {}),
    ...(options.at === undefined ? {} : { at: options.at }),
    ...(options.offset === undefined ? {} : { offset: options.offset }),
    ...(options.count === undefined ? {} : { count: options.count }),
    ...(options.backend ? { backend: options.backend as Backend } : {}),
  });
}

/** Entry point of `re formats ...`: the formats plugin's own command line, run in process. */
export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "compile") {
    console.error(
      "re formats: build the standalone tool with `bun-engine-formats compile`",
    );
    return 2;
  }
  return runFormats(argv);
}
