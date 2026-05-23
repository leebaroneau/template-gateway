import { z } from "zod";
import { createProviderDirectory } from "../providers/directory.js";
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
    async (_input, extra) => {
      const identity = extra?.authInfo?.extra;
      if (!identity?.email) {
        throw new Error("Missing authenticated gateway actor email");
      }

      return toolResult({
        email: identity.email,
        name: identity.name,
        profile: identity.profile,
        isStaticServiceToken: identity.isStaticServiceToken === true
      });
    }
  );

  server.tool(
    "gateway_list_providers",
    "List providers available from this gateway.",
    {},
    async () => toolResult(createProviderDirectory(options.apiBaseUrl, options.providers))
  );

  return server;
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}
