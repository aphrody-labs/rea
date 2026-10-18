# Ghidra Suite — Codex plugin

Ghidra Suite is a Codex-native reverse-engineering plugin for Ghidra 12.x. It combines three complementary surfaces:

| Surface                   | Use it for                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ghidra-gui-computer-use` | Safe, visible interaction with Ghidra's Windows GUI: launch, project selection, navigation, and visual review.           |
| `ghidra-mcp-live`         | Structured analysis and user-authorized edits in an already open CodeBrowser through GhidrAssistMCP on `localhost:8080`. |
| `ghidra-headless`         | Reproducible static analysis and exports for files or binary batches without opening the GUI.                            |

The plugin also supplies focused Codex skills for binary triage, malware analysis, vulnerability assessment, decompilation cleanup, firmware, Nintendo DS, Nintendo 3DS, and CTF reverse engineering. `ghidra-workflows` routes common tasks between them.

## Requirements

- Ghidra 12.x
- Java 21 or later
- PowerShell 7+ on Windows (or bash on Linux/macOS) for headless analysis
- Optional but recommended: the GhidrAssistMCP extension, enabled in a running CodeBrowser, for the live MCP tools
- Codex Computer Use for visible Windows GUI interaction

## Codex layout

```text
.codex-plugin/plugin.json          Codex manifest
.mcp.json                          live GhidrAssistMCP configuration
skills/
  ghidra-gui-computer-use/         GUI workflow via Codex Computer Use
  ghidra-mcp-live/                 live MCP workflow
  ghidra-headless/                 platform-native headless scripts + Java exports
  ghidra-workflows/                task router and detailed workflow references
  binary-triage/                   first-pass static analysis
  malware-analyst/                 static malware assessment
  vulnerability-hunter/            authorized vulnerability review
  decompile-cleaner/               rename/type/structure recovery
  firmware-analyst/ ctf-solver/ ds-reverse/ 3ds-reverse/
```

## Usage

Install the repository through a Codex local marketplace or copy it into an existing Codex plugin source tree. Once enabled, start a new Codex task so it discovers the skills and the `ghidra` MCP server.

Ask naturally, for example:

- “Triage `C:\samples\unknown.exe` with Ghidra; do not run it.”
- “Inspect the CodeBrowser currently open on my desktop.”
- “Make the decompilation at `0x140012a0` readable, but do not modify the program.”
- “Run a static vulnerability review on this firmware image.”

## Safety model

All supplied workflows are static-analysis-first and never execute samples. GUI and live-MCP writes—such as byte patches, symbol renames, data-type edits, project overwrite, or deletion—require a precise target and the applicable user confirmation. Prefer the live MCP for structured Ghidra edits and Computer Use for visual tasks or when the server is unavailable.

## License

MIT. The bundled Ghidra headless skill and Java export scripts retain their original Trail of Bits licensing and copyright notices.
