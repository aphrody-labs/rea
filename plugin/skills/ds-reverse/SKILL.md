---
name: ds-reverse
description: Analyze Nintendo DS and DSi ROMs with NTRGhidra, including ARM9, ARM7, overlays, NitroSDK functions, and hardware register maps.
---

You analyze Nintendo DS (codename **NTR**) and Nintendo DSi (**TWL**) binaries via the **NTRGhidra v1.5.1** loader (installed at `<GhidraInstallDir>/Ghidra/Extensions/NTRGhidra`). The DS is a **dual-processor** console — every analysis decision must account for which CPU you're looking at, and the loader gives you a lot of metadata for free that you should leverage rather than re-derive.

## What NTRGhidra gives you on import (don't re-invent)

When you import a `.nds` file, the loader splits the ROM into **two separate Ghidra programs** (one ARM9, one ARM7), each with proper memory blocks, automatic register labels, an entry-point function, and CRT0 awareness.

### Memory regions auto-created

**ARM9 program**:

| Region                   | Address      | Size  | Perms |
| ------------------------ | ------------ | ----- | ----- |
| Main RAM                 | `0x02000000` | 4 MB  | R/W/X |
| `Shared_WRAM`            | `0x03000000` | 32 KB | R     |
| `ARM9_IO_Ports`          | `0x04000000` | 16 MB | R     |
| `Standard_Palettes`      | `0x05000000` | 16 MB | R     |
| `VRAM_Engine_A_BG_VRAM`  | `0x06000000` | 2 MB  | R     |
| `VRAM_Engine_B_BG_VRAM`  | `0x06200000` | 2 MB  | R     |
| `VRAM_Engine_A_OBJ_VRAM` | `0x06400000` | 2 MB  | R     |
| `VRAM_Engine_B_OBJ_VRAM` | `0x06600000` | 2 MB  | R     |
| `VRAM_LCDC`              | `0x06800000` | 2 MB  | R     |

**ARM7 program**:

| Region                               | Address      | Size   |
| ------------------------------------ | ------------ | ------ |
| `Shared_WRAM`                        | `0x03000000` | 32 KB  |
| `ARM7_WRAM_`                         | `0x03800000` | 64 KB  |
| `ARM7_IO_Ports`                      | `0x04000000` | 8 MB   |
| Wireless Comm. WS0 (8K RAM)          | `0x04800000` | 32 KB  |
| Wireless Comm. WS1 (I/O)             | `0x04808000` | 2 MB   |
| `VRAM_allocated_as_Work_RAM_to_ARM7` | `0x06000000` | 256 KB |
| `GBA_Slot_ROM`                       | `0x06600000` | 32 MB  |
| `GBA_Slot_RAM`                       | `0x0A000000` | 64 KB  |

> **Important caveat**: I/O / palette / VRAM regions are loaded with **R-only permissions**. Stores into them in disassembly are normal (the hardware accepts them) but the decompiler may flag them. Don't get confused — that's the loader's choice, not a sign of malformed code.

### Auto-applied labels (40+ registers, ARM9-side)

NTRGhidra reads `NDSLabelList.java` and creates real Ghidra labels for every important MMIO register. **You don't need to look up addresses — search the symbol table.** Highlights:

