# ARM Reverse Engineering — full Windows-native stack

End-to-end CLI handbook for the ARM RE tooling installed on this box. No MSYS2.
No GUI. All commands are PowerShell-or-Bash-friendly and copy-paste runnable
once `$env:GHIDRA_INSTALL_DIR` is set and a fresh shell has been opened.

## What's installed

### Native binaries (PATH-resolved)

| Tool                  | Version                | Path                                      | Use                                                                                  |
| --------------------- | ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| **Ghidra**            | 12.0.4                 | `$env:GHIDRA_INSTALL_DIR`                 | full RE platform — load, analyze, decompile, patch                                   |
| **NTRGhidra**         | v1.5.1                 | `…\Ghidra\Extensions\NTRGhidra\`          | Ghidra loader for `.nds` (auto memory map + 40+ register labels + NitroSDK 3.0 FidB) |
| **radare2** suite     | 6.1.4                  | `C:\Tools\radare2\radare2-6.1.4-w64\bin\` | CLI disassembler / debugger / patcher / hash / diff                                  |
| **QEMU**              | 11.0.0                 | `C:\Program Files\qemu\`                  | full-system + user-mode emulators for ARM, AArch64, and 30+ archs                    |
| **Arm GNU Toolchain** | 14.2.Rel1 (gcc 14.2.1) | `C:\Tools\arm-gnu-toolchain\bin\`         | bare-metal cross-compile, link, debug (`arm-none-eabi-*`)                            |
| **3DS tools**         | various                | `…\Azahar\ie3\3ds-tools\bin\`             | `3dstool`, `ctrtool`, `makerom`, `picasso` for CCI/CIA/CXI/exefs/romfs               |

### Python libraries (Python 3.14, user site-packages)

| Library           | Version | Use                                                           |
| ----------------- | ------- | ------------------------------------------------------------- |
| `capstone`        | 5.0.6   | multi-arch disassembler bindings — every ARM mode             |
| `keystone-engine` | 0.9.2   | multi-arch assembler — emit bytes from asm strings            |
| `unicorn`         | 2.1.4   | CPU-only emulator — single-step ARM/Thumb, no devices         |
| `lief`            | 0.17.6  | parse/modify ELF / PE / Mach-O / OAT / DEX                    |
| `angr`            | 9.2.214 | symbolic execution + VEX IR + static analysis                 |
| `pwntools`        | 4.15.0  | exploit-dev framework — ROP, shellcraft, packing              |
| `ndspy`           | 4.2.0   | pure-Python NDS file formats (NARC / NCGR / NSBMD / SDAT / …) |
| `pyctr`           | 0.7.6   | pure-Python 3DS formats (CCI / CIA / CXI / ExeFS / RomFS)     |
| `ninfs`           | 2.0     | FUSE-mount 3DS filesystems (needs WinFsp on Windows)          |
| `pyghidra`        | 3.0.2   | CPython → Ghidra bridge (jpype-based)                         |

### Console-specific extras

- **Live MCP server `ghidra`** at `http://localhost:8080/mcp` (GhidrAssistMCP plugin in Ghidra). Its tools are exposed to Codex as `mcp__ghidra__*`.
- **Specialized Codex skills** in `ghidra-suite-plugin/skills/`:
  - `binary-triage` — fast first-pass on any binary
  - `vulnerability-hunter` — memory safety / injection / auth bugs
  - `decompile-cleaner` — rename, struct recovery, type inference
  - `firmware-analyst` — embedded ARM (Cortex-M / Cortex-A / MIPS)
  - `malware-analyst` — IoC + ATT&CK
  - `ctf-solver` — small puzzle binaries
  - `ds-reverse` — Nintendo DS / DSi via NTRGhidra
  - `3ds-reverse` — Nintendo 3DS via Azahar dumps + Ghidra
  - `bun-engine` — run GBA/NES/PlayStation/DS/Wii/AArch64/x86 images headless on the Bun Engine cores (`bun-engine run`, `bep`)
  - `static-recompile` — `re recompile`: GBA ARMv4T, PlayStation R3000A and NES 6502 images to native/WebAssembly builds, verified against the interpreter

## ARM architecture cheatsheet

