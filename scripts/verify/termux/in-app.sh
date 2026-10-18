#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

report="$HOME/rea-ci"
exec > "$report/run.log" 2>&1
# Publish the result only after all commands have settled. The host reads it as
# root; no shared-storage permission or helper Android application is needed.
trap 'result=$?; printf "%s\n" "$result" > "$report/status"' EXIT
set -x
[[ "$(id -u)" != 0 ]]
export DEBIAN_FRONTEND=noninteractive
export HUSKY=0
pkg update -y
pkg upgrade -y
pkg install -y nodejs-lts npm git x11-repo termux-exec
pkg install -y chromium
mkdir -p "$report/source"
tar -xf "$report/source.tar" -C "$report/source"
cd "$report/source"
node -e 'if (process.platform !== "android") throw new Error("Expected Android Node.js")'
# Android uses Termux's Bionic-linked Node distribution; the Bun runtime has no
# Bionic build, so this manual lane installs the dependency tree with npm.
export PATH="$report/toolchain/node_modules/.bin:$PATH"
node --version
npm --version
dpkg-query -W nodejs-lts chromium termux-exec
bun install --no-package-lock --ignore-scripts
bun run build:termux
unset PLAYWRIGHT_BROWSERS_PATH npm_config_playwright_browsers_path npm_package_config_playwright_browsers_path
bun scripts/verify/termux/browser.mjs
