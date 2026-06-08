import type { GatewayState } from "./types.js";

export function createInitialGatewayState(): GatewayState {
  return {
    brands: [
      { id: "brand_haverford", name: "Haverford", slug: "haverford", status: "active" },
      { id: "brand_catnets", name: "Catnets", slug: "catnets", status: "active" },
      { id: "brand_koenig_machinery", name: "Koenig Machinery", slug: "koenig-machinery", status: "active" }
    ],
    regions: [
      {
        id: "region_haverford_au",
        brandId: "brand_haverford",
        code: "AU",
        name: "Australia",
        status: "active",
        domain: "haverford.au"
      },
      {
        id: "region_haverford_nz",
        brandId: "brand_haverford",
        code: "NZ",
        name: "New Zealand",
        status: "active",
        domain: "haverford.co.nz"
      },
      {
        id: "region_catnets_us",
        brandId: "brand_catnets",
        code: "US",
        name: "United States",
        status: "active",
        domain: "catnets.example"
      },
      {
        id: "region_catnets_au",
        brandId: "brand_catnets",
        code: "AU",
        name: "Australia",
        status: "active",
        domain: "catnets.au"
      },
      {
        id: "region_koenig_us",
        brandId: "brand_koenig_machinery",
        code: "US",
        name: "United States",
        status: "active",
        domain: "koenig.example"
      },
      {
        id: "region_koenig_au",
        brandId: "brand_koenig_machinery",
        code: "AU",
        name: "Australia",
        status: "active"
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
        requiredFields: [
          { key: "shop_domain", label: "Shop domain", example: "brand.myshopify.com" },
          { key: "access_token", label: "Access token", secret: true, example: "stored in provider vault" }
        ],
        scopes: ["orders:read", "customers:read", "products:read"],
        description: "Commerce storefront orders, customers, and catalog data."
      },
      {
        id: "connector_google_analytics_4",
        slug: "google-analytics-4",
        name: "Google Analytics 4",
        category: "analytics",
        authMode: "oauth",
        backendOptions: ["nango", "native"],
        requiredFields: [
          { key: "property_id", label: "GA4 property ID", example: "properties/123456789" }
        ],
        scopes: ["analytics.readonly"],
        description: "Website and campaign performance reporting."
      },
      {
        id: "connector_google_search_console",
        slug: "google-search-console",
        name: "Google Search Console",
        category: "analytics",
        authMode: "oauth",
        backendOptions: ["nango"],
        requiredFields: [{ key: "site_url", label: "Site URL", example: "https://brand.example" }],
        scopes: ["webmasters.readonly"],
        description: "Organic search performance and indexing visibility."
      },
      {
        id: "connector_meta_ads",
        slug: "meta-ads",
        name: "Meta Ads",
        category: "marketing",
        authMode: "oauth",
        backendOptions: ["nango", "composio"],
        requiredFields: [{ key: "ad_account_id", label: "Ad account ID", example: "act_123456789" }],
        scopes: ["ads_read", "business_management"],
        description: "Paid social campaign reporting and activation."
      },
      {
        id: "connector_klaviyo",
        slug: "klaviyo",
        name: "Klaviyo",
        category: "marketing",
        authMode: "api_key",
        backendOptions: ["nango", "native"],
        requiredFields: [
          { key: "account_id", label: "Account ID", example: "ABC123" },
          { key: "private_api_key", label: "Private API key", secret: true, example: "stored in provider vault" }
        ],
        scopes: ["campaigns:read", "metrics:read", "profiles:read"],
        description: "Lifecycle email metrics and campaign exports."
      },
      {
        id: "connector_outlook",
        slug: "outlook",
        name: "Outlook",
        category: "productivity",
        authMode: "oauth",
        backendOptions: ["composio", "nango"],
        requiredFields: [
          { key: "mailbox", label: "Mailbox", example: "ops@example.com" },
          { key: "tenant", label: "Tenant", example: "Microsoft 365 tenant alias" }
        ],
        scopes: ["mail.read", "calendar.read", "offline_access"],
        description: "Mailbox and calendar access for operator workflows."
      },
      {
        id: "connector_pipedrive",
        slug: "pipedrive",
        name: "Pipedrive",
        category: "crm",
        authMode: "oauth",
        backendOptions: ["composio", "nango"],
        requiredFields: [{ key: "company_domain", label: "Company domain", example: "brand.pipedrive.com" }],
        scopes: ["deals:read", "persons:read", "activities:read"],
        description: "CRM deals, contacts, activities, and pipeline status."
      },
    ],
    connections: [
      {
        id: "connection_haverford_au_shopify",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_shopify",
        backendType: "nango",
        displayName: "Haverford AU Shopify",
        status: "connected",
        configSummary: {
          shop_domain: "haverford-au.myshopify.com",
          access_token_ref: "fixture vault placeholder"
        },
        lastTestedAt: "2026-05-29T05:00:00.000Z"
      },
      {
        id: "conn-hav-nz-gsc",
        brandId: "brand_haverford",
        regionId: "region_haverford_nz",
        connectorId: "connector_google_search_console",
        backendType: "nango",
        displayName: "Haverford NZ Search Console",
        status: "connected",
        configSummary: { site_url: "https://www.haverford.co.nz" },
        lastTestedAt: "2026-05-29T05:30:00.000Z",
        lastUsedAt: "2026-05-31T04:00:00.000Z"
      },
      {
        id: "connection_haverford_au_outlook",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_outlook",
        backendType: "composio",
        displayName: "Haverford Ops Outlook",
        status: "pending",
        configSummary: { mailbox: "ops@haverford.example", tenant: "Haverford Microsoft tenant" }
      },
      {
        id: "connection_catnets_us_meta_ads",
        brandId: "brand_catnets",
        regionId: "region_catnets_us",
        connectorId: "connector_meta_ads",
        backendType: "nango",
        displayName: "Catnets US Meta Ads",
        status: "needs_reconnect",
        configSummary: { ad_account_id: "act_mock_catnets_us" },
        lastError: "Provider token expired in fixture scenario."
      },
      {
        id: "connection_catnets_au_klaviyo",
        brandId: "brand_catnets",
        regionId: "region_catnets_au",
        connectorId: "connector_klaviyo",
        backendType: "native",
        displayName: "Catnets AU Klaviyo",
        status: "connected",
        configSummary: { account_id: "CAT-AU", private_api_key_ref: "fixture vault placeholder" },
        lastTestedAt: "2026-05-28T02:00:00.000Z"
      },
      {
        id: "connection_koenig_us_pipedrive",
        brandId: "brand_koenig_machinery",
        regionId: "region_koenig_us",
        connectorId: "connector_pipedrive",
        backendType: "composio",
        displayName: "Koenig US Pipedrive",
        status: "error",
        configSummary: { company_domain: "koenig-us.pipedrive.example" },
        lastError: "Fixture-only auth configuration requires review."
      },
      {
        id: "connection_koenig_au_search_console",
        brandId: "brand_koenig_machinery",
        regionId: "region_koenig_au",
        connectorId: "connector_google_search_console",
        backendType: "nango",
        displayName: "Koenig AU Search Console",
        status: "connected",
        configSummary: { site_url: "https://koenig.example/au" },
        lastTestedAt: "2026-05-29T02:30:00.000Z"
      },
    ],
    apiClients: [
      {
        id: "client-marketing-ops",
        name: "Marketing Ops",
        type: "service",
        status: "active",
        scopes: [
          "brands.read",
          "brands.write",
          "regions.read",
          "regions.write",
          "connections.read",
          "audit.read",
          "api_clients.read",
          "api_clients.write"
        ],
        owner: "Marketing Ops",
        lastUsedAt: "2026-05-31T03:00:00.000Z",
        requestCount24h: 218,
        errorRate24h: 0.01,
        keys: [
          {
            id: "key-marketing-primary",
            label: "Primary",
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
        type: "service",
        status: "active",
        scopes: ["brands.read", "connections.read", "connectors.read"],
        owner: "Sales Ops",
        lastUsedAt: "2026-05-31T01:15:00.000Z",
        requestCount24h: 95,
        errorRate24h: 0,
        keys: [
          {
            id: "api_key_shopify_sales_primary",
            label: "Primary",
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
        type: "agent",
        status: "active",
        scopes: ["brands.read", "connectors.read", "connections.read", "connections.write", "audit.read"],
        owner: "Hermes Agents",
        lastUsedAt: "2026-05-31T04:30:00.000Z",
        requestCount24h: 782,
        errorRate24h: 0.03,
        keys: [
          {
            id: "api_key_agent_gateway_primary",
            label: "Primary",
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
        type: "worker",
        status: "active",
        scopes: ["brands.read", "connections.read", "audit.read"],
        owner: "Reporting",
        requestCount24h: 0,
        errorRate24h: 0,
        keys: [
          {
            id: "api_key_reporting_worker_primary",
            label: "Primary",
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
        targetType: "api_key",
        targetId: "api_key_reporting_worker_primary",
        detail: "Reporting Worker fixture key revoked.",
        actor: "fixture",
        timestamp: "2026-05-28T00:31:00.000Z"
      },
      {
        id: "audit_0005",
        action: "api_key.rotated",
        targetType: "api_key",
        targetId: "key-marketing-primary",
        detail: "Marketing Ops fixture key rotated.",
        actor: "fixture",
        timestamp: "2026-05-27T00:01:00.000Z"
      },
      {
        id: "audit_0004",
        action: "connection.saved",
        targetType: "connection",
        targetId: "connection_haverford_au_dev_api",
        detail: "Haverford Dev API internal connection saved.",
        actor: "fixture",
        timestamp: "2026-05-25T00:20:00.000Z"
      },
      {
        id: "audit_0003",
        action: "connection.saved",
        targetType: "connection",
        targetId: "connection_haverford_au_shopify",
        detail: "Haverford AU Shopify connection saved.",
        actor: "fixture",
        timestamp: "2026-05-23T00:00:00.000Z"
      },
      {
        id: "audit_0002",
        action: "region.created",
        targetType: "region",
        targetId: "region_haverford_au",
        detail: "Haverford AU region created.",
        actor: "fixture",
        timestamp: "2026-05-20T00:05:00.000Z"
      },
      {
        id: "audit_0001",
        action: "brand.created",
        targetType: "brand",
        targetId: "brand_haverford",
        detail: "Haverford brand created.",
        actor: "fixture",
        timestamp: "2026-05-20T00:00:00.000Z"
      }
    ]
  };
}