| Profile                   | Microarchitecture      | Used in (examples on this box)               |
| ------------------------- | ---------------------- | -------------------------------------------- |
| ARMv4T                    | ARM7TDMI               | NDS ARM7, GBA                                |
| ARMv5TE                   | ARM946E-S              | NDS ARM9                                     |
| ARMv6-M                   | Cortex-M0 / M0+        | low-power MCUs                               |
| ARMv7-M                   | Cortex-M3 / M4 / M7    | STM32, NXP MCUs                              |
| ARMv7-A                   | Cortex-A8 / A9 / A15   | **3DS (ARM11 MPCore)**, smartphones pre-2014 |
| ARMv8-A AArch32 / AArch64 | Cortex-A53 / A72 / A78 | Switch, modern phones, Raspberry Pi 4        |

Ghidra's processor IDs to use with `-Processor`:

| Target              | Ghidra processor ID |
| ------------------- | ------------------- |
| NDS ARM9 (ARMv5TE)  | `ARM:LE:32:v5t`     |
| NDS ARM7 (ARMv4T)   | `ARM:LE:32:v4t`     |
| 3DS ARM11 (ARMv6)   | `ARM:LE:32:v6`      |
| Cortex-M            | `ARM:LE:32:Cortex`  |
| Generic ARMv7-A     | `ARM:LE:32:v7`      |
| AArch64             | `AARCH64:LE:64:v8A` |
| Big-endian variants | swap `LE` → `BE`    |

Full list (181 entries on this Ghidra): `Get-GhidraProcessor | Select Id, Description`.

## Workflow recipes

All examples assume a fresh PowerShell session that picks up the new PATH.

### 1. Identify an unknown ARM binary

```powershell
# Format detection + arch detection
rabin2 -I binary.elf
rabin2 -i binary.elf       # imports
rabin2 -E binary.elf       # exports
rabin2 -z binary.elf       # strings

# Or in one go via ghidra-suite plugin
# /ghidra:triage binary.elf
```

### 2. Disassemble a function with `radare2`

```powershell
radare2 -A -e bin.dbginfo=true binary.elf
# inside r2:
> aaa                       # full analysis
> afl                       # function list
> pdf @ main                # disassemble main
> agf @ sym.parse_header    # ASCII control-flow graph
> q
```

### 3. Disassemble with `capstone` from Python

```python
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB, CS_MODE_ARM
md = Cs(CS_ARCH_ARM, CS_MODE_THUMB)   # for Thumb-2 / Cortex-M
md.detail = True
for ins in md.disasm(b"\x00\xb5\x00\x20", 0x08000000):
    print(f"0x{ins.address:08x}: {ins.mnemonic} {ins.op_str}")
```

### 4. Assemble with `keystone`

```python
from keystone import Ks, KS_ARCH_ARM, KS_MODE_THUMB
ks = Ks(KS_ARCH_ARM, KS_MODE_THUMB)
encoding, count = ks.asm("nop; nop; bx lr")
print(bytes(encoding).hex())   # 00bf 00bf 7047
```

### 5. CPU emulate a function with `unicorn`

```python
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_PC, UC_ARM_REG_SP

mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
CODE_BASE = 0x1000
STACK_BASE = 0x2000

mu.mem_map(CODE_BASE, 0x1000)
mu.mem_map(STACK_BASE, 0x1000)

code = bytes.fromhex("0xb501 4078 7047".replace(" ",""))   # ldrb r0,[r0]; bx lr
mu.mem_write(CODE_BASE, code)
mu.mem_write(0x10000, b"\x42")
mu.reg_write(UC_ARM_REG_R0, 0x10000)
mu.reg_write(UC_ARM_REG_SP, STACK_BASE + 0x800)
mu.emu_start(CODE_BASE | 1, CODE_BASE + len(code))   # |1 → Thumb
print(hex(mu.reg_read(UC_ARM_REG_R0)))    # → 0x42
```

### 6. Symbolic exec with `angr`

```python
import angr
proj = angr.Project("./challenge.elf", auto_load_libs=False)
state = proj.factory.entry_state()
simgr = proj.factory.simulation_manager(state)
simgr.explore(find=lambda s: b"correct" in s.posix.dumps(1),
              avoid=lambda s: b"wrong"  in s.posix.dumps(1))
print(simgr.found[0].posix.dumps(0))   # the input that prints "correct"
```

### 7. Full-system emulation with QEMU