| Functional area       | Labels you can search for directly                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2D Engine A           | `REG_A_DISPCNT` (0x4000000), `REG_A_DISPSTAT` (0x4000004), `REG_VCOUNT` (0x4000006), `2D_ENGINE_A` (0x4000008), `REG_DISP3DCNT` (0x4000060), `REG_DISPCAPCNT`, `REG_DISP_MMEM_FIFO`, `REG_A_MASTER_BRIGHT` |
| DMA / Timers / Keypad | `DMA_CHANNEL_0_to_3` (0x40000B0), `DMA_FILL` (0x40000E0), `TIMERS` (0x4000100), `REG_KEYINPUT` (0x4000130), `REG_KEYCNT` (0x4000132)                                                                       |
| IPC + Cart            | `REG_IPCSYNC` (0x4000180), `REG_IPCFIFOCNT`, `REG_IPCFIFOSEND`, `REG_AUXSPICNT`, `REG_AUXSPIDATA`, `Gamecard_*` (8-byte command, encryption seeds)                                                         |
| Memory + IRQ          | `REG_EXMEMCNT` (0x4000204), `REG_IME` (0x4000208), `REG_IE` (0x4000210), `REG_IF` (0x4000214), `VRAMCNT_A` … `VRAMCNT_I`, `WRAMCNT`                                                                        |
| HW math               | `REG_DIVCNT` (0x4000280), `REG_DIV_NUMER/DENOM/RESULT/REM`, `REG_SQRTCNT`, `SQRT_RESULT/PARAM`                                                                                                             |
| Power                 | `POSTFLG`, `POWCNT1` (0x4000304)                                                                                                                                                                           |

**Workflow consequence**: when you see `ldr r0, [r1, #0x130]` on `r1 = 0x04000000`, the operand resolves to `REG_KEYINPUT` automatically — no need to mentally compute the address. xrefs on `REG_KEYINPUT` give you every input-handling site instantly.

### Function entry points

The loader creates two functions on import:

- `_entry_arm9` — at the ARM9 entry point from the header.
- `_entry_arm7` — at the ARM7 entry point.

These are your starting points for control-flow analysis. Both call into CRT0 startup, then into the game's `main`.

### NitroSDK 3.0 Function ID database — bundled but **not auto-attached**

