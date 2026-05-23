import { z } from "zod";
import type { ProviderRegistry } from "../providers/types.js";

interface ToolCapableServer {
  tool(
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    handler: (input: any, extra?: any) => Promise<any> | any
  ): void;
}

export interface GatewayMcpServerOptions {
  providers: ProviderRegistry;
  apiBaseUrl: string;
}

export function createGatewayMcpServer<T extends ToolCapableServer>(
  server: T,
  options: GatewayMcpServerOptions
): T {
  server.tool(
    "gateway_whoami",
    "Return the authenticated gateway actor identity for this MCP session.",
    {},
    async (_input, extra) =>
      toolResult({
        email: extra?.authInfo?.extra?.email,
        name: extra?.authInfo?.extra?.name,
        profile: extra?.authInfo?.extra?.profile,
        isStaticServiceToken: extra?.authInfo?.extra?.isStaticServiceToken === true
      })
  );

  server.tool(
    "gateway_list_providers",
    "List providers available from this gateway.",
    {},
    async () =>
      toolResult({
        providers: options.providers.list().map((provider) => ({
          ...provider,
          url: new URL(provider.mcpPath, options.apiBaseUrl).toString()
        }))
      })
  );

  return server;
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: { data }
  };
}
