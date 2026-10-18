import { join } from "node:path";

const replicaRoot = join(import.meta.dir, "..", "..", "plugin", "skills");

export const replicaSkillIds = [
  "replica-recon",
  "replica-architect",
  "replica-design",
  "replica-build",
  "replica-backend",
  "replica-test",
  "replica-diff",
  "replica-entrepreneur",
  "replica-brand",
  "replica-launch",
  "replica-deploy",
] as const;

export type ReplicaSkillId = (typeof replicaSkillIds)[number];

export interface ReplicaSkill {
  id: ReplicaSkillId;
  path: string;
  description: string;
}

export function resolveReplicaSkillId(value: string): ReplicaSkillId {
  const id = value.startsWith("replica-") ? value : `replica-${value}`;
  if (!replicaSkillIds.includes(id as ReplicaSkillId)) {
    throw new TypeError(`unknown Replica skill: ${value}`);
  }
  return id as ReplicaSkillId;
}

function extractDescription(source: string): string {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
  const lines = frontmatter.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.startsWith("description:"));
  if (start < 0) return "";
  const description = [
    lines[start]!.slice("description:".length).replace(/^\s*>-?\s*/u, ""),
  ];
  for (const line of lines.slice(start + 1)) {
    if (/^[a-z][\w-]*:/iu.test(line)) break;
    description.push(line.trim());
  }
  return description.filter(Boolean).join(" ");
}

export async function readReplicaSkill(value: string): Promise<string> {
  const id = resolveReplicaSkillId(value);
  const path = join(replicaRoot, id, "SKILL.md");
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw new Error(`Replica skill source is missing: ${path}`);
  return file.text();
}

export async function listReplicaSkills(): Promise<ReplicaSkill[]> {
  return Promise.all(
    replicaSkillIds.map(async (id) => {
      const path = join(replicaRoot, id, "SKILL.md");
      return {
        id,
        path,
        description: extractDescription(await Bun.file(path).text()),
      };
    }),
  );
}
