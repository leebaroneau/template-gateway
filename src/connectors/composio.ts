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
  readonly info: ConnectorAdapterInfo;

  constructor(private readonly config: ComposioAdapterConfig) {
    const supportedConnectorSlugs = config.supportedSlugs ?? DEFAULT_SUPPORTED_SLUGS;
    this.info = {
      slug: "composio",
      name: "Composio",
      backendType: "composio",
      status: this.getStatus(),
      supportedConnectorSlugs,
    };
  }

  listCapabilities(connectorSlug: string): ConnectorCapability[] {
    if (!this.info.supportedConnectorSlugs.includes(connectorSlug)) return [];
    return CAPABILITIES[connectorSlug] ?? [];
  }

  getStatus(): ConnectorAdapterStatus {
    return this.config.apiKey ? "available" : "unconfigured";
  }
}
