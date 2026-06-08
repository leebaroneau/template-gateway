import type { GatewayConnectorAdapter } from "./types.js";

export class ConnectorAdapterRegistry {
  private readonly adapters = new Map<string, GatewayConnectorAdapter[]>();

  // Register an adapter. First-registered = highest priority in the resolution chain.
  register(adapter: GatewayConnectorAdapter): void {
    for (const slug of adapter.info.supportedConnectorSlugs) {
      const existing = this.adapters.get(slug) ?? [];
      this.adapters.set(slug, [...existing, adapter]);
    }
  }

  // Resolve the best available adapter for a connector slug.
  // If backendOverride is provided, tries to match by backendType or adapter slug first.
  // Otherwise walks the priority chain (registration order) and returns the first available adapter.
  // Falls back to the first registered adapter if none are available.
  resolve(connectorSlug: string, backendOverride?: string | null): GatewayConnectorAdapter | undefined {
    const candidates = this.adapters.get(connectorSlug) ?? [];
    if (candidates.length === 0) return undefined;
    if (backendOverride) {
      const forced = candidates.find(
        (a) => a.info.backendType === backendOverride || a.info.slug === backendOverride
      );
      if (forced) return forced;
    }
    return candidates.find((a) => a.getStatus() === "available") ?? candidates[0];
  }

  // Backwards-compatible alias for resolve() with no override.
  get(connectorSlug: string): GatewayConnectorAdapter | undefined {
    return this.resolve(connectorSlug);
  }

  list(): GatewayConnectorAdapter[] {
    const seen = new Set<GatewayConnectorAdapter>();
    for (const adapters of this.adapters.values()) {
      for (const adapter of adapters) seen.add(adapter);
    }
    return [...seen];
  }
}
