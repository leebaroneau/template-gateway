import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  it("returns no recent records when the log file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "template-gateway-audit-"));
    const audit = new AuditLog(join(dir, "audit.jsonl"));

    await expect(audit.recent()).resolves.toEqual([]);
  });

  it("returns recent JSONL records in file order with the requested limit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "template-gateway-audit-"));
    const path = join(dir, "audit.jsonl");
    const audit = new AuditLog(path);

    await writeFile(
      path,
      [
        JSON.stringify({ ts: "2026-05-23T00:00:00.000Z", provider: "gateway", action: "first", status: "ok" }),
        JSON.stringify({ ts: "2026-05-23T00:01:00.000Z", provider: "crm", action: "second", status: "denied" }),
        JSON.stringify({ ts: "2026-05-23T00:02:00.000Z", provider: "mail", action: "third", status: "error" })
      ].join("\n"),
      "utf8"
    );

    expect(await audit.recent(2)).toEqual([
      { ts: "2026-05-23T00:01:00.000Z", provider: "crm", action: "second", status: "denied" },
      { ts: "2026-05-23T00:02:00.000Z", provider: "mail", action: "third", status: "error" }
    ]);
  });
});
