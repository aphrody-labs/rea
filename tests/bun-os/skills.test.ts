import { describe, expect, test } from "bun:test";
import {
  listReplicaSkills,
  readReplicaSkill,
  replicaSkillIds,
} from "../../src/replica/skills.js";
import { replicaPipeline } from "../../src/replica/pipeline.js";

describe("Replica skill pack", () => {
  test("exposes the complete ordered workflow", async () => {
    const skills = await listReplicaSkills();
    expect(skills.map(({ id }) => id)).toEqual([...replicaSkillIds]);
    expect(
      skills.every(({ description }) => description.length > 20),
    ).toBeTrue();
  });

  test("reads a skill by full name or short alias", async () => {
    expect(await readReplicaSkill("replica-recon")).toContain(
      "# replica-recon",
    );
    expect(await readReplicaSkill("recon")).toContain("# replica-recon");
  });

  test("rejects unknown skills", async () => {
    await expect(readReplicaSkill("missing")).rejects.toThrow(
      "unknown Replica skill",
    );
  });

  test("connects every stage to the unified pipeline", async () => {
    const pipeline = await replicaPipeline();
    expect(pipeline).toHaveLength(11);
    expect(pipeline[0]?.requires).toBeNull();
    expect(pipeline.at(-1)?.requires).toBe("replica-launch");
    expect(pipeline.every(({ artifacts }) => artifacts.length > 0)).toBeTrue();
  });
});
