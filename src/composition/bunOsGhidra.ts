// SPDX-License-Identifier: Apache-2.0
/** Construct the Windows provider at the composition boundary, only on demand. */
export async function probeBunOsGhidra() {
  const { probeGhidraWindows } = await import("../ghidra/windows.js");
  return probeGhidraWindows();
}
