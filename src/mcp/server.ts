import { z } from "zod";
import { createProviderDirectory } from "../providers/directory.js";
import type { MicrosoftProviderService } from "../providers/microsoft/service.js";
import type { ComposioProviderService } from "../providers/composio/service.js";
import type { ComposioGatewayProvider } from "../providers/composio/types.js";
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
  microsoftProvider?: Pick<MicrosoftProviderService, "status" | "listTools">;
  enableComposioProviders?: boolean;
  composioProvider?: Pick<ComposioProviderService, "createConnectUrl" | "status" | "mcpUrl">;
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

  if (options.microsoftProvider) {
    server.tool(
      "microsoft_status",
      "Return Microsoft 365 connection status for the authenticated gateway actor.",
      {},
      async (_input, extra) => {
        const actor = actorKeyFromExtra(extra);
        if (!actor) {
          throw new Error("Missing authenticated gateway actor for Microsoft status");
        }
        return toolResult(await options.microsoftProvider!.status(actor));
      }
    );

    server.tool(
      "microsoft_list_tools",
      "List Microsoft 365 tools enabled for this gateway deployment.",
      {},
      async () => toolResult({
        provider: "microsoft",
        tools: options.microsoftProvider!.listTools()
      })
    );
  }

  if (options.enableComposioProviders && options.composioProvider) {
    const composioProvider = options.composioProvider;

    server.tool(
      "provider_connect",
      "Return a Composio provider connect URL for the authenticated gateway actor.",
      { provider: z.enum(["microsoft-composio", "google-composio"]) },
      async (input: { provider: ComposioGatewayProvider }, extra) => {
        const identity = extra?.authInfo?.extra;
        if (!identity?.email) {
          throw new Error("actor identity required");
        }
        const actor = {
          actorId: actorKeyFromExtra(extra),
          actorEmail: identity.email,
          actorName: identity.name
        };
        return toolResult(await composioProvider.createConnectUrl(input.provider, actor));
      }
    );

    server.tool(
      "provider_status",
      "Return Composio connection status for the authenticated gateway actor.",
      { provider: z.enum(["microsoft-composio", "google-composio"]) },
      async (input: { provider: ComposioGatewayProvider }, extra) => {
        const actor = actorKeyFromExtra(extra);
        if (!actor) {
          throw new Error("actor identity required");
        }
        return toolResult(await composioProvider.status(input.provider, actor));
      }
    );

    server.tool(
      "provider_mcp_url",
      "Return the Composio MCP URL scoped to the authenticated gateway actor or connected account.",
      { provider: z.enum(["microsoft-composio", "google-composio"]) },
      async (input: { provider: ComposioGatewayProvider }, extra) => {
        const actor = actorKeyFromExtra(extra);
        if (!actor) {
          throw new Error("actor identity required");
        }
        return toolResult(await composioProvider.mcpUrl(input.provider, actor));
      }
    );
  }

  return server;
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function actorKeyFromExtra(extra: any): string | undefined {
  const identity = extra?.authInfo?.extra;
  if (typeof identity?.profile === "string" && identity.profile.trim()) return identity.profile.trim();
  if (typeof identity?.email === "string" && identity.email.trim()) return identity.email.trim().toLowerCase();
  return undefined;
}
