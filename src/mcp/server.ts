import { z } from "zod";
import { createProviderDirectory } from "../providers/directory.js";
import type { MicrosoftProviderService } from "../providers/microsoft/service.js";
import { ISO_8601_DATE_TIME } from "../providers/microsoft/service.js";
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
  microsoftProvider?: Pick<MicrosoftProviderService, "status" | "listTools" | "listMessages" | "listEvents" | "graphRequest" | "sendEmail">;
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

    server.tool(
      "outlook_list_messages",
      "List Outlook messages for the authenticated gateway actor. Requires Mail.Read.",
      {
        top: z.number().int().min(1).max(100).optional(),
        skip: z.number().int().min(0).optional(),
        query: z.string().min(1).max(500).optional()
      },
      async (input, extra) => {
        const actor = actorKeyFromExtra(extra);
        if (!actor) throw new Error("Missing authenticated gateway actor for outlook_list_messages");
        return toolResult(await options.microsoftProvider!.listMessages!(actor, input));
      }
    );

    // Fix 5: share the ISO 8601 regex with the service layer so the two
    // validation points stay in sync.
    const isoDateLike = z.string().regex(
      ISO_8601_DATE_TIME,
      "expected ISO 8601 date or datetime (e.g. 2026-05-25 or 2026-05-25T09:00:00Z)"
    );

    server.tool(
      "calendar_list_events",
      "List Microsoft 365 calendar events for the authenticated gateway actor. Requires Calendars.Read.",
      {
        top: z.number().int().min(1).max(100).optional(),
        skip: z.number().int().min(0).optional(),
        timeMin: isoDateLike.optional(),
        timeMax: isoDateLike.optional()
      },
      async (input, extra) => {
        const actor = actorKeyFromExtra(extra);
        if (!actor) throw new Error("Missing authenticated gateway actor for calendar_list_events");
        return toolResult(await options.microsoftProvider!.listEvents!(actor, input));
      }
    );

    server.tool(
      "graph_request",
      "Allowlisted Microsoft Graph GET proxy for the authenticated gateway actor. Requires User.Read.",
      {
        method: z.literal("GET"),
        path: z.string().min(1)
      },
      async (input, extra) => {
        const actor = actorKeyFromExtra(extra);
        if (!actor) throw new Error("Missing authenticated gateway actor for graph_request");
        return toolResult(await options.microsoftProvider!.graphRequest!(actor, input));
      }
    );

    const toolMeta = options.microsoftProvider.listTools();
    const sendEmailEnabled = toolMeta.some((t) => t.name === "outlook_send_email");
    if (sendEmailEnabled) {
      server.tool(
        "outlook_send_email",
        "Send an Outlook email as the authenticated gateway actor. Requires Mail.Send. Gated by MICROSOFT_SEND_EMAIL_ENABLED.",
        {
          to: z.array(z.string().email()).min(1),
          subject: z.string().min(1).max(500),
          body: z.string().min(1).max(100_000),
          cc: z.array(z.string().email()).optional(),
          bcc: z.array(z.string().email()).optional()
        },
        async (input, extra) => {
          const actor = actorKeyFromExtra(extra);
          if (!actor) throw new Error("Missing authenticated gateway actor for outlook_send_email");
          return toolResult(await options.microsoftProvider!.sendEmail!(actor, input));
        }
      );
    }
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
