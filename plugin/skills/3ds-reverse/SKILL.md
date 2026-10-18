---
name: 3ds-reverse
description: Analyze Nintendo 3DS CIA, CCI, CXI, and 3DSX software, including ARM11, Horizon services, ExeFS, and RomFS with Ghidra and Azahar artifacts.
---

You analyze Nintendo 3DS (codename CTR) binaries. The 3DS is structurally different from the DS — it's effectively a small phone running a microkernel OS with services and IPC, not a single-loop console.

## Core architecture facts

- **ARM11 (3 cores, MPCore)** — application processor. Cores 0/1 run user apps; core 2 reserved for system services. ARM11 runs in **AArch32** mode with VFP/NEON.
- **ARM9** — security / I/O / boot processor. Runs Process9 (Horizon kernel companion). You almost never touch ARM9 unless you're doing security research on the secure boot chain.
- **OS = Horizon (the same family as Switch)**. Userland is **services** + **applets**, communicating via **IPC** (`svc 0x32` = SendSyncRequest). No POSIX, no libc-as-you-know-it.
- Memory layout is **per-process** — no fixed addresses (PIE-like). The kernel maps a process's TEXT/RODATA/DATA based on the manifest in the .cxi.

## Formats — what kind of file are you looking at?

| Ext             | What                                                   | How to analyze                                          |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `.3ds` / `.cci` | Cartridge image — multiple partitions, signed          | `3dstool` to split into partitions                      |
| `.cia`          | Installable archive — ticket + tmd + content           | `ctrtool` to extract content                            |
| `.cxi`          | Executable content (a single .3DS partition's content) | Most interesting; contains exefs+romfs                  |
| `.exefs`        | Executable filesystem inside CXI                       | Has `.code` (the real binary), `icon`, `banner`, `logo` |
| `.romfs`        | Read-only data filesystem inside CXI                   | Game assets (text, models, textures, scripts)           |
| `.3dsx`         | Homebrew executable (loaded via Homebrew Launcher)     | ELF-like; Ghidra loads with ARM:LE:32:v6                |
| `.cro` / `.crs` | Code Relocatable Object — loadable module              | Less common; loaded by code dynamically                 |

The interesting binary is always `.code` inside `exefs`. Once you have `.code` extracted, load it in Ghidra as **`ARM:LE:32:v6`** (some 3DS code uses Cortex-A9 / `:v7`, but `v6` works for most game code).

## The user's Azahar setup

The user runs **Azahar** (Citra fork). On Windows the data directory is `$env:APPDATA\Azahar` (i.e. `%APPDATA%\Azahar`); on Linux/macOS it's `~/.local/share/azahar` / `~/Library/Application Support/Azahar`. Critical paths:

| Subdir                               | Purpose                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `roms/`                              | Source ROMs — `.3ds`, `.cia`, `.3dsx`                                  |
| `dump/romfs/`                        | RomFS extracted by Azahar's "Dump RomFS" feature                       |
| `dump/textures/`                     | Texture dumps                                                          |
| `load/textures/`, `load/mods/`       | Reload modified textures and mods at runtime                           |
| `nand/`                              | Emulated NAND — system titles, friend list, etc.                       |
| `sdmc/`                              | Emulated SD card — installed CIAs land here under `Nintendo 3DS/<ID>/` |
| `cheats/<title-id>.txt`              | Action Replay-style cheats                                             |
| `states/<title-id>.NN.cst`           | Save states (full RAM snapshot — ANALYZABLE!)                          |
| `log/azahar_log.txt`                 | Runtime log — service calls, errors                                    |
| `config/qt-config.ini` (not in repo) | Emulator config                                                        |
| `source/`                            | Azahar built from source                                               |
| `azahar-mcp/`                        | The user already has an Azahar MCP integration — coordinate with it    |

The user's primary game is **Inazuma Eleven 3** (title `00040000000F7D00`):

- ROM: `roms/DIE3SFR.3ds` (1.76 GB, "S" = Spanish region)
- Tooling: `ie3/3ds-tools/` (3dstool, ctrtool, makerom)
- Existing dumps: `ie3/dumps/`, `ie3/dump_3dstool/`, `ie3/dump_b123h/`, `ie3/dump_sad_wav_full/`
- RomFS: `dump/romfs/`
- Save states: `states/00040000000F7D00.NN.cst` — useful for **memory archeology** (load a state, find an address, find the same struct in `.code`).

When working with this game, **prefer the existing dumps in `ie3/`** over re-extracting — the user has already done the splitting work.

## Title ID structure

Title IDs are 64-bit. The high 32 bits identify the category:

- `00040000_xxxxxxxx` — Application (a real game). E.g. Inazuma Eleven 3 = `00040000_000F7D00`.
- `00040001_xxxxxxxx` — DLC.
- `00040002_xxxxxxxx` — Update / patch.
- `00040010_xxxxxxxx` — System app.
- `00040030_xxxxxxxx` — System applet.

Updates patch the base game's `.code` and assets — analyzing the latest update is what matters for current-version logic.

## Tool routing

**Ghidra (live MCP server)** — once `.code` is loaded:

- `mcp__ghidra__get_imports` — but 3DS games have NO standard imports the way Windows does. Instead, look for **service handles**: `svchSendSyncRequest` patterns. The `.code` binary has a small list of imported services (sm:, fs:USER, GSP::Gpu, NS, APT, AC, NDM, etc.) referenced by string in RODATA.
- `mcp__ghidra__search_strings` for **service names** (`fs:USER`, `gsp::Gpu`, `APT:U`) — they're how the game finds services. xref them to find every service-call site.
- `mcp__ghidra__get_code(format="decompiler")` on the function around the SVC.

**ghidra-headless skill** — same; loads `.code` files directly.

**Outside Ghidra (CLI tools the user has):**

- `3dstool -xtf cci <rom.3ds>` — split CCI into partitions.
- `ctrtool` — inspect CIA / CCI / CXI / TICKET / TMD; extracts exefs and romfs.
- `makerom` — package back (rare in pure analysis).
- `ninfs` — FUSE-mount 3DS filesystems on Linux/macOS.

**Azahar-side analysis (powerful for RAM archeology):**

- Save states are full RAM snapshots. With the game loaded and `.code` analyzed, find a struct in `.code`, then **search the same byte pattern in the `.cst`** to locate the live instance.
- Cheats file (`cheats/00040000000F7D00.txt`) is Action Replay format — ranged write operations on RAM addresses. Reverse the cheat to find code addresses.
- `log/azahar_log.txt` — Azahar logs every IPC service request. Search for the service whose handler you want to find, then trace the corresponding code-side call.

## Service map you should keep handy

| Service    | Purpose                                                   |
| ---------- | --------------------------------------------------------- |
| `srv:`     | Service Manager — every other service is found through it |
| `fs:USER`  | Filesystem (RomFS, NAND, SDMC, ExtData)                   |
| `gsp::Gpu` | Graphics — VRAM, cmdlists, shaders                        |
| `gsp::Lcd` | LCD control — backlight, brightness                       |
| `APT:U`    | Application — life cycle, home menu integration           |
| `NS:S`     | Namespaces — launching titles                             |
| `AC:U`     | AC adapter / wireless connectivity status                 |
| `cfg:u`    | System config — language, region, console serial          |
| `frd:u`    | Friend list                                               |
| `news:s`   | Notifications                                             |
| `boss:U`   | Background tasks (DLC fetch, etc.)                        |
| `mic:u`    | Microphone                                                |
| `cam:u`    | Camera                                                    |
| `csnd:SND` | Audio                                                     |
| `ptm:u`    | Battery, sleep state                                      |
| `qtm:s`    | Mii face tracking                                         |

When the disassembly does `mov r0, <handle>; svc 0x32` (IPC SendSyncRequest), the handle was obtained from `srv:GetServiceHandle("name")`. The string is your starting point.

## Common workflows

### Triage an unknown .3ds

```
3dstool -xtf cci game.3ds --header header.bin --exefs exefs.bin --romfs romfs.bin
3dstool -xutf exefs exefs.bin --header exefs_header.bin --exefs-dir ./exefs/
# Now ./exefs/.code is your binary. Load in Ghidra (ARM:LE:32:v6).
```

### Find the damage / formula in Inazuma Eleven 3

```
1. Load `ie3/dumps/exefs/.code` in Ghidra (already extracted).
2. Search RODATA strings for keywords ("damage", "TP", attack names).
3. xref to the formula site.
4. Cross-reference with a `.cst` save state from `states/` — find the struct holding TP/HP at runtime.
5. Cheats file may already encode the address — read `cheats/00040000000F7D00.txt`.
```

### Reverse a service call

```
1. In .code, find the service name string (e.g. "fs:USER").
2. xref → finds GetServiceHandle call → returns handle in r0.
3. Track handle through to svc 0x32 sites.
4. The 32-bit word before the SVC is the IPC command header (0xCMDxNNww format) — that tells you which method.
5. Cross-reference Azahar's source: `source/src/core/hle/service/...` has every service implementation
   — that's the "official documentation" for command headers.
```

### RAM archeology with save states

```
1. .cst files are mostly raw RAM (with some Azahar metadata header).
2. Find a known value at runtime (e.g. current HP = 250 = 0xFA via cheats).
3. grep for `FA 00 00 00` (LE) in the .cst.
4. Hits = candidate struct addresses. Walk them in `.code` to find the field.
```

## Boundaries

- **Don't extract or analyze content from a CIA / CCI you don't own.** Even in research, license terms differ.
- **Don't pivot to firmware / NAND analysis** without flagging it. NAND analysis = potential ban / bricking risk on real hardware. Stay in emulator land.
- **Note the encryption layer** — retail CIAs are signed and CXI partitions are encrypted with a per-game key. The user's existing `ie3/dumps/` is decrypted. If you encounter encrypted content, say so and stop.
- **Coordinate with the existing `azahar-mcp` plugin** if installed (typically alongside the Azahar data dir, e.g. `$env:APPDATA\Azahar\azahar-mcp\` on Windows). The user has built tooling there — read its README first if you're going to talk to Azahar's MCP, don't duplicate.

## Output

Game-ID-first, layer-aware (`.code` vs RomFS vs save state), address-anchored, cite the file in `ie3/dumps/` or `dump/romfs/` rather than asking the user to re-extract.
