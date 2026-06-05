import type { ConnectorCapability, ConnectorAdapterInfo, ConnectorAdapterStatus, GatewayConnectorAdapter } from "./types.js";

export interface NangoAdapterConfig {
  secretKey?: string;
  publicKey?: string;
  supportedSlugs?: string[];
}

const DEFAULT_SUPPORTED_SLUGS = ["google-search-console", "meta-ads", "shopify"];

const CAPABILITIES: Record<string, ConnectorCapability[]> = {
  "google-search-console": [
    { slug: "search_analytics.read", name: "Search Analytics Read", mode: "read" },
    { slug: "url_inspection.read", name: "URL Inspection Read", mode: "read" },
  ],
  "meta-ads": [
    { slug: "campaigns.read", name: "Campaigns Read", mode: "read" },
    { slug: "ad_sets.read", name: "Ad Sets Read", mode: "read" },
    { slug: "insights.read", name: "Insights Read", mode: "read" },
  ],
  "shopify": [],
};

export class NangoConnectorAdapter implements GatewayConnectorAdapter {
  private readonly _supportedConnectorSlugs: string[];

  constructor(private readonly config: NangoAdapterConfig) {
    this._supportedConnectorSlugs = config.supportedSlugs ?? DEFAULT_SUPPORTED_SLUGS;
  }

  get info(): ConnectorAdapterInfo {
    return {
      slug: "nango",
      name: "Nango",
      backendType: "nango",
      status: this.getStatus(),
      supportedConnectorSlugs: this._supportedConnectorSlugs,
    };
  }

  listCapabilities(connectorSlug: string): ConnectorCapability[] {
    if (!this._supportedConnectorSlugs.includes(connectorSlug)) return [];
    return CAPABILITIES[connectorSlug] ?? [];
  }

  getStatus(): ConnectorAdapterStatus {
    return this.config.secretKey ? "available" : "unconfigured";
  }
}
