import type { GatewayConnectionContext } from "../access/connection-tokens.js";
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayApiScope } from "../access/types.js";
import type { GatewayState } from "../admin/types.js";
import { isAllowedAuthGateEmail, mcpAuthGateEmailFromHeaders } from "./auth.js";
import type { ConnectionMcpActor } from "./types.js";

export interface GatewayConnectionMcpAuthInput {
  connectionId: string;
  authorizationHeader?: string;
  identityHeaders: Record<string, string | string[] | undefined>;
  accessStore: GatewayAccessStore;
  state: GatewayState;
  authGateAllowedDomains?: string[];
  authGateAllowedUsers?: string[];
}

export type GatewayConnectionMcpAuthResult =
  | { ok: true; actor: ConnectionMcpActor }
  | {
      ok: false;
      statusCode: 401 | 403 | 404;
      reason: "missing_or_invalid_auth" | "not_found" | "connection_unavailable" | "stale_token_context";
      detail: string;
    };

const authGateScopes: GatewayApiScope[] = ["mcp.read"];

export function authenticateGatewayConnectionMcpRequest(
  input: GatewayConnectionMcpAuthInput
): GatewayConnectionMcpAuthResult {
  const context = contextFromState(input.state, input.connectionId);
  if (context === undefined) {
    return { ok: false, statusCode: 404, reason: "not_found", detail: `Connection not found: ${input.connectionId}` };
  }
  const connection = input.state.connections.find((candidate) => candidate.id === input.connectionId);
  if (connection?.status !== "connected") {
    return {
      ok: false,
      statusCode: 403,
      reason: "connection_unavailable",
      detail: `Connection is unavailable: ${input.connectionId}`
    };
  }

  const secret = bearerSecret(input.authorizationHeader);
  if (secret !== undefined) {
    const authenticated = input.accessStore.authenticateConnectionToken(input.connectionId, secret);
    if (authenticated !== undefined) {
      if (!sameContext(authenticated.record, context)) {
        return {
          ok: false,
          statusCode: 403,
          reason: "stale_token_context",
          detail: `Connection token context is stale: ${input.connectionId}`
        };
      }
      return {
        ok: true,
        actor: {
          type: "connection_token",
          authMethod: "connection_token",
          actorId: authenticated.record.id,
          context: authenticated.record,
          scopes: authenticated.client.scopes as GatewayApiScope[],
          tokenId: authenticated.record.id,
          apiKeyId: authenticated.record.apiKeyId,
          clientId: authenticated.record.clientId
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
        context,
        scopes: authGateScopes
      }
    };
  }

  return { ok: false, statusCode: 401, reason: "missing_or_invalid_auth", detail: "Missing or invalid connection MCP auth" };
}

export function contextFromState(state: GatewayState, connectionId: string): GatewayConnectionContext | undefined {
  const connection = state.connections.find((candidate) => candidate.id === connectionId);
  if (connection === undefined) {
    return undefined;
  }
  const connector = state.connectors.find((candidate) => candidate.id === connection.connectorId);
  if (connector === undefined) {
    return undefined;
  }
  return {
    connectionId: connection.id,
    brandId: connection.brandId,
    regionId: connection.regionId,
    connectorSlug: connector.slug
  };
}

function sameContext(left: GatewayConnectionContext, right: GatewayConnectionContext): boolean {
  return (
    left.connectionId === right.connectionId &&
    left.brandId === right.brandId &&
    left.regionId === right.regionId &&
    left.connectorSlug === right.connectorSlug
  );
}

function bearerSecret(header: string | undefined): string | undefined {
  const match = (header ?? "").match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}
