# Haverford Unified Gateway — Phase 6: Adapter Evaluation — Design Spec

**Status:** approved for implementation
**Issue:** [#27](https://github.com/leebaroneau/template-gateway/issues/27)
**Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Date:** 2026-06-05
**Branch:** `story/27-phase-6-adapter-evaluation`

## Context

Phases 1–5 proved the gateway can own its own OAuth credentials (Google, Shopify), app installs, and MCP/API surfaces. Phase 6 formalises the adapter seam that lets any connector — Composio-managed, Nango-managed, or native — plug into the same interface without the gateway needing to know which backend is in use.

This is an **evaluation phase**, not a full production migration. The deliverables are:
1. A `GatewayConnectorAdapter` interface every backend must implement.
2. A working `ComposioConnectorAdapter` for Pipedrive + Outlook (both already `backendType: "composio"` in the fixture catalog).
3. A `NangoConnectorAdapter` **stub** — implements the interface but returns capability config rather than live OAuth (no Nango deployment required to ship this).
4. A `ConnectorAdapterRegistry` that maps connector slugs to adapters.
5. A new read API endpoint `GET /api/v1/connectors/:slug/capabilities` that resolves the registered adapter and returns its capabilities.

ACI, Obot, and write-capable MCP tools are **out of scope**.

## Module Layout

```
src/connectors/types.ts           # GatewayConnectorAdapter interface + supporting types
src/connectors/composio.ts        # ComposioConnectorAdapter
src/connectors/nango.ts           # NangoConnectorAdapter stub
src/connectors/registry.ts        # ConnectorAdapterRegistry
src/api/routes.ts                 # + GET /connectors/:slug/capabilities
src/index.ts                      # build + register adapters
```

## `GatewayConnectorAdapter` Interface

```typescript
// src/connectors/types.ts

export type ConnectorCapabilityMode = "read" | "write";

export interface ConnectorCapability {
  slug: string;
  name: string;
  mode: ConnectorCapabilityMode;
  description?: string;
}

export type ConnectorAdapterStatus =
  | "available"      // adapter configured and able to serve requests
  | "unconfigured"   // required env/config missing
  | "degraded";      // partial config or upstream unreachable

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
```

The interface is intentionally minimal for the evaluation phase. `listCapabilities` is synchronous (adapters return static capability manifests for now — dynamic discovery via upstream API is a Phase 7+ concern). `startSetup`/`completeSetup` are deliberately omitted: Phases 4–5 own native OAuth; this phase evaluates the adapter *identification* pattern, not another OAuth flow.

## `ComposioConnectorAdapter`

Config: `ComposioAdapterConfig { apiKey: string; supportedSlugs?: string[] }`.

`supportedSlugs` defaults to `["pipedrive", "outlook"]` (the two connectors with `backendType: "composio"` in the fixture catalog). Can be overridden via config.

`listCapabilities(connectorSlug)`: returns a static capability manifest per connector slug (hardcoded for the evaluation — e.g. Pipedrive read tools: `contacts.read`, `deals.read`, `activities.read`; Outlook: `email.read`, `calendar.read`). Returns `[]` for unsupported slugs.

`getStatus()`: returns `"available"` when `apiKey` is non-empty, `"unconfigured"` otherwise.

Config comes from two new optional env vars:
- `COMPOSIO_ADAPTER_API_KEY` (falls back to the existing `COMPOSIO_API_KEY`)
- `COMPOSIO_ADAPTER_SUPPORTED_SLUGS` (comma-list, optional)

## `NangoConnectorAdapter` (stub)

Config: `NangoAdapterConfig { secretKey?: string; publicKey?: string; supportedSlugs?: string[] }`.

`supportedSlugs` defaults to `["google-search-console", "meta-ads", "shopify"]` (the three with `backendType: "nango"` in the fixture catalog).

`listCapabilities(connectorSlug)`: returns a static capability manifest per slug (hardcoded, same as Composio pattern). GSC: `search_analytics.read`, `url_inspection.read`. Meta Ads: `campaigns.read`, `ad_sets.read`, `insights.read`. Shopify: already native — returns `[]` here to signal it should use the native adapter.

`getStatus()`: `"available"` when `secretKey` is set, `"unconfigured"` otherwise. Does NOT make a live Nango API call in this phase.

Config from:
- `NANGO_SECRET_KEY` (optional — stub works without it, just reports `unconfigured`)
- `NANGO_PUBLIC_KEY` (optional)
- `NANGO_ADAPTER_SUPPORTED_SLUGS` (comma-list, optional)

## `ConnectorAdapterRegistry`

```typescript
export class ConnectorAdapterRegistry {
  private adapters = new Map<string, GatewayConnectorAdapter>();

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
```

## API endpoint

`GET /api/v1/connectors/:slug/capabilities` — scope `connectors.read`.

Response when adapter found and available:
```json
{
  "connectorSlug": "pipedrive",
  "adapter": { "slug": "composio", "backendType": "composio", "status": "available" },
  "capabilities": [{ "slug": "contacts.read", "name": "Contacts Read", "mode": "read" }, ...]
}
```

Response when adapter not found: `404 { "error": "not_found", "message": "No adapter registered for connector: ..." }`.
Response when adapter `unconfigured`: `200` with `capabilities: []` and `adapter.status: "unconfigured"` (informational, not an error).

Mount in `createGatewayApiRouter` when `registry` option is provided.

## `src/index.ts` wiring

```typescript
import { ComposioConnectorAdapter } from "./connectors/composio.js";
import { NangoConnectorAdapter } from "./connectors/nango.js";
import { ConnectorAdapterRegistry } from "./connectors/registry.js";

// In createApp():
const connectorRegistry = new ConnectorAdapterRegistry();
connectorRegistry.register(new ComposioConnectorAdapter({
  apiKey: config.composioApiKey,
  supportedSlugs: config.composioAdapterSlugs
}));
connectorRegistry.register(new NangoConnectorAdapter({
  secretKey: process.env.NANGO_SECRET_KEY,
  publicKey: process.env.NANGO_PUBLIC_KEY,
  supportedSlugs: config.nangoAdapterSlugs
}));

// Pass to API router:
app.use("/api/v1", createGatewayApiRouter({ ..., connectorRegistry }));
```

`config.composioAdapterSlugs` and `config.nangoAdapterSlugs` come from `COMPOSIO_ADAPTER_SUPPORTED_SLUGS` and `NANGO_ADAPTER_SUPPORTED_SLUGS` (optional comma-lists in `loadConfig`).

## Testing Strategy

- `test/connectors-registry.test.ts` — register two adapters, get by slug, list deduplicates, unknown slug returns undefined.
- `test/connectors-composio.test.ts` — `listCapabilities("pipedrive")` returns non-empty; `listCapabilities("unknown")` returns `[]`; `getStatus()` available when apiKey set, unconfigured when empty.
- `test/connectors-nango.test.ts` — same pattern for Nango stub.
- `test/api-connectors-capabilities.test.ts` — supertest: `GET /connectors/pipedrive/capabilities` with Composio adapter registered → 200; unknown slug → 404; unconfigured adapter → 200 with empty capabilities.

## Verification Gate

`npm run typecheck` clean, `npm run build` clean, full `npm test` green.
