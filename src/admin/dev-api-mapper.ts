import { createInitialGatewayState } from "./fixtures.js";
import type { Connector, GatewayBackendType, GatewayState } from "./types.js";
import type { DevApiBrandsResponse, DevApiServiceDetail } from "./dev-api-types.js";

interface ServiceConnectorDefinition {
  serviceKey: string;
  connector: Connector;
  backendType: GatewayBackendType;
  displayNameKey?: string;
  fallbackDisplayName: string;
}

const serviceDefinitions: ServiceConnectorDefinition[] = [
  {
    serviceKey: "shopify",
    connector: {
      id: "connector_shopify",
      slug: "shopify",
      name: "Shopify",
      category: "commerce",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "shop_domain", label: "Shop domain", example: "brand.myshopify.com" }],
      scopes: ["orders:read", "customers:read", "products:read"],
      description: "Commerce storefront orders, customers, and catalog data."
    },
    backendType: "internal",
    displayNameKey: "display_name",
    fallbackDisplayName: "Shopify"
  },
  {
    serviceKey: "ga4",
    connector: {
      id: "connector_google_analytics_4",
      slug: "google-analytics-4",
      name: "Google Analytics 4",
      category: "analytics",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "property_id", label: "GA4 property ID", example: "properties/123456789" }],
      scopes: ["analytics.readonly"],
      description: "Website and campaign performance reporting."
    },
    backendType: "internal",
    fallbackDisplayName: "Google Analytics 4"
  },
  {
    serviceKey: "gsc",
    connector: {
      id: "connector_google_search_console",
      slug: "google-search-console",
      name: "Google Search Console",
      category: "analytics",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "site_url", label: "Site URL", example: "https://brand.example" }],
      scopes: ["webmasters.readonly"],
      description: "Organic search performance and indexing visibility."
    },
    backendType: "internal",
    fallbackDisplayName: "Google Search Console"
  },
  {
    serviceKey: "google_ads",
    connector: {
      id: "connector_google_ads",
      slug: "google-ads",
      name: "Google Ads",
      category: "marketing",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "customer_id", label: "Customer ID", example: "1234567890" }],
      scopes: ["adwords"],
      description: "Google Ads account reporting."
    },
    backendType: "internal",
    fallbackDisplayName: "Google Ads"
  },
  {
    serviceKey: "merchant_center",
    connector: {
      id: "connector_merchant_center",
      slug: "merchant-center",
      name: "Merchant Center",
      category: "commerce",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "merchant_center_id", label: "Merchant Center ID", example: "1234567" }],
      scopes: ["content"],
      description: "Google Merchant Center product and feed visibility."
    },
    backendType: "internal",
    fallbackDisplayName: "Merchant Center"
  },
  {
    serviceKey: "clarity",
    connector: {
      id: "connector_microsoft_clarity",
      slug: "microsoft-clarity",
      name: "Microsoft Clarity",
      category: "analytics",
      authMode: "api_key",
      backendOptions: ["internal", "native"],
      requiredFields: [{ key: "site", label: "Site ID", example: "abc123" }],
      scopes: ["clarity.read"],
      description: "Microsoft Clarity analytics and session insight metadata."
    },
    backendType: "internal",
    displayNameKey: "name",
    fallbackDisplayName: "Microsoft Clarity"
  },
  {
    serviceKey: "klaviyo",
    connector: {
      id: "connector_klaviyo",
      slug: "klaviyo",
      name: "Klaviyo",
      category: "marketing",
      authMode: "api_key",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "account_id", label: "Account ID", example: "ABC123" }],
      scopes: ["campaigns:read", "metrics:read", "profiles:read"],
      description: "Lifecycle email metrics and campaign exports."
    },
    backendType: "internal",
    fallbackDisplayName: "Klaviyo"
  },
  {
    serviceKey: "meta_ads",
    connector: {
      id: "connector_meta_ads",
      slug: "meta-ads",
      name: "Meta Ads",
      category: "marketing",
      authMode: "oauth",
      backendOptions: ["internal", "nango", "composio"],
      requiredFields: [{ key: "ad_account_id", label: "Ad account ID", example: "act_123456789" }],
      scopes: ["ads_read", "business_management"],
      description: "Paid social campaign reporting and activation."
    },
    backendType: "internal",
    fallbackDisplayName: "Meta Ads"
  },
  {
    serviceKey: "facebook_page",
    connector: {
      id: "connector_facebook_page",
      slug: "facebook-page",
      name: "Facebook Page",
      category: "marketing",
      authMode: "oauth",
      backendOptions: ["internal", "native"],
      requiredFields: [{ key: "facebook_page_id", label: "Facebook Page ID", example: "111222333" }],
      scopes: ["pages_read_engagement"],
      description: "Facebook Page metadata and reporting."
    },
    backendType: "internal",
    fallbackDisplayName: "Facebook Page"
  },
  {
    serviceKey: "instagram_account",
    connector: {
      id: "connector_instagram_account",
      slug: "instagram-account",
      name: "Instagram Account",
      category: "marketing",
      authMode: "oauth",
      backendOptions: ["internal", "native"],
      requiredFields: [{ key: "instagram_account_id", label: "Instagram account ID", example: "444555666" }],
      scopes: ["instagram_basic"],
      description: "Instagram business account metadata and reporting."
    },
    backendType: "internal",
    fallbackDisplayName: "Instagram Account"
  },
  {
    serviceKey: "dataforseo",
    connector: {
      id: "connector_dataforseo",
      slug: "dataforseo",
      name: "DataForSEO",
      category: "analytics",
      authMode: "api_key",
      backendOptions: ["internal", "native"],
      requiredFields: [{ key: "source", label: "Source", example: "gsc_property" }],
      scopes: ["dataforseo.read"],
      description: "Search and SEO enrichment via Haverford Dev API credentials."
    },
    backendType: "internal",
    fallbackDisplayName: "DataForSEO"
  }
];

