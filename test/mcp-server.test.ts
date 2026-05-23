import { describe, expect, it } from "vitest";
import { createGatewayMcpServer } from "../src/mcp/server.js";
import { createProviderRegistry } from "../src/providers/registry.js";

describe("createGatewayMcpServer", () => {
  it("registers base gateway tools", async () => {
    const fakeServer: any = {
      tools: {},
      tool(name: string, description: string, schema: any, handler: any) {
        this.tools[name] = { description, schema, handler };
      }
    };
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
    expect(JSON.parse(result.content[0].text).providers[0].url).toBe(
      "https://gateway.example.com/mcp/microsoft"
    );
  });
});
