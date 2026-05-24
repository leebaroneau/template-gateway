import { dirname, join } from "node:path";
import type { GatewayConfig } from "../../config.js";
import { AuditLog } from "../../audit/audit-log.js";
import { MicrosoftProviderService } from "./service.js";
import { MicrosoftOAuthStateStore } from "./state-store.js";
import { MicrosoftTokenStore } from "./token-store.js";

export function createMicrosoftProviderService(config: GatewayConfig): MicrosoftProviderService {
  const auditLog = new AuditLog(config.auditLogPath);
  return new MicrosoftProviderService({
    config: config.microsoft,
    stateStore: new MicrosoftOAuthStateStore(join(dirname(config.microsoft.tokenStorePath), "microsoft-oauth-states.json")),
    tokenStore: new MicrosoftTokenStore(config.microsoft.tokenStorePath, config.microsoft.tokenStoreKey),
    audit: async (entry) => {
      const { provider, tool, actor, status, ...rest } = entry;
      const auditStatus: "ok" | "denied" | "error" =
        status === "ok" ? "ok"
        : status === "denied" ? "denied"
        : "error";
      const details: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) details[key] = value;
      }
      if (status === "reconnect_required") details.kind = "reconnect_required";
      await auditLog.append({
        provider,
        action: tool,
        status: auditStatus,
        actorEmail: actor,
        details: Object.keys(details).length > 0 ? details : undefined
      });
    }
  });
}
