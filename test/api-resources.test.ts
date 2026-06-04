import { describe, expect, it } from "vitest";
import { mapDevApiBrandsToGatewayState } from "../src/admin/dev-api-mapper.js";
import { toConnectionApiResource, toGatewayApiResources } from "../src/api/resources.js";
import type { DevApiBrandsResponse } from "../src/admin/dev-api-types.js";
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

  it("omits unsafe config summary keys even when their values look ordinary", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_leaky_keys",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Leaky Key Shopify",
          status: "connected",
          configSummary: {
            api_key: "ordinary setting",
            APIKey: "ordinary setting",
            apiKey: "ordinary setting",
            access_token: "ordinary setting",
            AccessToken: "ordinary setting",
            "access-token": "ordinary setting",
            authorization: "ordinary setting",
            bearer: "ordinary setting",
            token: "ordinary setting",
            secret: "ordinary setting",
            password: "ordinary setting",
            private_key: "ordinary setting",
            PrivateKey: "ordinary setting",
            privateKey: "ordinary setting",
            service_account_token: "ordinary setting",
            serviceAccountToken: "ordinary setting",
            shop_domain: "haverford.myshopify.com",
            account_id: "HAV-AU",
            credential_configured: "true"
          }
        }
      ]
    };

    const resource = toConnectionApiResource(state, state.connections[0]);

    expect(resource.configSummary).toEqual({
      shop_domain: "haverford.myshopify.com",
      account_id: "HAV-AU",
      credential_configured: "true"
    });
    expect(Object.keys(resource.configSummary)).not.toEqual(
      expect.arrayContaining([
        "api_key",
        "APIKey",
        "apiKey",
        "access_token",
        "AccessToken",
        "access-token",
        "authorization",
        "bearer",
        "token",
        "secret",
        "password",
        "private_key",
        "PrivateKey",
        "privateKey",
        "service_account_token",
        "serviceAccountToken"
      ])
    );
  });

  it("omits gateway API secret values under ordinary config summary keys", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_gateway_secret",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Gateway Secret Shopify",
          status: "connected",
          configSummary: {
            shop_domain: "gw_live_abc123",
            account_id: "GW_LIVE_DEF456",
            display_name: "Haverford AU Shopify"
          }
        }
      ]
    };

    const resource = toConnectionApiResource(state, state.connections[0]);

    expect(resource.configSummary).toEqual({
      display_name: "Haverford AU Shopify"
    });
    expect(JSON.stringify(resource)).not.toContain("gw_live_abc123");
    expect(JSON.stringify(resource)).not.toContain("GW_LIVE_DEF456");
  });

  it("omits private key marker values under ordinary config summary keys", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_private_key_marker",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Private Key Marker Shopify",
          status: "connected",
          configSummary: {
            shop_domain: "-----END PRIVATE KEY-----",
            account_id: "PRIVATE KEY",
            storefront_label: "-----end rsa private key-----",
            display_name: "Haverford AU Shopify"
          }
        }
      ]
    };

    const resource = toConnectionApiResource(state, state.connections[0]);

    expect(resource.configSummary).toEqual({
      display_name: "Haverford AU Shopify"
    });
    expect(JSON.stringify(resource)).not.toContain("-----END PRIVATE KEY-----");
    expect(JSON.stringify(resource)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(resource)).not.toContain("-----end rsa private key-----");
  });

  it("infers Dev API source for mapped snapshots that do not include entity metadata", () => {
    const response: DevApiBrandsResponse = {
      brands: [
        {
          slug: "haverford",
          name: "Haverford",
          regions: [
            {
              region: "au",
              domain: "haverford.au",
              brand_alias: null,
              public: true,
              services: {
                shopify: {
                  configured: true,
                  shop_domain: "haverford.myshopify.com",
                  display_name: "Haverford AU Shopify"
                }
              }
            }
          ]
        }
      ]
    };
    const state = mapDevApiBrandsToGatewayState(response);

    expect(state.entityMeta).toBeUndefined();
    expect(toGatewayApiResources(state).connections).toEqual([
      expect.objectContaining({
        id: "devapi_haverford_au_shopify",
        source: "dev_api",
        setupMode: "current",
        configSummary: {
          shop_domain: "haverford.myshopify.com",
          display_name: "Haverford AU Shopify"
        }
      })
    ]);
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
