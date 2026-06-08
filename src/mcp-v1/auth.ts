import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayApiScope } from "../access/types.js";
import type { GatewayMcpActor } from "./types.js";

export interface GatewayMcpAuthInput {
  authorizationHeader?: string;
  identityHeaders: Record<string, string | string[] | undefined>;
  accessStore: GatewayAccessStore;
  authGateAllowedDomains?: string[];
  authGateAllowedUsers?: string[];
}

export type GatewayMcpAuthResult =
  | { ok: true; actor: GatewayMcpActor }
  | { ok: false; statusCode: 401 | 403; reason: "missing_or_invalid_auth" | "missing_scope"; detail: string };

const authGateHeaderPriority = ["x-auth-gate-email", "x-forwarded-email", "x-user-email"] as const;
const authGateScopes: GatewayApiScope[] = ["mcp.read"];

export function authenticateGatewayMcpRequest(input: GatewayMcpAuthInput): GatewayMcpAuthResult {
  const secret = bearerSecret(input.authorizationHeader);
  if (secret !== undefined) {
    const authenticated = input.accessStore.authenticate(secret);
    if (authenticated !== undefined) {
      return {
        ok: true,
        actor: {
          type: "api_client",
          authMethod: "api_key",
          actorId: authenticated.client.id,
          scopes: authenticated.client.scopes as GatewayApiScope[],
          authenticated
        }
      };
    }
  }

  const email = mcpAuthGateEmailFromHeaders(input.identityHeaders);
  if (email !== undefined && isAllowedAuthGateEmail(email, input.authGateAllowedDomains, input.authGateAllowedUsers)) {
    const domain = email.split("@")[1] ?? "";
    return {
      ok: true,
      actor: {
        type: "auth_gate",
        authMethod: "auth_gate",
        actorId: email,
        email,
        domain,
        scopes: authGateScopes
      }
    };
  }

  return { ok: false, statusCode: 401, reason: "missing_or_invalid_auth", detail: "Missing or invalid MCP auth" };
}

export function mcpAuthGateEmailFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  for (const header of authGateHeaderPriority) {
    const value = headers[header];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.trim()) {
      return first.trim().toLowerCase();
    }
  }
  return undefined;
}

function bearerSecret(header: string | undefined): string | undefined {
  const match = (header ?? "").match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

export function isAllowedAuthGateEmail(
  email: string,
  allowedDomains: string[] | undefined,
  allowedUsers: string[] | undefined
): boolean {
  const hasAllowlist = (allowedDomains?.length ?? 0) > 0 || (allowedUsers?.length ?? 0) > 0;
  if (!hasAllowlist) return false;
  if (allowedUsers?.includes(email)) return true;
  const domain = email.split("@")[1] ?? "";
  return allowedDomains?.includes(domain) ?? false;
}
