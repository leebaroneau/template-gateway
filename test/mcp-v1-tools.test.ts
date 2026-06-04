import { describe, expect, it } from "vitest";
import type { GatewayState } from "../src/admin/types.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import {
  callGatewayMcpTool,
  gatewayMcpTools,
  requiredScopeForGatewayMcpTool
} from "../src/mcp-v1/tools.js";

async function fixtureState(): Promise<GatewayState> {
  return new FixtureGatewayBackend().snapshot();
}

describe("gateway MCP v1 tools", () => {
  it("publishes the six read-only gateway tool definitions", () => {
    expect(gatewayMcpTools.map((tool) => tool.name)).toEqual([
      "gateway_list_brands",
      "gateway_list_regions",
      "gateway_list_connectors",
      "gateway_list_connections",
      "gateway_get_connection",
      "gateway_find_connections"
    ]);
    expect(gatewayMcpTools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  });

  it("maps each tool to its granular read scope", () => {
    expect(requiredScopeForGatewayMcpTool("gateway_list_brands")).toBe("brands.read");
    expect(requiredScopeForGatewayMcpTool("gateway_list_regions")).toBe("regions.read");
    expect(requiredScopeForGatewayMcpTool("gateway_list_connectors")).toBe("connectors.read");
    expect(requiredScopeForGatewayMcpTool("gateway_list_connections")).toBe("connections.read");
    expect(requiredScopeForGatewayMcpTool("gateway_get_connection")).toBe("connections.read");
    expect(requiredScopeForGatewayMcpTool("gateway_find_connections")).toBe("connections.read");
  });

  it("lists brands with structured content and text content", async () => {
    const result = await callGatewayMcpTool("gateway_list_brands", {}, await fixtureState());

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      brands: expect.arrayContaining([expect.objectContaining({ id: "brand_haverford", slug: "haverford" })])
    });
    expect(result.content).toEqual([{ type: "text", text: "Found 3 brands." }]);
  });

  it("filters regions by brand id and status", async () => {
    const result = await callGatewayMcpTool(
      "gateway_list_regions",
      { brandId: "brand_haverford", status: "active" },
      await fixtureState()
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      regions: [
        expect.objectContaining({ id: "region_haverford_au", brandId: "brand_haverford", status: "active" }),
        expect.objectContaining({ id: "region_haverford_nz", brandId: "brand_haverford", status: "active" })
      ]
    });
  });

  it("filters connectors by category and backend type", async () => {
    const result = await callGatewayMcpTool(
      "gateway_list_connectors",
      { category: "commerce", backendType: "nango" },
      await fixtureState()
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      connectors: [
        expect.objectContaining({
          slug: "shopify",
          category: "commerce",
          backendOptions: expect.arrayContaining(["nango"])
        })
      ]
    });
  });

  it("filters connections by hierarchy fields and setup mode", async () => {
    const result = await callGatewayMcpTool(
      "gateway_list_connections",
      {
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_shopify",
        setupMode: "current"
      },
      await fixtureState()
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      connections: [
        expect.objectContaining({
          brandId: "brand_haverford",
          regionId: "region_haverford_au",
          connectorId: "connector_shopify",
          setupMode: "current",
          runtimeStatus: "metadata_only"
        })
      ]
    });
  });

  it("gets one connection and returns tool-level errors for missing ids", async () => {
    const state = await fixtureState();
    const found = await callGatewayMcpTool(
      "gateway_get_connection",
      { connectionId: "connection_haverford_au_shopify" },
      state
    );
    const missing = await callGatewayMcpTool("gateway_get_connection", { connectionId: "missing" }, state);

    expect(found.isError).toBe(false);
    expect(found.structuredContent).toEqual({
      connection: expect.objectContaining({ id: "connection_haverford_au_shopify" })
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toBe("Connection not found: missing");
  });

  it("finds connections across connection, connector, brand, region, and safe config fields", async () => {
    const state = await fixtureState();

    await expect(callGatewayMcpTool("gateway_find_connections", { query: "shopify au" }, state)).resolves.toMatchObject({
      isError: false,
      structuredContent: { connections: [expect.objectContaining({ connectorId: "connector_shopify" })] }
    });
    await expect(callGatewayMcpTool("gateway_find_connections", { query: "haverford" }, state)).resolves.toMatchObject({
      isError: false,
      structuredContent: {
        connections: expect.arrayContaining([expect.objectContaining({ brandId: "brand_haverford" })])
      }
    });
  });

  it("does not expose raw secret-like config values in tool output", async () => {
    const state = await fixtureState();
    state.connections[0].configSummary = {
      access_token: "ya29.secret",
      shop_domain: "haverford-au.myshopify.com",
      credential_ref: "haverford-shopify-prod"
    };

    const result = await callGatewayMcpTool("gateway_get_connection", { connectionId: state.connections[0].id }, state);
    const json = JSON.stringify(result);

    expect(json).toContain("haverford-au.myshopify.com");
    expect(json).toContain("haverford-shopify-prod");
    expect(json).not.toContain("ya29.secret");
  });

  it("returns tool-level errors for invalid filters and unknown tools", async () => {
    const state = await fixtureState();

    await expect(callGatewayMcpTool("gateway_list_brands", { status: "deleted" }, state)).resolves.toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Invalid status: deleted" }]
    });
    await expect(callGatewayMcpTool("missing_tool", {}, state)).resolves.toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Unknown tool: missing_tool" }]
    });
  });
});
