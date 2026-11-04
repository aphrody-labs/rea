import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface ManifestValidation {
  valid: boolean;
  manifestPath: string;
  id?: string;
  name?: string;
  version?: string;
  checkedFiles: number;
  errors: string[];
}

type JsonObject = Record<string, unknown>;
const obj = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const sha256 = /^[a-f0-9]{64}$/i;

function safeRelative(value: string): boolean {
  if (!value || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export async function validateModManifest(manifestFile: string): Promise<ManifestValidation> {
  const manifestPath = await realpath(resolve(manifestFile));
  const root = dirname(manifestPath);
  const errors: string[] = [];
  let manifest: JsonObject;
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!obj(parsed)) throw new Error("manifest root must be a JSON object");
    manifest = parsed;
  } catch (error) {
    return { valid: false, manifestPath, checkedFiles: 0, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const id = string(manifest.id) ? manifest.id : undefined;
  const name = string(manifest.name) ? manifest.name : undefined;
  const version = string(manifest.version) ? manifest.version : undefined;
  if (!id || !/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(id)) errors.push("id must be a stable 2–128 character package identifier");
  if (!name || name.trim().length < 1 || name.length > 160) errors.push("name must contain 1–160 characters");
  if (!version || !semver.test(version)) errors.push("version must use semantic versioning (major.minor.patch)");
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!string(manifest.license) || !manifest.license.trim()) errors.push("license is required");
  if (!obj(manifest.game) || !string(manifest.game.id) || !manifest.game.id.trim()) errors.push("game.id is required");
  if (!obj(manifest.source) || !string(manifest.source.url) || !/^https:\/\//i.test(manifest.source.url)) errors.push("source.url must be an HTTPS URL");
  const install = obj(manifest.install) ? manifest.install : undefined;
  if (!install || !["overlay", "archive", "patch"].includes(String(install.mode))) errors.push("install.mode must be overlay, archive, or patch");
  if (install && (!Number.isSafeInteger(install.priority) || Number(install.priority) < 0)) errors.push("install.priority must be a non-negative integer");

  const files = install?.files;
  if (!Array.isArray(files) || files.length === 0) errors.push("install.files must contain at least one payload record");
  let checkedFiles = 0;
  const destinations = new Set<string>();
  if (Array.isArray(files)) {
    for (const [index, candidate] of files.entries()) {
      if (!obj(candidate) || !string(candidate.source) || !string(candidate.destination) || !string(candidate.sha256)) {
        errors.push(`install.files[${index}] requires source, destination, and sha256`);
        continue;
      }
      if (!safeRelative(candidate.source)) errors.push(`install.files[${index}].source must be a safe relative path`);
      if (!safeRelative(candidate.destination)) errors.push(`install.files[${index}].destination must be a safe relative path`);
      if (!sha256.test(candidate.sha256)) errors.push(`install.files[${index}].sha256 must be a 64-digit SHA-256`);
      const destinationKey = candidate.destination.toLocaleLowerCase("en-US");
      if (destinations.has(destinationKey)) errors.push(`duplicate destination: ${candidate.destination}`);
      destinations.add(destinationKey);
      if (!safeRelative(candidate.source) || !sha256.test(candidate.sha256)) continue;
      try {
        const sourcePath = await realpath(resolve(root, candidate.source));
        const rel = relative(root, sourcePath);
        if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          errors.push(`install.files[${index}].source resolves outside the package`);
          continue;
        }
        const digest = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
        if (digest.toLowerCase() !== candidate.sha256.toLowerCase()) errors.push(`SHA-256 mismatch: ${candidate.source}`);
        else checkedFiles += 1;
      } catch (error) {
        errors.push(`cannot verify ${candidate.source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { valid: errors.length === 0, manifestPath, ...(id ? { id } : {}), ...(name ? { name } : {}), ...(version ? { version } : {}), checkedFiles, errors };
}
