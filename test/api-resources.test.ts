import { describe, expect, it } from "vitest";
import { toConnectionApiResource, toGatewayApiResources } from "../src/api/resources.js";
import type { GatewayState } from "../src/admin/types.js";

const baseState: GatewayState = {
  brands: [{ id: "brand_haverford", name: "Haverford", slug: "haverford", status: "active" }],
  regions: [{ id: "region_au", brandId: "brand_haverford", code: "AU", name: "Australia", status: "active" }],
  connectors: [
    {
      id: "connector_shopify",
      slug: "shopify",
      name: "Shopify",
      category: "commerce",
      authMode: "api_key",
      backendOptions: ["native"],
      requiredFields: [],
      scopes: ["orders.read"],
      description: "Shopify storefront"
    }
  ],
  connections: [],
  apiClients: [],
  auditEvents: [],
  entityMeta: []
};

describe("gateway API resources", () => {
  it("marks Dev API imported connections as current metadata-only setup", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_shopify_au",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Shopify AU",
          status: "connected",
          configSummary: { shop_domain: "haverford.myshopify.com" }
        }
      ],
      entityMeta: [
        {
          entityType: "connection",
          entityId: "connection_shopify_au",
          source: "dev_api",
          hasOverride: false,
          overrideFields: [],
          sourceLabel: "Dev API"
        }
      ]
    };

    expect(toConnectionApiResource(state, state.connections[0])).toMatchObject({
      id: "connection_shopify_au",
      brandId: "brand_haverford",
      regionId: "region_au",
      connectorId: "connector_shopify",
      backendType: "native",
      displayName: "Shopify AU",
      status: "connected",
      setupMode: "current",
      runtimeStatus: "metadata_only",
      migrationStatus: "not_started",
      source: "dev_api",
      configSummary: { shop_domain: "haverford.myshopify.com" }
    });
  });

  it("marks gateway-owned connections as manual references without pretending OAuth is ready", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_manual",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Manual Shopify",
          status: "needs_config",
          configSummary: { credential_group: "shopify-au-current" }
        }
      ],
      entityMeta: [
        {
          entityType: "connection",
          entityId: "connection_manual",
          source: "gateway",
          hasOverride: false,
          overrideFields: [],
          sourceLabel: "Gateway"
        }
      ]
    };

    expect(toConnectionApiResource(state, state.connections[0])).toMatchObject({
      setupMode: "manual_ref",
      runtimeStatus: "metadata_only",
      migrationStatus: "not_started",
      source: "gateway",
      credentialRef: "shopify-au-current",
      configSummary: { credential_group: "shopify-au-current" }
    });
  });

  it("does not expose forbidden secret-like credential references", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_leaky",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Leaky Shopify",
          status: "needs_config",
          configSummary: {
            credential_ref: "Bearer ya29.secret",
            credentialRef: "sk_hidden",
            credential_group: "safe-group",
            shop_domain: "haverford.myshopify.com"
          }
        }
      ]
    };

    const resource = toConnectionApiResource(state, state.connections[0]);

    expect(resource.credentialRef).toBe("safe-group");
    expect(resource.configSummary).toEqual({
      credential_group: "safe-group",
      shop_domain: "haverford.myshopify.com"
    });
    expect(JSON.stringify(resource)).not.toContain("ya29.secret");
    expect(JSON.stringify(resource)).not.toContain("sk_hidden");
  });

  it("returns stable resource collections", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_shopify_au",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Shopify AU",
          status: "connected",
          configSummary: {}
        }
      ]
    };

    const resources = toGatewayApiResources(state);

    expect(resources.brands).toEqual(state.brands);
    expect(resources.regions).toEqual(state.regions);
    expect(resources.connectors).toEqual(state.connectors);
    expect(resources.brands).not.toBe(state.brands);
    expect(resources.regions).not.toBe(state.regions);
    expect(resources.connectors).not.toBe(state.connectors);
    expect(resources.connections).toHaveLength(1);
    expect(resources.connections[0]).toMatchObject({
      id: "connection_shopify_au",
      source: "fixture",
      setupMode: "current",
      runtimeStatus: "metadata_only",
      migrationStatus: "not_started"
    });
  });
});
