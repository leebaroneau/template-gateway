import { describe, expect, it } from "vitest";
import { mapDevApiBrandsToGatewayState } from "../src/admin/dev-api-mapper.js";
import type { DevApiBrandsResponse } from "../src/admin/dev-api-types.js";

function devApiBrandsResponse(): DevApiBrandsResponse {
  return {
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
                project_slug: "haverford-au",
                shop_domain: "haverford-au.myshopify.com",
                credential_group: "default",
                display_name: "Haverford AU Shopify",
                mutation_allowed: false
              },
              ga4: {
                configured: true,
                property_id: "properties/123456789"
              },
              gsc: {
                configured: true,
                site_url: "https://www.haverford.au"
              },
              google_ads: {
                configured: true,
                customer_id: "2159319535"
              },
              merchant_center: {
                configured: true,
                merchant_center_id: "1234567"
              },
              clarity: {
                configured: true,
                site: "abc123",
                name: "Haverford AU",
                url: "https://clarity.microsoft.com/projects/view/abc123"
              },
              klaviyo: {
                configured: true,
                account_id: "HAV-AU"
              },
              meta_ads: {
                configured: false
              },
              facebook_page: {
                configured: true,
                facebook_page_id: "111222333"
              },
              instagram_account: {
                configured: true,
                instagram_account_id: "444555666"
              },
              dataforseo: {
                configured: true,
                credential_configured: true,
                source: "gsc_property"
              }
            }
          }
        ]
      },
      {
        slug: "catnets",
        name: "Catnets",
        regions: [
          {
            region: "us",
            domain: "catnets.example",
            brand_alias: "Catnets USA",
            public: false,
            services: {
              shopify: { configured: false },
              gsc: { configured: true, site_url: "https://catnets.example" }
            }
          }
        ]
      }
    ]
  };
}

