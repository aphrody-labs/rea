import { open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Options accepted by {@link writeFileAtomic}; the subset of write-file-atomic this package used. */
export interface AtomicWriteOptions {
  readonly encoding?: "utf8";
  readonly mode?: number;
}

/** Windows refuses a rename while another process (indexer, antivirus) briefly holds the target. */
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 6;

async function existingMode(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o7777;
  } catch {
    return undefined;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !RENAME_RETRY_CODES.has(code) || attempt >= RENAME_ATTEMPTS) throw error;
      await Bun.sleep(10 * 2 ** attempt);
    }
  }
}

/**
 * Replace `path` atomically: write a sibling temp file, fsync it, then rename it over the target.
 * Readers see either the old or the new contents, never a partial file. Same-directory temp keeps
 * the rename on one filesystem. Without an explicit `mode`, an existing file keeps its mode (as
 * write-file-atomic does). On Windows the rename is retried briefly on EPERM/EBUSY/EACCES.
 * Drop-in for the `write-file-atomic` default export.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  const preserved = options.mode === undefined ? await existingMode(path) : undefined;
  const mode = options.mode ?? preserved ?? 0o666;
  const handle = await open(temp, "wx", mode);
  try {
    await handle.writeFile(data);
    // open() applies the umask; an existing file's mode is restored exactly.
    if (preserved !== undefined && process.platform !== "win32") await handle.chmod(preserved);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await renameWithRetry(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export default writeFileAtomic;
