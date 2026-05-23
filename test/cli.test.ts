import { describe, expect, it } from "vitest";
import { buildCli } from "../src/cli.js";

describe("buildCli", () => {
  it("prints doctor output", async () => {
    const output: string[] = [];
    const cli = buildCli({ write: (line) => output.push(line) });
    await cli.parseAsync(["node", "gateway", "doctor"], { from: "node" });
    expect(output.join("\n")).toContain("template-gateway: ok");
  });

  it("prints provider output", async () => {
    const output: string[] = [];
    const cli = buildCli({ write: (line) => output.push(line) });
    await cli.parseAsync(["node", "gateway", "providers"], { from: "node" });
    expect(output.join("\n")).toContain("No providers configured");
  });
});
