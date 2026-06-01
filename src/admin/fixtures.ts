import type { GatewayState } from "./types.js";

export function createInitialGatewayState(): GatewayState {
  return {
    brands: [
      {
        id: "brand_haverford",
        name: "Haverford",
        slug: "haverford",
        status: "active",
        createdAt: "2026-05-20T00:00:00.000Z"
      },
      {
        id: "brand_catnets",
        name: "Catnets",
        slug: "catnets",
        status: "active",
        createdAt: "2026-05-21T00:00:00.000Z"
      },
      {
        id: "brand_koenig_machinery",
        name: "Koenig Machinery",
        slug: "koenig-machinery",
        status: "active",
        createdAt: "2026-05-22T00:00:00.000Z"
      }
    ],
    regions: [
      {
        id: "region_haverford_au",
        brandId: "brand_haverford",
        code: "AU",
        name: "Australia",
        status: "active",
        domain: "haverford.au",
        createdAt: "2026-05-20T00:05:00.000Z"
      },
      {
        id: "region_haverford_nz",
        brandId: "brand_haverford",
        code: "NZ",
        name: "New Zealand",
        status: "active",
        domain: "haverford.co.nz",
        createdAt: "2026-05-20T00:06:00.000Z"
      },
      {
        id: "region_catnets_us",
        brandId: "brand_catnets",
        code: "US",
        name: "United States",
        status: "active",
        domain: "catnets.example",
        createdAt: "2026-05-21T00:05:00.000Z"
      },
      {
        id: "region_catnets_au",
        brandId: "brand_catnets",
        code: "AU",
        name: "Australia",
        status: "active",
        domain: "catnets.au",
        createdAt: "2026-05-21T00:06:00.000Z"
      },
      {
        id: "region_koenig_us",
        brandId: "brand_koenig_machinery",
        code: "US",
        name: "United States",
        status: "active",
        domain: "koenig.example",
        createdAt: "2026-05-22T00:05:00.000Z"
      },
      {
        id: "region_koenig_au",
        brandId: "brand_koenig_machinery",
        code: "AU",
        name: "Australia",
        status: "active",
        createdAt: "2026-05-22T00:06:00.000Z"
      }
    ],
    connectors: [
      {
        id: "connector_shopify",
        slug: "shopify",
        name: "Shopify",
        category: "commerce",
        authMode: "oauth",
        backendOptions: ["nango", "native"],
        fields: [
          { key: "shop_domain", label: "Shop domain", example: "brand.myshopify.com" },
          { key: "access_token", label: "Access token", secret: true, example: "stored in provider vault" }
        ],
        description: "Commerce storefront orders, customers, and catalog data."
      },
      {
        id: "connector_google_analytics_4",
        slug: "google-analytics-4",
        name: "Google Analytics 4",
        category: "analytics",
        authMode: "oauth",
        backendOptions: ["nango", "native"],
        fields: [
          { key: "property_id", label: "GA4 property ID", example: "properties/123456789" },
          { key: "reporting_identity", label: "Reporting identity", example: "service account alias" }
        ],
        description: "Website and campaign performance reporting."
      },
      {
        id: "connector_google_search_console",
        slug: "google-search-console",
        name: "Google Search Console",
        category: "analytics",
        authMode: "oauth",
        backendOptions: ["nango"],
        fields: [
          { key: "site_url", label: "Site URL", example: "https://brand.example" }
        ],
        description: "Organic search performance and indexing visibility."
      },
      {
        id: "connector_meta_ads",
        slug: "meta-ads",
        name: "Meta Ads",
        category: "marketing",
        authMode: "oauth",
        backendOptions: ["nango", "composio"],
        fields: [
          { key: "ad_account_id", label: "Ad account ID", example: "act_123456789" }
        ],
        description: "Paid social campaign reporting and activation."
      },
      {
        id: "connector_klaviyo",
        slug: "klaviyo",
        name: "Klaviyo",
        category: "marketing",
        authMode: "api_key",
        backendOptions: ["nango", "native"],
        fields: [
          { key: "account_id", label: "Account ID", example: "ABC123" },
          { key: "private_api_key", label: "Private API key", secret: true, example: "stored in provider vault" }
        ],
        description: "Lifecycle email metrics and campaign exports."
      },
      {
        id: "connector_outlook",
        slug: "outlook",
        name: "Outlook",
        category: "productivity",
        authMode: "oauth",
        backendOptions: ["composio", "nango"],
        fields: [
          { key: "mailbox", label: "Mailbox", example: "ops@example.com" },
          { key: "tenant", label: "Tenant", example: "Microsoft 365 tenant alias" }
        ],
        description: "Mailbox and calendar access for operator workflows."
      },
      {
        id: "connector_pipedrive",
        slug: "pipedrive",
        name: "Pipedrive",
        category: "crm",
        authMode: "oauth",
        backendOptions: ["composio", "nango"],
        fields: [
          { key: "company_domain", label: "Company domain", example: "brand.pipedrive.com" }
        ],
        description: "CRM deals, contacts, activities, and pipeline status."
      },
      {
        id: "connector_haverford_dev_api",
        slug: "haverford-dev-api",
        name: "Haverford Dev API",
        category: "internal",
        authMode: "service_account",
        backendOptions: ["internal"],
        fields: [
          { key: "service", label: "Service", example: "gateway admin read model" },
          { key: "credential_ref", label: "Credential reference", secret: true, example: "internal vault reference" }
        ],
        description: "Internal Haverford service integration placeholder."
      }
    ],
    connections: [
      {
        id: "connection_haverford_au_shopify",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_shopify",
        backend: "nango",
        displayName: "Haverford AU Shopify",
        status: "connected",
        configSummary: { shop_domain: "haverford-au.myshopify.com", scopes: "orders,customers,products" },
        lastTestedAt: "2026-05-29T05:00:00.000Z",
        createdAt: "2026-05-23T00:00:00.000Z"
      },
      {
        id: "connection_haverford_nz_ga4",
        brandId: "brand_haverford",
        regionId: "region_haverford_nz",
        connectorId: "connector_google_analytics_4",
        backend: "nango",
        displayName: "Haverford NZ GA4",
        status: "needs_config",
        configSummary: { property_id: "not configured" },
        createdAt: "2026-05-23T00:10:00.000Z"
      },
      {
        id: "connection_haverford_au_outlook",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_outlook",
        backend: "composio",
        displayName: "Haverford Ops Outlook",
        status: "pending",
        configSummary: { mailbox: "ops@haverford.example", tenant: "Haverford Microsoft tenant" },
        createdAt: "2026-05-23T00:20:00.000Z"
      },
      {
        id: "connection_catnets_us_meta_ads",
        brandId: "brand_catnets",
        regionId: "region_catnets_us",
        connectorId: "connector_meta_ads",
        backend: "nango",
        displayName: "Catnets US Meta Ads",
        status: "needs_reconnect",
        configSummary: { ad_account_id: "act_mock_catnets_us" },
        lastError: "Provider token expired in fixture scenario.",
        createdAt: "2026-05-24T00:00:00.000Z"
      },
      {
        id: "connection_catnets_au_klaviyo",
        brandId: "brand_catnets",
        regionId: "region_catnets_au",
        connectorId: "connector_klaviyo",
        backend: "native",
        displayName: "Catnets AU Klaviyo",
        status: "connected",
        configSummary: { account_id: "CAT-AU", private_api_key: "stored in fixture vault placeholder" },
        lastTestedAt: "2026-05-28T02:00:00.000Z",
        createdAt: "2026-05-24T00:10:00.000Z"
      },
      {
        id: "connection_koenig_us_pipedrive",
        brandId: "brand_koenig_machinery",
        regionId: "region_koenig_us",
        connectorId: "connector_pipedrive",
        backend: "composio",
        displayName: "Koenig US Pipedrive",
        status: "error",
        configSummary: { company_domain: "koenig-us.pipedrive.example" },
        lastError: "Fixture-only auth configuration requires review.",
        createdAt: "2026-05-25T00:00:00.000Z"
      },
      {
        id: "connection_koenig_au_search_console",
        brandId: "brand_koenig_machinery",
        regionId: "region_koenig_au",
        connectorId: "connector_google_search_console",
        backend: "nango",
        displayName: "Koenig AU Search Console",
        status: "connected",
        configSummary: { site_url: "https://koenig.example/au" },
        lastTestedAt: "2026-05-29T02:30:00.000Z",
        createdAt: "2026-05-25T00:10:00.000Z"
      },
      {
        id: "connection_haverford_au_dev_api",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_haverford_dev_api",
        backend: "internal",
        displayName: "Haverford Dev API",
        status: "connected",
        configSummary: { service: "gateway-admin", credential_ref: "internal fixture placeholder" },
        lastTestedAt: "2026-05-29T03:00:00.000Z",
        createdAt: "2026-05-25T00:20:00.000Z"
      }
    ],
    apiClients: [
      {
        id: "api_client_marketing_ops",
        name: "Marketing Ops",
        brandId: "brand_haverford",
        status: "active",
        createdAt: "2026-05-26T00:00:00.000Z",
        keys: [
          {
            id: "api_key_marketing_ops_primary",
            name: "Primary",
            preview: "gw_mock_mkt_...A1B2",
            fingerprint: "mock-fp-marketing-ops-primary",
            status: "active",
            createdAt: "2026-05-26T00:01:00.000Z",
            rotatedAt: "2026-05-27T00:01:00.000Z"
          }
        ]
      },
      {
        id: "api_client_shopify_sales",
        name: "Shopify Sales",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        status: "active",
        createdAt: "2026-05-26T00:10:00.000Z",
        keys: [
          {
            id: "api_key_shopify_sales_primary",
            name: "Primary",
            preview: "gw_mock_shp_...C3D4",
            fingerprint: "mock-fp-shopify-sales-primary",
            status: "active",
            createdAt: "2026-05-26T00:11:00.000Z"
          }
        ]
      },
      {
        id: "api_client_agent_gateway",
        name: "Agent Gateway",
        status: "active",
        createdAt: "2026-05-26T00:20:00.000Z",
        keys: [
          {
            id: "api_key_agent_gateway_primary",
            name: "Primary",
            preview: "gw_mock_agent_...E5F6",
            fingerprint: "mock-fp-agent-gateway-primary",
            status: "active",
            createdAt: "2026-05-26T00:21:00.000Z"
          }
        ]
      },
      {
        id: "api_client_reporting_worker",
        name: "Reporting Worker",
        status: "active",
        createdAt: "2026-05-26T00:30:00.000Z",
        keys: [
          {
            id: "api_key_reporting_worker_primary",
            name: "Primary",
            preview: "gw_mock_report_...G7H8",
            fingerprint: "mock-fp-reporting-worker-primary",
            status: "revoked",
            createdAt: "2026-05-26T00:31:00.000Z",
            revokedAt: "2026-05-28T00:31:00.000Z"
          }
        ]
      }
    ],
    auditEvents: [
      {
        id: "audit_0006",
        action: "api_key.revoked",
        entityType: "api_key",
        entityId: "api_key_reporting_worker_primary",
        summary: "Reporting Worker fixture key revoked.",
        actor: "fixture",
        createdAt: "2026-05-28T00:31:00.000Z"
      },
      {
        id: "audit_0005",
        action: "api_key.rotated",
        entityType: "api_key",
        entityId: "api_key_marketing_ops_primary",
        summary: "Marketing Ops fixture key rotated.",
        actor: "fixture",
        createdAt: "2026-05-27T00:01:00.000Z"
      },
      {
        id: "audit_0004",
        action: "connection.saved",
        entityType: "connection",
        entityId: "connection_haverford_au_dev_api",
        summary: "Haverford Dev API internal connection saved.",
        actor: "fixture",
        createdAt: "2026-05-25T00:20:00.000Z"
      },
      {
        id: "audit_0003",
        action: "connection.saved",
        entityType: "connection",
        entityId: "connection_haverford_au_shopify",
        summary: "Haverford AU Shopify connection saved.",
        actor: "fixture",
        createdAt: "2026-05-23T00:00:00.000Z"
      },
      {
        id: "audit_0002",
        action: "region.created",
        entityType: "region",
        entityId: "region_haverford_au",
        summary: "Haverford AU region created.",
        actor: "fixture",
        createdAt: "2026-05-20T00:05:00.000Z"
      },
      {
        id: "audit_0001",
        action: "brand.created",
        entityType: "brand",
        entityId: "brand_haverford",
        summary: "Haverford brand created.",
        actor: "fixture",
        createdAt: "2026-05-20T00:00:00.000Z"
      }
    ]
  };
}
