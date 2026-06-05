export type ConnectorCapabilityMode = "read" | "write";

export interface ConnectorCapability {
  slug: string;
  name: string;
  mode: ConnectorCapabilityMode;
  description?: string;
}

export type ConnectorAdapterStatus = "available" | "unconfigured" | "degraded";

export interface ConnectorAdapterInfo {
  slug: string;
  name: string;
  backendType: "composio" | "nango" | "native" | "internal";
  status: ConnectorAdapterStatus;
  supportedConnectorSlugs: string[];
}

export interface GatewayConnectorAdapter {
  readonly info: ConnectorAdapterInfo;
  listCapabilities(connectorSlug: string): ConnectorCapability[];
  getStatus(): ConnectorAdapterStatus;
}
