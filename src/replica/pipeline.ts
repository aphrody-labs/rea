import {
  listReplicaSkills,
  type ReplicaSkill,
  type ReplicaSkillId,
  replicaSkillIds,
} from "./skills.js";

const artifacts: Record<ReplicaSkillId, readonly string[]> = {
  "replica-recon": [
    "replica/recon.md",
    "replica/features.csv",
    "replica/screens/",
  ],
  "replica-architect": ["replica/architecture.md"],
  "replica-design": ["replica/design/tokens.json"],
  "replica-build": ["replica/build/"],
  "replica-backend": ["replica/backend.md"],
  "replica-test": ["replica/test-plan.md", "replica/bugs.md"],
  "replica-diff": ["replica/parity.md"],
  "replica-entrepreneur": ["replica/opportunities.md"],
  "replica-brand": ["replica/brand.md"],
  "replica-launch": ["replica/launch/"],
  "replica-deploy": ["replica/deploy.md"],
};

export interface ReplicaPipelineStage extends ReplicaSkill {
  index: number;
  requires: ReplicaSkillId | null;
  artifacts: readonly string[];
}

export async function replicaPipeline(): Promise<ReplicaPipelineStage[]> {
  const skills = new Map(
    (await listReplicaSkills()).map((skill) => [skill.id, skill]),
  );
  return replicaSkillIds.map((id, index) => ({
    ...skills.get(id)!,
    index,
    requires: replicaSkillIds[index - 1] ?? null,
    artifacts: artifacts[id],
  }));
}
