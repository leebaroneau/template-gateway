import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type AuditStatus = "ok" | "error" | "denied";

export interface AuditRecord {
  provider: string;
  action: string;
  status: AuditStatus;
  actorEmail?: string;
  details?: Record<string, unknown>;
}

export class AuditLog {
  constructor(private readonly path: string) {}

  async append(record: AuditRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, "utf8");
  }

  async recent(limit = 50): Promise<Array<AuditRecord & { ts: string }>> {
    try {
      const lines = (await readFile(this.path, "utf8")).trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((line) => JSON.parse(line));
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }
}