```powershell
# Boot a Cortex-M3 image (mps2-an385 board model)
qemu-system-arm -M mps2-an385 -kernel firmware.elf -nographic -semihosting

# Boot a generic Cortex-A9 with U-Boot + kernel
qemu-system-arm -M virt -cpu cortex-a9 -kernel zImage -dtb device.dtb -append "console=ttyAMA0" -nographic

# AArch64 Linux user-space binary
qemu-aarch64 -L /path/to/sysroot ./bin/program arg1 arg2

# AArch32 user-mode (run an ARM Linux binary on Windows!)
qemu-arm -L /path/to/sysroot ./bin/arm32-program
```

### 8. Cross-compile a tiny ARM payload

```powershell
@'
.thumb
.globl _start
_start:
    movs r0, #42
    bx   lr
'@ > shellcode.s

arm-none-eabi-as -mcpu=cortex-m3 -mthumb shellcode.s -o shellcode.o
arm-none-eabi-ld -Ttext=0x0 --oformat=binary shellcode.o -o shellcode.bin
arm-none-eabi-objdump -d -m arm -M force-thumb shellcode.o
```

### 9. Disassemble + objdump from the Arm toolchain

```powershell
arm-none-eabi-objdump -D -b binary -m armv7-a -M force-thumb,reg-names-std firmware.bin | Select-Object -First 50
arm-none-eabi-readelf -a kernel.elf
arm-none-eabi-nm --defined-only -n kernel.elf
arm-none-eabi-addr2line -e kernel.elf -f 0x80004a3c
```

### 10. Patch with `lief`

```python
import lief
elf = lief.ELF.parse("./binary.elf")
sym = next(s for s in elf.dynamic_symbols if s.name == "check_password")
sym.value = 0  # or build a hooks/patches via Add Section + relocate
elf.write("./patched.elf")
```

## NDS-specific recipes

### Unpack a `.nds`

```powershell
# Header + arm9.bin + arm7.bin + overlays + filesystem (using ndspy in Python)
python - << 'PY'
import ndspy.rom
rom = ndspy.rom.NintendoDSRom.fromFile("game.nds")
print("game code:", rom.idCode.decode())
print("title:", rom.name)
print("arm9 size:", len(rom.arm9), "arm7 size:", len(rom.arm7))
# extract overlays
for i, ov in enumerate(rom.arm9Overlays):
    open(f"overlay_{i:03d}.bin","wb").write(ov.data)
PY
```

### Open in Ghidra with NTRGhidra

```
File → Import File → game.nds  (loader auto-selected: Nintendo DS (NTR))
```

NTRGhidra splits the ROM into two Ghidra programs (ARM9 + ARM7). Both
get auto-applied register labels (`REG_KEYINPUT`, `VRAMCNT_A` … `VRAMCNT_I`,
`REG_IPCFIFOSEND`, etc.) and an entry-point function (`_entry_arm9` /
`_entry_arm7`).

### Attach NitroSDK 3.0 Function ID DB

After import, in Ghidra:

```
Tools → Function ID → Attach existing FidDb…
  → $env:GHIDRA_INSTALL_DIR\Ghidra\Extensions\NTRGhidra\fidb\nitrosdk3.0.fidb
Analysis → Auto Analyze (re-tick "Function ID")
```

NitroSDK functions (`OS_Init`, `GX_*`, `MI_*`, `FS_*`, `SND_*`, `CARD_*`)
get their proper names automatically.

### Activate dynamic overlay loading (one-time)

```
Ghidra front-end → File → Configure → Miscellaneous → NTRGhidraPlugin → tick → restart
```

After that, the per-program overlay-selection action becomes available. The
**original `.nds` file must remain at the exact filesystem path it was at
during import** for overlay re-fetching to work.

## 3DS-specific recipes

### Unpack a `.3ds` (CCI cartridge image)

```powershell
3dstool -xtf cci game.3ds --header header.bin --exefs exefs.bin --romfs romfs.bin --exh exh.bin --exh-no-crypto
3dstool -xutf exefs exefs.bin --header exefs_header.bin --exefs-dir .\exefs\
# .\exefs\.code is your binary — load in Ghidra with ARM:LE:32:v6
```

### Same thing in pure Python with `pyctr`

```python
from pyctr.type.ncch import NCCHReader
ncch = NCCHReader.from_file("game.cxi")
ncch.exefs.extract(".\\exefs")
ncch.romfs.extract(".\\romfs")
```

### Mount a CIA / NCCH as a filesystem (`ninfs`)

```powershell
# requires WinFsp installed
python -m ninfs cia game.cia .\mnt\
# now .\mnt\ contains exefs/, romfs/, header, etc.
```

