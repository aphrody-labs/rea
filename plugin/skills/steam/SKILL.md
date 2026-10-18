---
name: steam
description: Steam on Bun OS through bun-steam - client config, steamcmd with the cached session, libraries, Proton (GE, CachyOS, Valve, official anti-cheat runtimes) and launch tuning, Remote Play, VDF, depots, and the local Steam index (SQLite).
---

Use `bun-steam <command> [--json]` (`bun packages/bun-steam/src/cli.ts`, also `re steam <command>`) or the `steam_*` tools of the `re` MCP server. `bun-steam --help` lists client, steamcmd, libraries, proton, launch, remoteplay, vdf and depot commands. Index commands:

- `scan` indexes install, libraries, appinfo/packageinfo, manifests, PE files, userdata, cloud, logs, registry (whitelist) into `~/.aphrody/db/steam.sqlite`.
- `stats`, `sql "<SELECT>"` query it (read-only).
- `api sync` indexes Web API methods (GetSupportedAPIList without key, SteamTracking API dumps), Protobufs service RPCs, CM/content directories, store details and local PICS; `api search|show|diff` query it. Never crawl steamdb.info.
- `re steam-rea <appid>` runs the RE pipeline on the installed executable; `classify <file>` detects file types.
- `re bin <exe> --json` (MCP `binary_inspect`) gives a read-only first pass over a game or client executable (imports per DLL, version resource, Authenticode, strings, Steam app provenance); MCP `steam_appinfo` decodes one app of `appcache/appinfo.vdf` and `steam_manifest` a depot manifest (`depotcache/*.manifest`).
- `remote-download <appid> --host vps --dest <dir>` installs with steamcmd on the host, pulls with parallel rclone streams.

Never read or quote `local.vdf`, `ssfn*`, `ConnectCache` values, passwords, tokens, cookies or friend/chat data. bun-steam reads only account names and flags from `loginusers.vdf` and `CompatToolMapping` from `config.vdf`; the index records secret files by existence, size and date in `secret_artifact`. Never type or pass Steam credentials: steamcmd reuses the session the owner opened interactively.
