import type { GatewayConnectionContext } from "../access/connection-tokens.js";
import type { GatewayState } from "../admin/types.js";
import { toConnectionApiResource } from "../api/resources.js";
import type { GatewayAppInstallStore } from "../apps/store.js";
import type { GatewayAppInstallStatus } from "../apps/types.js";
import type { GatewayMcpToolResult, McpToolDefinition, ScopedToolMode } from "./types.js";

type ToolArgs = Record<string, unknown>;

interface ConnectionScopedToolDefinition extends McpToolDefinition {
  mode: ScopedToolMode;
}

export const READ_ONLY_MODE: ScopedToolMode = "read";

export const connectionScopedTools: ConnectionScopedToolDefinition[] = [
  {
    name: "connection_get",
    mode: "read",
    description: "Get this connection's metadata.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "connection_status",
    mode: "read",
    description: "Get this connection's status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "connection_list_app_installs",
    mode: "read",
    description: "List app installs for this connection's brand+region.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["pending", "enabled", "disabled", "error"] } },
      additionalProperties: false
    }
  }
];

export async function callConnectionScopedTool(
  name: string,
  args: unknown,
  context: GatewayConnectionContext,
  state: GatewayState,
  appInstallStore?: GatewayAppInstallStore
): Promise<GatewayMcpToolResult> {
  try {
    const definition = connectionScopedTools.find((tool) => tool.name === name);
    if (definition === undefined || definition.mode !== READ_ONLY_MODE) {
      return toolError(`Unknown or non-read tool: ${name}`);
    }

    const scoped = filterStateToConnection(state, context);
    switch (name) {
      case "connection_get":
        return connectionGet(scoped, context);
      case "connection_status":
        return connectionStatus(scoped, context);
      case "connection_list_app_installs":
        return connectionListAppInstalls(args, context, appInstallStore);
      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return toolError(error instanceof Error ? error.message : "Connection MCP tool failed");
  }
}

export function filterStateToConnection(state: GatewayState, context: GatewayConnectionContext): GatewayState {
  const connection = state.connections.find((candidate) => candidate.id === context.connectionId);
  const brand = state.brands.find((candidate) => candidate.id === context.brandId);
  const region = state.regions.find((candidate) => candidate.id === context.regionId);
  const connector = connection === undefined
    ? undefined
    : state.connectors.find((candidate) => candidate.id === connection.connectorId && candidate.slug === context.connectorSlug);

  return {
    brands: brand === undefined ? [] : [{ ...brand }],
    regions: region === undefined ? [] : [{ ...region }],
    connectors: connector === undefined ? [] : [{ ...connector }],
    connections: connection === undefined ? [] : [{ ...connection }],
    apiClients: [],
    auditEvents: [],
    entityMeta: state.entityMeta?.filter(
      (meta) => meta.entityType === "connection" && meta.entityId === context.connectionId
    )
  };
}

function connectionGet(state: GatewayState, context: GatewayConnectionContext): GatewayMcpToolResult {
  const connection = state.connections.find((candidate) => candidate.id === context.connectionId);
  if (connection === undefined) {
    return toolError(`Connection not found: ${context.connectionId}`);
  }
  return toolSuccess(
    { connection: toConnectionApiResource(state, connection) },
    `Found connection ${connection.displayName}.`
  );
}

function connectionStatus(state: GatewayState, context: GatewayConnectionContext): GatewayMcpToolResult {
  const connection = state.connections.find((candidate) => candidate.id === context.connectionId);
  if (connection === undefined) {
    return toolError(`Connection not found: ${context.connectionId}`);
  }
  const resource = toConnectionApiResource(state, connection);
  const status: Record<string, unknown> = {
    connectionId: connection.id,
    status: connection.status,
    runtimeStatus: resource.runtimeStatus,
    migrationStatus: resource.migrationStatus
  };
  if (connection.lastTestedAt !== undefined) status.lastTestedAt = connection.lastTestedAt;
  if (connection.lastUsedAt !== undefined) status.lastUsedAt = connection.lastUsedAt;
  if (connection.status === "connected" && connection.lastError !== undefined) {
    status.lastError = connection.lastError;
  }
  return toolSuccess({ status }, `Connection status is ${connection.status}.`);
}

function connectionListAppInstalls(
  args: unknown,
  context: GatewayConnectionContext,
  appInstallStore?: GatewayAppInstallStore
): GatewayMcpToolResult {
  if (appInstallStore === undefined) {
    return toolError("App install store not configured");
  }
  const parsed = asArgs(args);
  const status = optionalEnum(parsed.status, "status", ["pending", "enabled", "disabled", "error"] as const);
  const installs = appInstallStore.listInstalls({
    brandId: context.brandId,
    regionId: context.regionId,
    status
  });
  return toolSuccess({ installs }, countText("app install", installs.length));
}

function asArgs(args: unknown): ToolArgs {
  if (args === undefined || args === null) return {};
  if (typeof args === "object" && !Array.isArray(args)) return args as ToolArgs;
  throw new Error("arguments must be an object");
}

function optionalEnum<T extends GatewayAppInstallStatus>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value as T;
}

function toolSuccess(structuredContent: Record<string, unknown>, text: string): GatewayMcpToolResult {
  return { content: [{ type: "text", text }], structuredContent, isError: false };
}

function toolError(text: string): GatewayMcpToolResult {
  return { content: [{ type: "text", text }], structuredContent: {}, isError: true };
}

function countText(noun: string, count: number): string {
  return `Found ${count} ${noun}${count === 1 ? "" : "s"}.`;
}
