import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../src/audit/audit-log.js";

describe("AuditLog", () => {
  it("appends JSONL records with timestamps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "template-gateway-audit-"));
    const path = join(dir, "audit.jsonl");
    const audit = new AuditLog(path);

    await audit.append({ provider: "gateway", action: "doctor", status: "ok" });

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      provider: "gateway",
      action: "doctor",
      status: "ok"
    });
    expect(JSON.parse(lines[0]).ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