### Decompile the ARM11 `.code`

```powershell
# Open .\exefs\.code in Ghidra
File → Import File → .code
# Pick processor ARM:LE:32:v6
# Or via headless:
<plugin-root>\skills\ghidra-headless\scripts\ghidra-analyze.ps1 `
  -Binary .\exefs\.code -Processor 'ARM:LE:32:v6' `
  -Script ExportAll.java -Output .\analysis
```

## When to use which tool

| Question                                      | Tool                                                  |
| --------------------------------------------- | ----------------------------------------------------- |
| "What format is this binary?"                 | `rabin2 -I` or `lief` from Python                     |
| "Decompile to C"                              | Ghidra (best decompiler for ARM)                      |
| "Disassemble a region quickly"                | `radare2` `pdf` or `capstone` from Python             |
| "Run this without a real device"              | QEMU (system or user mode)                            |
| "Find an input that triggers branch X"        | `angr` symbolic exec                                  |
| "Does this assemble?"                         | `keystone-engine` (Python) or `arm-none-eabi-as`      |
| "Build a shellcode for ARM"                   | `arm-none-eabi-as` + `objcopy --output-target=binary` |
| "Patch an ELF / PE / Mach-O programmatically" | `lief`                                                |
| "What's at offset X in this NDS ROM?"         | `ndspy`                                               |
| "Mount a 3DS CIA as files"                    | `ninfs`                                               |
| "Drive my live Ghidra session from chat"      | `ghidra` MCP server (`mcp__ghidra__*` tools)          |

## Reference docs

- **gbatek** — `https://problemkaputt.de/gbatek.htm` — DS / DSi / GBA hardware bible. Every register, every BIOS call, every quirk.
- **ARM Architecture Reference Manual (ARM ARM)** — `developer.arm.com/documentation`. Definitive instruction encoding for AArch32/AArch64.
- **Cortex-M reference** — `developer.arm.com/documentation/ddi0403` (Cortex-M3 ARMv7-M).
- **3dbrew** — `https://www.3dbrew.org` — Nintendo 3DS technical wiki (services, IPC commands, file formats).
- **GBATemp / RomHack wikis** — community NDS RE knowledge.
- **azahar emulator source** — `$env:APPDATA\Azahar\source\` (Windows) / equivalent platform-specific Azahar data dir — definitive 3DS service-implementation reference.
- **gbatek-style register list** for NDS — see `NDSLabelList.java` in NTRGhidra source for what's auto-applied.

## Known limitations

- **`pwntools` excludes `unicorn 2.1.3/2.1.4`** — the only cp314-compatible wheels. Installed `--no-deps`. If pwntools enforcement matters, use a Python 3.13 venv.
- **NTRGhidra cannot re-pack to `.nds`** (issue #26 open). Modify in Ghidra → patch source `.nds` separately.
- **NTRGhidra NitroSDK FidB doesn't auto-attach** — manual step in Ghidra UI.
- **3DS encryption** — retail CIAs are signed and CXI partitions encrypted. The `ie3/dumps/` tree is already decrypted; arbitrary CIAs may need keys.
- **`ninfs` needs WinFsp** — install separately via `winget install WinFsp.WinFsp`.

## Memory map quick-reference

### NDS ARM9 (auto-applied by NTRGhidra)

```
0x02000000  Main RAM            4 MB    R/W/X
0x03000000  Shared WRAM        32 KB    R
0x04000000  ARM9 I/O Ports     16 MB    R   (registers; gbatek)
0x05000000  Standard Palettes   2 KB    R
0x06000000  VRAM Engine A BG    2 MB    R
0x06200000  VRAM Engine B BG    2 MB    R
0x06400000  VRAM Engine A OBJ   2 MB    R
0x06600000  VRAM Engine B OBJ   2 MB    R
0x06800000  VRAM LCDC           2 MB    R
0x07000000  OAM                 2 KB    R
0xFFFF0000  ARM9 BIOS           4 KB    R/X
```

### 3DS ARM11 (typical user-process layout)

```
0x00100000  TEXT (.code)
0x00400000  RODATA / DATA / BSS
0x10000000  Heap, mmap regions
0x14000000  GSP shared memory window (graphics)
0x1FF00000  Service shared memory windows
0xC0000000+ Kernel-only (TLS, IPC, etc.)
```

(Per-process; subject to NCCH manifest. `pyctr` can read the manifest to confirm.)
