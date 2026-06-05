import type { ConnectorCapability, ConnectorAdapterInfo, ConnectorAdapterStatus, GatewayConnectorAdapter } from "./types.js";

export interface ComposioAdapterConfig {
  apiKey: string;
  supportedSlugs?: string[];
}

const DEFAULT_SUPPORTED_SLUGS = ["pipedrive", "outlook"];

const CAPABILITIES: Record<string, ConnectorCapability[]> = {
  pipedrive: [
    { slug: "contacts.read", name: "Contacts Read", mode: "read" },
    { slug: "deals.read", name: "Deals Read", mode: "read" },
    { slug: "activities.read", name: "Activities Read", mode: "read" },
  ],
  outlook: [
    { slug: "email.read", name: "Email Read", mode: "read" },
    { slug: "calendar.read", name: "Calendar Read", mode: "read" },
  ],
};

export class ComposioConnectorAdapter implements GatewayConnectorAdapter {
  private readonly _supportedConnectorSlugs: string[];

  constructor(private readonly config: ComposioAdapterConfig) {
    this._supportedConnectorSlugs = config.supportedSlugs ?? DEFAULT_SUPPORTED_SLUGS;
  }

  get info(): ConnectorAdapterInfo {
    return {
      slug: "composio",
      name: "Composio",
      backendType: "composio",
      status: this.getStatus(),
      supportedConnectorSlugs: this._supportedConnectorSlugs,
    };
  }

  listCapabilities(connectorSlug: string): ConnectorCapability[] {
    if (!this._supportedConnectorSlugs.includes(connectorSlug)) return [];
    return CAPABILITIES[connectorSlug] ?? [];
  }

  getStatus(): ConnectorAdapterStatus {
    return this.config.apiKey ? "available" : "unconfigured";
  }
}
