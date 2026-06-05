import type { GatewayConnectorAdapter } from "./types.js";

export class ConnectorAdapterRegistry {
  private readonly adapters = new Map<string, GatewayConnectorAdapter>();

  register(adapter: GatewayConnectorAdapter): void {
    for (const slug of adapter.info.supportedConnectorSlugs) {
      this.adapters.set(slug, adapter);
    }
  }

  get(connectorSlug: string): GatewayConnectorAdapter | undefined {
    return this.adapters.get(connectorSlug);
  }

  list(): GatewayConnectorAdapter[] {
    return Array.from(new Set(this.adapters.values()));
  }
}
