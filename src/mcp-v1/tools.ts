import type { GatewayApiScope } from "../access/types.js";
import type {
  AuthMode,
  ConnectionStatus,
  ConnectorCategory,
  EntityStatus,
  GatewayBackendType,
  GatewayState
} from "../admin/types.js";
import { toGatewayApiResources } from "../api/resources.js";
import type { GatewayConnectionApiResource } from "../api/resources.js";
import type { GatewayMcpToolResult, McpToolDefinition } from "./types.js";

type ToolArgs = Record<string, unknown>;

const entityStatuses: EntityStatus[] = ["active", "disabled"];
const connectionStatuses: ConnectionStatus[] = ["needs_config", "pending", "connected", "needs_reconnect", "error"];
const setupModes = ["current", "manual_ref", "oauth_managed"] as const;
const backendTypes: GatewayBackendType[] = ["nango", "composio", "native", "internal"];
const connectorCategories: ConnectorCategory[] = ["commerce", "analytics", "marketing", "crm", "productivity", "internal"];
const authModes: AuthMode[] = ["oauth", "api_key", "service_account", "none"];

export const gatewayMcpTools: McpToolDefinition[] = [
  {
    name: "gateway_list_brands",
    description: "List Haverford Gateway brands.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: entityStatuses }
      },
      additionalProperties: false
    }
  },
  {
    name: "gateway_list_regions",
    description: "List Haverford Gateway regions, optionally filtered by brand.",
    inputSchema: {
      type: "object",
      properties: {
        brandId: { type: "string" },
        status: { type: "string", enum: entityStatuses }
      },
      additionalProperties: false
    }
  },
  {
    name: "gateway_list_connectors",
    description: "List connector definitions available to Haverford Gateway connections.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: connectorCategories },
        backendType: { type: "string", enum: backendTypes },
        authMode: { type: "string", enum: authModes }
      },
      additionalProperties: false
    }
  },
  {
    name: "gateway_list_connections",
    description: "List Haverford Gateway connections under the Brand > Region > Connector hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        brandId: { type: "string" },
        regionId: { type: "string" },
        connectorId: { type: "string" },
        status: { type: "string", enum: connectionStatuses },
        setupMode: { type: "string", enum: setupModes }
      },
      additionalProperties: false
    }
  },
  {
    name: "gateway_get_connection",
    description: "Get one Haverford Gateway connection by id.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" }
      },
      required: ["connectionId"],
      additionalProperties: false
    }
  },
  {
    name: "gateway_find_connections",
    description: "Search Haverford Gateway connections by local metadata.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
];

const toolScopes: Record<string, GatewayApiScope> = {
  gateway_list_brands: "brands.read",
  gateway_list_regions: "regions.read",
  gateway_list_connectors: "connectors.read",
  gateway_list_connections: "connections.read",
  gateway_get_connection: "connections.read",
  gateway_find_connections: "connections.read"
};

export function requiredScopeForGatewayMcpTool(name: string): GatewayApiScope | undefined {
  return toolScopes[name];
}

export async function callGatewayMcpTool(
  name: string,
  args: unknown,
  state: GatewayState
): Promise<GatewayMcpToolResult> {
  try {
    const parsedArgs = asArgs(args);
    switch (name) {
      case "gateway_list_brands":
        return listBrands(parsedArgs, state);
      case "gateway_list_regions":
        return listRegions(parsedArgs, state);
      case "gateway_list_connectors":
        return listConnectors(parsedArgs, state);
      case "gateway_list_connections":
        return listConnections(parsedArgs, state);
      case "gateway_get_connection":
        return getConnection(parsedArgs, state);
      case "gateway_find_connections":
        return findConnections(parsedArgs, state);
      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return toolError(error instanceof Error ? error.message : "MCP tool failed");
  }
}

function listBrands(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const status = optionalEnum(args.status, "status", entityStatuses);
  const brands = state.brands.filter((brand) => status === undefined || brand.status === status);
  return toolSuccess({ brands }, countText("brand", brands.length));
}

function listRegions(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const brandId = optionalString(args.brandId, "brandId");
  const status = optionalEnum(args.status, "status", entityStatuses);
  const regions = state.regions.filter(
    (region) =>
      (brandId === undefined || region.brandId === brandId) &&
      (status === undefined || region.status === status)
  );
  return toolSuccess({ regions }, countText("region", regions.length));
}

function listConnectors(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const category = optionalEnum(args.category, "category", connectorCategories);
  const backendType = optionalEnum(args.backendType, "backendType", backendTypes);
  const authMode = optionalEnum(args.authMode, "authMode", authModes);
  const connectors = state.connectors.filter(
    (connector) =>
      (category === undefined || connector.category === category) &&
      (backendType === undefined || connector.backendOptions.includes(backendType)) &&
      (authMode === undefined || connector.authMode === authMode)
  );
  return toolSuccess({ connectors }, countText("connector", connectors.length));
}

function listConnections(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const brandId = optionalString(args.brandId, "brandId");
  const regionId = optionalString(args.regionId, "regionId");
  const connectorId = optionalString(args.connectorId, "connectorId");
  const status = optionalEnum(args.status, "status", connectionStatuses);
  const setupMode = optionalEnum(args.setupMode, "setupMode", setupModes);
  const connections = toGatewayApiResources(state).connections.filter(
    (connection) =>
      (brandId === undefined || connection.brandId === brandId) &&
      (regionId === undefined || connection.regionId === regionId) &&
      (connectorId === undefined || connection.connectorId === connectorId) &&
      (status === undefined || connection.status === status) &&
      (setupMode === undefined || connection.setupMode === setupMode)
  );
  return toolSuccess({ connections }, countText("connection", connections.length));
}

function getConnection(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const connectionId = requiredString(args.connectionId, "connectionId");
  const connection = toGatewayApiResources(state).connections.find((candidate) => candidate.id === connectionId);
  if (connection === undefined) {
    return toolError(`Connection not found: ${connectionId}`);
  }
  return toolSuccess({ connection }, `Found connection ${connection.displayName}.`);
}

function findConnections(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const query = requiredString(args.query, "query").trim().toLowerCase();
  if (query.length === 0) {
    return toolError("query must not be empty");
  }
  const resources = toGatewayApiResources(state);
  const terms = query.split(/\s+/).filter(Boolean);
  const connections = resources.connections.filter((connection) =>
    terms.every((term) => searchableConnectionText(connection, state).includes(term))
  );
  return toolSuccess({ connections }, countText("connection", connections.length));
}

function searchableConnectionText(connection: GatewayConnectionApiResource, state: GatewayState): string {
  const brand = state.brands.find((candidate) => candidate.id === connection.brandId);
  const region = state.regions.find((candidate) => candidate.id === connection.regionId);
  const connector = state.connectors.find((candidate) => candidate.id === connection.connectorId);
  return [
    connection.id,
    connection.displayName,
    brand?.id,
    brand?.name,
    brand?.slug,
    region?.id,
    region?.code,
    region?.name,
    region?.domain,
    connector?.id,
    connector?.slug,
    connector?.name,
    ...Object.values(connection.configSummary)
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function asArgs(args: unknown): ToolArgs {
  if (args === undefined || args === null) return {};
  if (typeof args === "object" && !Array.isArray(args)) return args as ToolArgs;
  throw new Error("arguments must be an object");
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);
  if (parsed === undefined || parsed.trim() === "") throw new Error(`${field} is required`);
  return parsed;
}

function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
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
