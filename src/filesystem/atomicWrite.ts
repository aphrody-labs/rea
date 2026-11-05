import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Options accepted by {@link writeFileAtomic}; the subset of write-file-atomic this package used. */
export interface AtomicWriteOptions {
  readonly encoding?: "utf8";
  readonly mode?: number;
}

/**
 * Replace `path` atomically: write a sibling temp file, fsync it, then rename it over the target.
 * Readers see either the old or the new contents, never a partial file. Same-directory temp keeps
 * the rename on one filesystem. Drop-in for the `write-file-atomic` default export.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  const handle = await open(temp, "wx", options.mode ?? 0o666);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export default writeFileAtomic;