const secretLikePattern =
  /(token|secret|password|(?:private|consumer|app|api)[_-]?key|credential[_-]?ref|service[_-]?account[_-]?json|authorization|bearer)/i;

function idPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeConfigSummary(detail: DevApiServiceDetail): Record<string, string> {
  const summary: Record<string, string> = {};

  for (const [key, value] of Object.entries(detail)) {
    if (key === "configured" || secretLikePattern.test(key) || value === null || value === undefined) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      summary[key] = String(value);
    }
  }

  return summary;
}

function mergeConnectors(base: Connector[]): Connector[] {
  const byId = new Map(base.map((connector) => [connector.id, connector]));

  for (const definition of serviceDefinitions) {
    const existing = byId.get(definition.connector.id);
    if (!existing) {
      byId.set(definition.connector.id, definition.connector);
      continue;
    }

    byId.set(definition.connector.id, {
      ...existing,
      ...definition.connector,
      backendOptions: [...new Set([...definition.connector.backendOptions, ...existing.backendOptions])]
    });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function displayNameFor(
  brandName: string,
  regionCode: string,
  definition: ServiceConnectorDefinition,
  detail: DevApiServiceDetail
): string {
  const configuredName =
    definition.displayNameKey && typeof detail[definition.displayNameKey] === "string"
      ? String(detail[definition.displayNameKey]).trim()
      : "";

  return configuredName || `${brandName} ${regionCode} ${definition.fallbackDisplayName}`;
}

export function mapDevApiBrandsToGatewayState(response: DevApiBrandsResponse): GatewayState {
  const base = createInitialGatewayState();
  const definitionsByService = new Map(serviceDefinitions.map((definition) => [definition.serviceKey, definition]));
  const brands: GatewayState["brands"] = response.brands.map((brand) => ({
    id: `brand_${idPart(brand.slug)}`,
    name: brand.name,
    slug: brand.slug,
    status: "active"
  }));
  const regions: GatewayState["regions"] = [];
  const connections: GatewayState["connections"] = [];

  for (const brand of response.brands) {
    const brandId = `brand_${idPart(brand.slug)}`;

    for (const region of brand.regions) {
      const regionCode = region.region.toUpperCase();
      const regionId = `region_${idPart(brand.slug)}_${idPart(region.region)}`;
      regions.push({
        id: regionId,
        brandId,
        code: regionCode,
        name: regionCode,
        status: region.public === false ? "disabled" : "active",
        ...(region.domain ? { domain: region.domain } : {})
      });

      for (const [serviceKey, detail] of Object.entries(region.services)) {
        const definition = definitionsByService.get(serviceKey);
        if (!definition || detail.configured === false) {
          continue;
        }

        connections.push({
          id: `devapi_${idPart(brand.slug)}_${idPart(region.region)}_${idPart(definition.connector.slug)}`,
          brandId,
          regionId,
          connectorId: definition.connector.id,
          backendType: definition.backendType,
          displayName: displayNameFor(brand.name, regionCode, definition, detail),
          status: "connected",
          configSummary: safeConfigSummary(detail)
        });
      }
    }
  }

  return {
    brands,
    regions,
    connectors: mergeConnectors(base.connectors),
    connections,
    apiClients: base.apiClients,
    auditEvents: [
      {
        id: "audit_dev_api_read_through",
        action: "connection.tested",
        targetType: "connection",
        targetId: "dev-api-read-through",
        detail: "Gateway admin state loaded from Haverford Dev API /api/internal/brands.",
        timestamp: new Date(0).toISOString(),
        actor: "dev-api-source",
        metadata: { source: "dev-api" }
      }
    ]
  };
}
