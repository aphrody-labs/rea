---
name: bun-engine
description: Identify, parse, disassemble and run console ROM, BIOS and firmware images on the Bun Engine cores (GBA, NES, PlayStation, DS, 3DS, Switch, Wii/GameCube, AArch64 firmware, x86/Linux), record and replay deterministic input sessions, manage free firmware and ROMs with bep, and capture screens and console output for reverse engineering and verification.
---

Bun Engine is the emulation side of the `re` product: one native CLI (`crates/bun-engine-core`, binary `bun-engine`) over every in-tree core, a TypeScript front door (`packages/bun-engine`: `bun-engine`, `bep` and the formats plugin), and the `re` commands and MCP tools below. Every `re` command accepts `--json`.

## Identify and parse an image (formats plugin, in process)

| Task                                                              | CLI                                                                  | MCP                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| Format, platform, detector, entry                                 | `re formats identify <file> [--magika] --json`                       | `formats_inspect`                  |
| Parsed header, known-firmware matches                             | `re formats header <file>`                                           | `formats_inspect`                  |
| Sections, load addresses, CPU                                     | `re formats sections <file> --json`                                  | `formats_inspect`                  |
| Embedded file systems (NitroFS, FST, ISO 9660, ExeFS, PFS0/HFS0)  | `re formats files <file> --json`                                     | `formats_inspect` (`files: true`)  |
| Disassembly (6502, ARM/Thumb, LR35902, R3000, PPC, AArch64, m68k) | `re formats disasm <file> [--arch A] [--at ADDR] [--count N] --json` | `formats_disasm`                   |
| CRC-32/MD5/SHA-1/SHA-256                                          | `re formats stream <file>`                                           | `formats_inspect` (`digest: true`) |

BIOS dumps are matched against the public hashes of `plugins/consoles/firmware.json` and the free registry `plugins/consoles/free-firmware.json` (`header.known[]`): the PCSX-Redux OpenBIOS and the Normmatt GBA BIOS are reported as free replacements. Proprietary dumps are only identified, never fetched.

## Run a machine

- `re engine run <system> <image> [--frames N] [--bios FILE] [--out DIR] [--input SCRIPT] [--trace FILE.jsonl] --json` (MCP `engine_run`) runs `nds`, `3ds`, `switch`, `gba` (RustBoyAdvance-NG, free Normmatt BIOS built in), `nes` (TetaNES), `psx` (StarPSX, needs a 512 KiB BIOS such as the free OpenBIOS), `wii`, `gc`, `arm`, `x86` and `linux` headless and returns the guest console output; `--out` writes `screen<i>.ppm`.
- `--input start@60-65,right@100-200` scripts the pad (keys `a b select start right left up down r l x y`, inclusive frame ranges); `--trace` writes one `{frame, keys, screens}` FNV-1a digest line per frame.
- `re engine info <rom.nds> --json` (MCP `engine_info`) validates a DS/DSi header (CRCs, regions) without running it.
- Without `--headless` (plain `bun-engine run`) the image opens in the one window.

## Record and replay (Replica parity)

- `re replica record <system> <image> --frames N --input SCRIPT [--bios FILE] [--out replay.json]` (MCP `replica_record`) pins the image and BIOS by SHA-256 and stores the input script and per-frame screen digests.
- `re replica replay <replay.json>` (MCP `replica_replay`) reruns the machine and exits 0 only when every frame and the console output are identical; otherwise it reports the first diverging frame. Use it to prove determinism, bisect core regressions and compare a recompiled build's behaviour with the interpreter.

## Packages and firmware (bep)

- `bep consoles`, `bep firmware:list`, `bep add free-firmware <name>` (`openbios`, `normmatt-gba-bios`), `bep install`, `bep roms`, `bep bios`, `bep usr` manage the gitignored `usr/` root, upstream release emulators and libretro cores with BIOS checks. `re bin usr/lib/<id>/<exe>` reports a release binary's imports, version resource and bep provenance.
- Only free or user-owned images are used; never download commercial BIOS or ROM dumps.

## With the RE pipeline

- `re pipeline <image> --target firmware` identifies and lifts console images; `re recompile` (skill `static-recompile`) turns GBA, PlayStation and NES images into native or WebAssembly builds over these same cores and checks them against `bun-engine run`.
- Compare two runs on their digests (`re replica replay`) or PPM dumps (same frame count, same BIOS) before trusting a behavioural claim.

Build the native CLI through the serialized wrapper: `bun msvc exec --toolset 14.44 -- bun scripts/cargo.ts exec -- build -p bun-engine --bin bun-engine` (or set `BUN_ENGINE_NATIVE`); `re` picks the newest build of any Cargo slot (`target/`, `target/slot-N/`).