NTRGhidra v1.5.1 ships `fidb/nitrosdk3.0.fidb` (in the install dir's `fidb/` folder). It's a Ghidra Function ID database covering NitroSDK 3.0 functions. **You must attach it manually** for it to work — the loader doesn't do this for you:

```
Tools → Function ID → Attach existing FidDb…
  → $env:GHIDRA_INSTALL_DIR\Ghidra\Extensions\NTRGhidra\fidb\nitrosdk3.0.fidb
Then re-run analysis (Analysis → Auto Analyze) with "Function ID" enabled.
```

After this, retail games using NitroSDK 3.0 will have **`OS_Init`, `GX_*`, `MI_*`, `FS_*`, `SND_*`, `CARD_*`, …** named automatically wherever the FID database recognizes them. This is the single biggest force-multiplier you can apply to a stripped retail ROM.

> Heads up: **issue #18** (open) says SDK function detection isn't perfect — some ROMs / SDK versions yield few matches even with the FidB attached. If you get nothing, the ROM may be linked against a NitroSDK version newer/older than 3.0, or ship a custom build of the SDK.

## Dynamic overlay loading (NTRGhidraPlugin)

DS retail games often have **dozens to hundreds of overlay binaries** — chunks of ARM9/ARM7 code paged into the same VA range (`0x02xxxxxx`) at runtime. To analyze a specific overlay, you must enable the overlay-loading plugin and select it:

1. **Activate the plugin (one-time)**: in the Ghidra front-end, `File → Configure → Miscellaneous → NTRGhidraPlugin` → tick the box. **Restart Ghidra.**
2. **Open the program** in CodeBrowser as usual.
3. The plugin adds an action to load specific overlays into the program's memory map without re-importing.
4. **Critical constraint**: the **original `.nds` file must still be at the exact filesystem path it was when imported**. The plugin re-reads the ROM from that path to fetch overlay bytes. If the file moved, overlay loading fails silently.

When walking a function in retail RPG code (Pokémon, Inazuma Eleven, etc.), be aware: the address range `0x02xxxxxx` is **multiplexed** across many overlays. Two functions in different overlays can share the same VA. Always know which overlay is active in your current program state.

> **Issue #29** (closed in v1.5+) — older versions loaded all overlays at once, causing chaos. v1.5.1 lets you pick which to load.

## DS vs DSi (NTR vs TWL)

The loader has **separate label and region tables for DSi** (`DSILabelList.java`, `DSIMemRegionList.java`). When the import detects a DSi-enhanced or DSi-exclusive ROM, additional regions and registers are added (NWRAM banks, AES hardware, camera, SD card I/O, etc.). The base DS layout above still applies; DSi just extends it.

To check what you got: open the program's Memory Map (`Window → Memory Map`) and look for `NWRAM_A/B/C` regions — present = DSi mode.

## Architecture — the dual-CPU reality

|        | ARM9                                   | ARM7                                   |
| ------ | -------------------------------------- | -------------------------------------- |
| Core   | ARM946E-S                              | ARM7TDMI                               |
| Clock  | 67 MHz                                 | 33 MHz                                 |
| Caches | 8 KB I + 4 KB D + DTCM/ITCM            | none                                   |
| Role   | Game logic, 3D, main loop              | Sound, WiFi, touch, RTC, low-level I/O |
| ITCM   | `0x01FF8000+`, 32 KB, fast instr fetch | n/a                                    |
| DTCM   | `0x027C0000+`, 16 KB, fast data        | n/a                                    |

They communicate via **IPC FIFO** (`REG_IPCFIFOSEND/RECV` at `0x4000188/0x4100000`) and **shared WRAM** (32 KB, mappable to either side via `WRAMCNT`).

99% of retail RE work is on ARM9. Touch input, microphone, RTC, and WiFi packets are the few cases where you'd open the ARM7 program.

## BIOS calls (SWI numbers)

ARM9 SWIs are documented in gbatek; ones you'll see most:

| SWI    | Function                                                     |
| ------ | ------------------------------------------------------------ |
| `0x06` | `LZ77UnCompReadNormalWrite8bit` — LZ77 decompression         |
| `0x09` | `HuffUnComp` — Huffman decompression                         |
| `0x0E` | `RLUnCompReadNormalWrite8bit` — RLE decompression            |
| `0x0F` | `Diff8bitUnFilterWrite8bit` — animation/texture delta filter |
| `0x18` | `IsDebugger` — anti-debug flag                               |
| `0x20` | `CpuSet` — fast memory copy/fill                             |
| `0x21` | `CpuFastSet` — same, 32-byte aligned                         |

Recognize these in disassembly as `swi 0xNN` (or `bx lr` patterns calling into BIOS at `0xFFFF0000`).

## Tooling that complements NTRGhidra

All bundled CLI are already on `PATH` (the user keeps them under a single `nds-cli/` directory but you can invoke them by name). No GUI tools.

| Tool                    | Use                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`NitroPacker.exe`**   | unpack/repack the ROM (header dump, ARM9/ARM7 split, overlay + NitroFS extraction, ARM9 patching). Modern .NET replacement for the old `ndstool`. |
| **`apicula.exe`**       | view/convert NSBMD/NSBTX/NSBCA — NDS 3D models → glTF/COLLADA.                                                                                    |
| **`DSDecmp.exe`**       | LZ10/LZ11/Huff/RLE de/compression of standalone files (when working outside Ghidra).                                                              |
| **`vgmstream-cli.exe`** | decode NDS audio streams (STRM/SWAV/SDAT entries) → WAV.                                                                                          |
| **`ndspy`** (Python)    | NARC archives, BMG/MSBT text, NCGR/NCLR/NSCR/NCER 2D graphics, soundArchive.                                                                      |
| **`nds`** (this CLI)    | run/trace/dump/diff a live ROM via py-desmume — `nds dump`, `nds diff`, `nds ar-apply`, hooks, savestates.                                        |
| **gbatek**              | THE reference for hardware (`https://problemkaputt.de/gbatek.htm`) — every register, every BIOS call, every quirk.                                |

## Tool routing inside Ghidra

Once a `.nds` is imported and (optionally) NitroSDK FidB attached:

- `mcp__ghidra__get_binary_info` — confirms it's an NDS program (loader name = `Nintendo DS (NTR)`).
- `mcp__ghidra__get_segments` — lists every memory region above; verify the layout makes sense.
- `mcp__ghidra__get_symbols` (or filter `get_imports`) — find the auto-applied register labels.
- `mcp__ghidra__search_functions_by_name` for `_entry_arm9`, `OS_Init`, `MI_CpuCopy*`, `FS_*`, `GX_Init` — anchor the call graph.
- `mcp__ghidra__search_strings` for game banner / version strings, NitroSDK version, build dates.
- `mcp__ghidra__xrefs` on `REG_KEYINPUT` → every input-handling code path.
- `mcp__ghidra__xrefs` on the IPC FIFO send register → every cross-CPU message site.

For batch / no-GUI work, the **`ghidra-headless`** skill works on `.nds` files transparently — `find-ghidra.ps1` finds the install with NTRGhidra registered.

## Recognition heuristics for triage

When you first see a `.nds`:

- **Header at offset 0**: 12-byte ASCII title (e.g. `INAZUMAEL3 `), 4-byte gamecode (`IPGE` = Pokémon Platinum US, `BPRE` = FireRed, `B3IE` = some Inazuma SKU), 2-byte makercode, version. NTRGhidra surfaces these in the program's Properties.
- **NitroSDK signatures** (after FidB attach): `OS_Init`, `GX_Init`, `SND_Init`, `FS_Init`, `OS_VBlankIntr` → retail-grade NitroSDK build.
- **No SDK matches even with FidB**: probably homebrew (libnds), a different SDK version, or heavily customized.
- **Banner data** at offset `0x68`: 32×32 4bpp icon and localized titles — `NitroPacker.exe unpack` writes `banner.bin` alongside `header.bin` and the ARM9/ARM7 split, or use `ndspy.rom` for a quick programmatic read.
- **Compressed code/overlays**: leading byte `0x10` = LZ77 (most common), `0x20` = Huffman, `0x30` = RLE. NTRGhidra's `ARM9.java` handles ARM9 binary decompression at load time, but per-overlay decompression may need manual decompress via `DSDecmp` first.

## Known limitations of NTRGhidra (don't promise these)

- **No re-pack** to `.nds` from a modified Ghidra program (issue **#26 OPEN**). You can analyze, you can't rebuild a playable ROM. For modding, you patch the source `.nds` separately (e.g. `NitroPacker.exe unpack` → edit ARM9/files → `NitroPacker.exe pack`), then re-import.
- **SDK function detection is incomplete** (issue **#18 OPEN**). The bundled FidB covers NitroSDK 3.0; non-3.0 builds may yield few matches.
- **SDK decompression bug** (issue **#5 OPEN**): a stale "indexOf returns -1" path in the decompressor. Symptom: import fails or ARM9 is missing chunks. Workaround: manually decompress the ARM9 binary with `blz` / `DSDecmp` before importing.
- **Stale Ghidra-version coupling**: this v1.5.1 release is pinned to Ghidra 12.0.4. For other Ghidra versions, you need a different release.

## Boundaries

- **Don't claim symbol names you didn't see.** Most retail NDS ROMs are stripped — `FUN_02123abc` is the truth, not "the AI tick function" unless you've xref'd to a string or known SDK call that proves it.
- **State which CPU you're talking about.** Almost always ARM9, but be explicit when you switch to ARM7.
- **Note overlay context.** When citing addresses in `0x02xxxxxx`, say which overlay (or "main code") — the same VA is multiplexed.
- **Don't run cracked/leaked retail ROMs through public services.** Watermarks exist.
- **No piracy guidance.** Reverse engineering for compatibility / homebrew / mod / accessibility / academic study is fine; circumventing DRM to redistribute is not.

## Output

Game ID + region + SDK detection at top, then findings address-anchored, then a clear next step (overlay to load, FidB to attach, function to xref).

Reference link the user can keep open: **gbatek** at `https://problemkaputt.de/gbatek.htm`. Every register / BIOS call / quirk is there.
