---
name: static-recompile
description: Statically recompile console BIOS and ROM images (Game Boy Advance ARMv4T ARM/Thumb, PlayStation MIPS R3000A BIOS and PS-EXE, NES 6502) to native executables and WebAssembly with `re recompile`, and prove the result against the interpreter.
---

`re recompile` (also `bun-engine recompile`, MCP tool `re_recompile`) drives `bunre recompile`, the recompilation path of the bun-re pipeline (`crates/re/src/pipeline`):

1. **lift**: `lift_armv4t` (GBA ROM plus the BIOS vectors), `lift_mips` (PlayStation BIOS at `0xBFC00000` plus the PS-EXE text) or `lift_6502` (fixed iNES PRG banks) discover code by recursive descent and lower each instruction to guest semantics (`sem.rs`: temporaries, guest registers and flags, bus loads/stores with access kinds, runtime helpers). Instructions the lifter does not translate (PSR transfers, SWI, COP0/GTE, exceptions, unofficial opcodes) become `Fallback` and run in the core interpreter.
2. **emit**: `emit_guest` writes a Cargo crate: one Rust function per block over `bun_engine::recomp::<machine>::Rt`, a `lookup` table, `src/main.rs` (headless runner) and `wasm32` exports.
3. **rebuild**: Cargo through the serialized wrapper builds `--target exe` (host) or `--target wasm` (`wasm32-unknown-unknown`, run under Bun).
4. **verify**: the build runs translated and interpreter-only, and `bun-engine run` runs the original image; the frame buffers (and console output) must be identical, and `translated-code-ran` reports how many instructions ran in translated code.

## Usage

```
re recompile game.gba --target exe --out out/gba                 # free Normmatt BIOS by default
re recompile test.exe --bios openbios.bin --target wasm --out out/psx
re recompile openbios.bin --machine psx --target exe --out out/bios   # the BIOS itself (shell boot)
re recompile cart.nes --target exe --out out/nes --frames 600
```

`--no-build` stops after emitting the crate (`out/crate`). `--input start@120-124,right@300-600` scripts the pad for both verification runs (executables; the `bun-engine run` reference is skipped because it takes no input), which drives gameplay code past title screens. The built executable takes the same `--frames N --out DIR --interp --input ... --json` flags. Results: `out/report.json`, `out/lift/ir.json`, `out/bin/*`, `out/verify/{recompiled,interpreter,bun-engine}/screen0.ppm`.

## Replays

`re replica record nes cart.nes --frames 600 --input start@120-124` records the interpreter run (image SHA-256, input, per-frame screen digests); `re replica replay <file>` reruns it and reports the first diverging frame. Pair it with the recompiled executable run with the same `--input` and `--out` when a lifter change must not alter behaviour.

## Reading the result

- Exit 0 only when `recompile-verify` is `ok`. Never claim success from the lift or build alone.
- `nativeRatio` near 1 means the translated code carried the run; interpreted steps are code the static pass did not reach (indirect calls, code copied to RAM such as the PlayStation kernel, bank-switched NES code guarded by `code_hash`).
- Translated code reproduces every bus access of the interpreter (instruction fetches, dummy reads, access kinds), so device timing is identical; a frame-buffer difference is a lifter bug: bisect by forcing `Fallback` on an instruction class and rerun.
- The generated crate links the same device models (`vendor/rustboyadvance-ng`, `vendor/starpsx`, `vendor/tetanes` through `crates/bun-engine-core`), so only free or user-owned images may be recompiled and distributed builds embed the image.
