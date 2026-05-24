import { describe, expect, it } from "vitest";
import { createGatewayMcpServer } from "../src/mcp/server.js";
import { createProviderRegistry } from "../src/providers/registry.js";

describe("createGatewayMcpServer", () => {
  it("registers base gateway tools", async () => {
    const fakeServer = createFakeServer();
    createGatewayMcpServer(fakeServer, {
      providers: createProviderRegistry([
        {
          slug: "microsoft",
          name: "Microsoft 365",
          description: "MS",
          auth: "oauth",
          mcpPath: "/mcp/microsoft",
          scopesSummary: "MS scopes"
        }
      ]),
      apiBaseUrl: "https://gateway.example.com"
    });

    expect(Object.keys(fakeServer.tools)).toEqual(["gateway_whoami", "gateway_list_providers"]);
    const result = await fakeServer.tools.gateway_list_providers.handler({});
    const payload = JSON.parse(result.content[0].text);

    expect(payload.providers[0].url).toBe(
      "https://gateway.example.com/mcp/microsoft"
    );
    expect(result.structuredContent).toEqual(payload);
  });

  it("registers Microsoft status and tool metadata when a Microsoft provider is supplied", async () => {
    const fakeServer = createFakeServer();
    createGatewayMcpServer(fakeServer, {
      providers: createProviderRegistry(),
      apiBaseUrl: "https://gateway.example.com",
      microsoftProvider: {
        status: async (actor: string) => ({
          provider: "microsoft",
          status: "connected",
          actorId: actor,
          actorEmail: "bot@genvest.com.au",
          upstreamLogin: "bot@genvest.com.au",
          scopes: ["User.Read", "Mail.Read"]
        }),
        listTools: () => [
          { name: "outlook_list_messages", requiredScope: "Mail.Read", readOnly: true }
        ]
      }
    });

    expect(Object.keys(fakeServer.tools)).toEqual([
      "gateway_whoami",
      "gateway_list_providers",
      "microsoft_status",
      "microsoft_list_tools"
    ]);

    const status = await fakeServer.tools.microsoft_status.handler({}, {
      authInfo: { extra: { email: "bot@genvest.com.au", profile: "genvest-head-of-sales" } }
    });
    expect(status.structuredContent).toMatchObject({
      provider: "microsoft",
      status: "connected",
      actorId: "genvest-head-of-sales",
      upstreamLogin: "bot@genvest.com.au"
    });

    const tools = await fakeServer.tools.microsoft_list_tools.handler({});
    expect(tools.structuredContent).toEqual({
      provider: "microsoft",
      tools: [{ name: "outlook_list_messages", requiredScope: "Mail.Read", readOnly: true }]
    });
  });

  it("returns authenticated gateway identity", async () => {
    const fakeServer = createFakeServer();
    createGatewayMcpServer(fakeServer, {
      providers: createProviderRegistry(),
      apiBaseUrl: "https://gateway.example.com"
    });

    const result = await fakeServer.tools.gateway_whoami.handler(
      {},
      {
        authInfo: {
          extra: {
            email: "lee@example.com",
            name: "Lee",
            profile: "haverford",
            isStaticServiceToken: true
          }
        }
      }
    );
    const payload = JSON.parse(result.content[0].text);

    expect(payload).toEqual({
      email: "lee@example.com",
      name: "Lee",
      profile: "haverford",
      isStaticServiceToken: true
    });
    expect(result.structuredContent).toEqual(payload);
  });

  it("fails clearly when gateway identity is missing", async () => {
    const fakeServer = createFakeServer();
    createGatewayMcpServer(fakeServer, {
      providers: createProviderRegistry(),
      apiBaseUrl: "https://gateway.example.com"
    });

    await expect(fakeServer.tools.gateway_whoami.handler({})).rejects.toThrow(
      "Missing authenticated gateway actor email"
    );
  });
});

function createFakeServer() {
  return {
    tools: {} as Record<string, { description: string; schema: any; handler: any }>,
    tool(name: string, description: string, schema: any, handler: any) {
      this.tools[name] = { description, schema, handler };
    },
    toolNames() {
      return Object.keys(this.tools);
    }
  };
}

describe("MCP — composio tools are flag-gated", () => {
  it("does not register provider_connect/status/mcp_url when enableComposioProviders is false", async () => {
    const server = createFakeServer();
    createGatewayMcpServer(server, {
      providers: createProviderRegistry([]),
      apiBaseUrl: "http://localhost:3000"
    });
    expect(server.toolNames()).not.toContain("provider_connect");
    expect(server.toolNames()).not.toContain("provider_status");
    expect(server.toolNames()).not.toContain("provider_mcp_url");
  });

  it("registers provider_connect/status/mcp_url when composioProvider is supplied and enableComposioProviders is true", async () => {
    const server = createFakeServer();
    createGatewayMcpServer(server, {
      providers: createProviderRegistry([]),
      apiBaseUrl: "http://localhost:3000",
      enableComposioProviders: true,
      composioProvider: {
        createConnectUrl: async () => ({ provider: "microsoft-composio", backend: "composio", status: "authorization_required", actorId: "test", connectedAccountIds: [] }),
        status: async () => ({ provider: "microsoft-composio", backend: "composio", status: "disconnected", actorId: "test", connectedAccountIds: [] }),
        mcpUrl: async () => ({ provider: "microsoft-composio", backend: "composio", status: "disconnected", actorId: "test", connectedAccountIds: [] })
      }
    });
    expect(server.toolNames()).toContain("provider_connect");
    expect(server.toolNames()).toContain("provider_status");
    expect(server.toolNames()).toContain("provider_mcp_url");
  });

  it("does not register composio tools when enableComposioProviders is false even if composioProvider is supplied", async () => {
    const server = createFakeServer();
    createGatewayMcpServer(server, {
      providers: createProviderRegistry([]),
      apiBaseUrl: "http://localhost:3000",
      enableComposioProviders: false,
      composioProvider: {
        createConnectUrl: async () => ({ provider: "microsoft-composio", backend: "composio", status: "authorization_required", actorId: "test", connectedAccountIds: [] }),
        status: async () => ({ provider: "microsoft-composio", backend: "composio", status: "disconnected", actorId: "test", connectedAccountIds: [] }),
        mcpUrl: async () => ({ provider: "microsoft-composio", backend: "composio", status: "disconnected", actorId: "test", connectedAccountIds: [] })
      }
    });
    expect(server.toolNames()).not.toContain("provider_connect");
    expect(server.toolNames()).not.toContain("provider_status");
    expect(server.toolNames()).not.toContain("provider_mcp_url");
  });
});
