import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { magikaSetupCommand } from "../../src/ml/magika.js";

describe("Magika ML owner", () => {
  test("installs only through Bun UV and the pinned source project", () => {
    const command = magikaSetupCommand();
    expect(command.slice(0, 3)).toEqual(["bun", "uv", "sync"]);
    expect(command).toContain("--locked");
    expect(command).toContain("--no-dev");
    expect(command.join(" ")).toContain(join("vendor", "magika", "python"));
  });
});
