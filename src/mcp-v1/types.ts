import type { AuthenticatedGatewayApiClient, GatewayApiScope } from "../access/types.js";

export interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface GatewayMcpToolResult {
  content: McpTextContent[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

export type GatewayMcpActor =
  | {
      type: "api_client";
      authMethod: "api_key";
      actorId: string;
      scopes: GatewayApiScope[];
      authenticated: AuthenticatedGatewayApiClient;
    }
  | {
      type: "auth_gate";
      authMethod: "auth_gate";
      actorId: string;
      email: string;
      domain: string;
      scopes: GatewayApiScope[];
    };
