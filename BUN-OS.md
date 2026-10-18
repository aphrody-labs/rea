# Bun OS integration

This fork owns the REA implementation and the Bun OS reverse-engineering commands.
`packages/re` in the containing Bun OS workspace is a CLI and package-export facade;
it does not contain a second REA implementation. Upstream licenses and histories are
retained here.

The native Bun CLI serves the existing REA tools and the `steam`, `steam-rea`,
`pipeline`, `recompile`, `engine`, `formats`, `bin`, `replica`, `ghidra-win`,
`magika`, `dbxv2` and `game` commands. The MCP server registers the same Bun OS
capability owners. Build the runtime with `bun run build`; run native checking
with `bun check -p tsconfig.json --noEmit`.

Rust execution remains owned by the containing workspace's `crates/re` and
`crates/bun-engine-core`. The pipeline locates that workspace through `BUN_OS_ROOT`
or its ancestor checkout and uses the existing serialized native build owner.
No runtime source is copied into this fork.

Static recompilation currently supports GBA ARMv4T, PlayStation MIPS R3000A and
NES 6502 images. Its WASM output is not a Windows PE x64 execution environment.
DBXV2's WASM bindings decode game assets; the installed Steam game uses the host's
native Steam/Proton execution and the separately qualified Play streaming path.

Provider sessions, credentials, raw game assets and protected evidence remain
outside public source and distribution artifacts.