describe("mapDevApiBrandsToGatewayState", () => {
  it("maps Dev API brands, regions, and configured services into gateway state", () => {
    const state = mapDevApiBrandsToGatewayState(devApiBrandsResponse());

    expect(state.brands).toEqual([
      { id: "brand_haverford", name: "Haverford", slug: "haverford", status: "active" },
      { id: "brand_catnets", name: "Catnets", slug: "catnets", status: "active" }
    ]);
    expect(state.regions).toEqual([
      {
        id: "region_haverford_au",
        brandId: "brand_haverford",
        code: "AU",
        name: "AU",
        status: "active",
        domain: "haverford.au"
      },
      {
        id: "region_catnets_us",
        brandId: "brand_catnets",
        code: "US",
        name: "US",
        status: "disabled",
        domain: "catnets.example"
      }
    ]);
    expect(state.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "connector_shopify", slug: "shopify" }),
        expect.objectContaining({ id: "connector_google_analytics_4", slug: "google-analytics-4" }),
        expect.objectContaining({ id: "connector_google_search_console", slug: "google-search-console" }),
        expect.objectContaining({ id: "connector_google_ads", slug: "google-ads" }),
        expect.objectContaining({ id: "connector_merchant_center", slug: "merchant-center" }),
        expect.objectContaining({ id: "connector_microsoft_clarity", slug: "microsoft-clarity" }),
        expect.objectContaining({ id: "connector_klaviyo", slug: "klaviyo" }),
        expect.objectContaining({ id: "connector_meta_ads", slug: "meta-ads" }),
        expect.objectContaining({ id: "connector_facebook_page", slug: "facebook-page" }),
        expect.objectContaining({ id: "connector_instagram_account", slug: "instagram-account" }),
        expect.objectContaining({ id: "connector_dataforseo", slug: "dataforseo" })
      ])
    );
    expect(state.connections.map((connection) => connection.id)).toEqual(
      expect.arrayContaining([
        "devapi_haverford_au_shopify",
        "devapi_haverford_au_google_analytics_4",
        "devapi_haverford_au_google_search_console",
        "devapi_haverford_au_google_ads",
        "devapi_haverford_au_merchant_center",
        "devapi_haverford_au_microsoft_clarity",
        "devapi_haverford_au_klaviyo",
        "devapi_haverford_au_facebook_page",
        "devapi_haverford_au_instagram_account",
        "devapi_haverford_au_dataforseo",
        "devapi_catnets_us_google_search_console"
      ])
    );
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_meta_ads")).toBeUndefined();
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_shopify")).toMatchObject({
      brandId: "brand_haverford",
      regionId: "region_haverford_au",
      connectorId: "connector_shopify",
      backendType: "internal",
      displayName: "Haverford AU Shopify",
      status: "connected",
      configSummary: {
        project_slug: "haverford-au",
        shop_domain: "haverford-au.myshopify.com",
        credential_group: "default",
        display_name: "Haverford AU Shopify",
        mutation_allowed: "false"
      }
    });
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_google_ads")).toMatchObject({
      connectorId: "connector_google_ads",
      configSummary: { customer_id: "2159319535" }
    });
    expect(state.auditEvents).toHaveLength(1);
    expect(state.auditEvents[0]).toMatchObject({
      action: "connection.tested",
      targetType: "connection",
      targetId: "dev-api-read-through",
      actor: "dev-api-source",
      metadata: { source: "dev-api" }
    });
    expect(state.apiClients.map((client) => client.name)).toEqual(
      expect.arrayContaining(["Marketing Ops", "Shopify Sales", "Agent Gateway", "Reporting Worker"])
    );
  });

  it("skips services where configured is false", () => {
    const state = mapDevApiBrandsToGatewayState(devApiBrandsResponse());

    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_meta_ads")).toBeUndefined();
    expect(state.connections.find((connection) => connection.id === "devapi_catnets_us_shopify")).toBeUndefined();
  });

  it("does not expose secret-like fields from Dev API service details", () => {
    const response = devApiBrandsResponse();
    response.brands[0].regions[0].services.shopify = {
      configured: true,
      project_slug: "haverford-au",
      shop_domain: "haverford-au.myshopify.com",
      credential_group: "default",
      display_name: "Haverford AU Shopify",
      mutation_allowed: false,
      access_token: "secret-token",
      client_secret: "secret-client",
      password: "secret-password",
      api_key: "secret-key",
      authorization: "Bearer secret-authorization",
      bearer_token: "secret-bearer",
      private_key: "secret-private-key",
      consumer_key: "secret-consumer-key",
      app_key: "secret-app-key",
      credential_ref: "secret-credential-ref",
      service_account_json: "secret-service-account-json"
    };

    const state = mapDevApiBrandsToGatewayState(response);
    const shopify = state.connections.find((connection) => connection.id === "devapi_haverford_au_shopify");
    const serialized = JSON.stringify(state);

    expect(shopify?.configSummary).toMatchObject({
      project_slug: "haverford-au",
      shop_domain: "haverford-au.myshopify.com",
      credential_group: "default",
      display_name: "Haverford AU Shopify",
      mutation_allowed: "false"
    });
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_google_analytics_4")).toMatchObject({
      configSummary: { property_id: "properties/123456789" }
    });
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_google_search_console")).toMatchObject({
      configSummary: { site_url: "https://www.haverford.au" }
    });
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_google_ads")).toMatchObject({
      configSummary: { customer_id: "2159319535" }
    });
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_merchant_center")).toMatchObject({
      configSummary: { merchant_center_id: "1234567" }
    });
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_klaviyo")).toMatchObject({
      configSummary: { account_id: "HAV-AU" }
    });
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_dataforseo")).toMatchObject({
      configSummary: { credential_configured: "true", source: "gsc_property" }
    });
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-client");
    expect(serialized).not.toContain("secret-password");
    expect(serialized).not.toContain("secret-key");
    expect(serialized).not.toContain("secret-authorization");
    expect(serialized).not.toContain("secret-bearer");
    expect(serialized).not.toContain("secret-private-key");
    expect(serialized).not.toContain("secret-consumer-key");
    expect(serialized).not.toContain("secret-app-key");
    expect(serialized).not.toContain("secret-credential-ref");
    expect(serialized).not.toContain("secret-service-account-json");
  });
});
