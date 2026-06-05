import type { ApiClient, ApiKey, AuditEvent } from "../admin/types.js";

export const gatewayApiScopes = [
  "brands.read",
  "regions.read",
  "connectors.read",
  "connections.read",
  "mcp.read",
  "api_clients.read",
  "api_clients.write",
  "audit.read",
  "apps.read",
  "apps.write"
] as const;

export type GatewayApiScope = (typeof gatewayApiScopes)[number];
export type GatewayApiClientType = ApiClient["type"];
export type GatewayApiClientStatus = ApiClient["status"];
export type GatewayApiKeyStatus = ApiKey["status"];

export interface CreateApiClientInput {
  name: string;
  type: GatewayApiClientType;
  owner: string;
  scopes: GatewayApiScope[];
}

export interface UpdateApiClientInput {
  name?: string;
  type?: GatewayApiClientType;
  owner?: string;
  scopes?: GatewayApiScope[];
  status?: GatewayApiClientStatus;
}

export interface CreateApiKeyInput {
  label: string;
}

export interface ApiKeyWithSecret {
  key: ApiKey;
  secret: string;
}

export interface AuthenticatedGatewayApiClient {
  client: ApiClient;
  key: ApiKey;
}

export interface RecordApiUsageInput {
  clientId?: string;
  keyId?: string;
  route: string;
  method: string;
  statusCode: number;
  scope?: GatewayApiScope;
  durationMs?: number;
}

export interface AccessAuditInput {
  action: AuditEvent["action"];
  targetType: AuditEvent["targetType"];
  targetId: string;
  detail: string;
  actor: string;
  metadata?: Record<string, string>;
}

export function isGatewayApiScope(value: string): value is GatewayApiScope {
  return (gatewayApiScopes as readonly string[]).includes(value);
}

export function validateGatewayApiScopes(values: unknown): GatewayApiScope[] {
  if (!Array.isArray(values)) {
    throw new Error("scopes must be an array");
  }

  const scopes = values.map((value) => {
    if (typeof value !== "string" || !isGatewayApiScope(value)) {
      throw new Error(`Unknown API scope: ${String(value)}`);
    }
    return value;
  });

  return Array.from(new Set(scopes));
}

export function scopeAllowed(clientScopes: readonly string[], requiredScope: GatewayApiScope): boolean {
  if (requiredScope === "api_clients.read" && clientScopes.includes("api_clients.write")) {
    return true;
  }
  if (requiredScope === "apps.read" && clientScopes.includes("apps.write")) {
    return true;
  }
  return clientScopes.includes(requiredScope);
}
