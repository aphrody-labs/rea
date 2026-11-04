# yolo-re integration

This checkout is the REA engine submodule in the yolo-re workspace. Its CLI is
reached through the root dispatcher; the Rust RE core and Steam readers are
local yolo-re workspace packages rather than dependencies in Bun OS.

```powershell
bun run re --help
bun run re ghidra-win probe
bun run re magika setup
bun run re magika identify .\sample.exe
bun run replica skills
```

Ghidra is an upstream, bring-your-own runtime. The local provider uses
`GHIDRA_INSTALL_DIR` (or `GHIDRA_HOME`) and `JAVA_HOME`; it does not install or
upgrade Ghidra or Java. The user's configured runtime is Ghidra 12.1.4; the
REA bridge also accepts 12.2.x, validated separately on Windows x64/JDK 25.
The workspace's separate source gitlink is pinned to the official Ghidra 12.2
release commit `8ca9077040cc43cd790babcfccf19475622a3e9a`; source and runtime
versions are intentionally distinct. Initialize that large source checkout
only when you need to build Ghidra itself or its source-dependent extensions:

```powershell
git submodule update --init --depth 1 -- vendor/ghidra
```

Magika uses Google's upstream Python source submodule at `vendor/magika`, pinned
to upstream commit `d92b3c5f6c35cc4dcaea3aaa51ec1a3350130405`, and its locked
`python/uv.lock`. Run `bun run re magika setup` to create the upstream project's
local virtual environment; this requires `uv` and a working Rust toolchain for
the upstream PyO3 extension. The setup does not install Rust, Visual Studio, or
unrelated software. Magika model inference runs through its upstream Python
API; it is not a file-extension heuristic or local stub.

Update upstream source pins deliberately, then validate the REA provider and
the affected upstream project's own lock/build before changing the gitlink:

```powershell
git -C vendor/ghidra fetch origin
git -C vendor/magika fetch origin
```

Both upstreams' Apache-2.0 notices and licenses remain with their source trees.
