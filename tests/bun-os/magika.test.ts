import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { magikaSetupCommand } from "../../src/ml/magika.js";

describe("Magika ML owner", () => {
  test("uses uv with the pinned upstream source project", () => {
    const command = magikaSetupCommand();
    expect(command.slice(0, 2)).toEqual(["uv", "sync"]);
    expect(command).toContain("--locked");
    expect(command).toContain("--no-dev");
    expect(command.join(" ")).toContain(join("vendor", "magika", "python"));
  });
});
