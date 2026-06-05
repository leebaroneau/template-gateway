# Phase 6 — Adapter Evaluation — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-05-haverford-unified-gateway-phase-6-adapter-evaluation-design.md`
**Issue:** [#27](https://github.com/leebaroneau/template-gateway/issues/27) · **Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Branch:** `story/27-phase-6-adapter-evaluation`

TDD per task. ESM `.js` imports. No new npm deps. Commit per task.

---

## Task 1 — `src/connectors/types.ts`

Create the file with exactly these exports (no runtime logic — just types):

```typescript
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
```

Run `npm run typecheck`. Commit: `feat(connectors): Task 1 — connector adapter types`.

## Task 2 — `src/connectors/composio.ts` + `test/connectors-composio.test.ts`

```typescript
// src/connectors/composio.ts
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
```

Tests: `listCapabilities("pipedrive")` returns 3 capabilities; `listCapabilities("outlook")` returns 2; `listCapabilities("unknown")` returns `[]`; `getStatus()` returns `"available"` when apiKey is set, `"unconfigured"` when empty string; custom `supportedSlugs` overrides default; `info.backendType` is `"composio"`.

Run `npm test -- test/connectors-composio.test.ts`. Commit: `feat(connectors): Task 2 — ComposioConnectorAdapter + tests`.

## Task 3 — `src/connectors/nango.ts` + `test/connectors-nango.test.ts`

Mirror ComposioConnectorAdapter pattern exactly, but for Nango:

Config: `NangoAdapterConfig { secretKey?: string; publicKey?: string; supportedSlugs?: string[] }`.
DEFAULT_SUPPORTED_SLUGS: `["google-search-console", "meta-ads"]` (not shopify — native adapter owns shopify).

CAPABILITIES for:
- `"google-search-console"`: `[{ slug: "search_analytics.read", name: "Search Analytics Read", mode: "read" }, { slug: "url_inspection.read", name: "URL Inspection Read", mode: "read" }]`
- `"meta-ads"`: `[{ slug: "campaigns.read", name: "Campaigns Read", mode: "read" }, { slug: "ad_sets.read", name: "Ad Sets Read", mode: "read" }, { slug: "insights.read", name: "Insights Read", mode: "read" }]`

`getStatus()`: `"available"` when `secretKey` is non-empty, `"unconfigured"` otherwise.
`info.backendType`: `"nango"`.
`info.slug`: `"nango"`.

Tests mirror Composio tests. Run `npm test -- test/connectors-nango.test.ts`. Commit: `feat(connectors): Task 3 — NangoConnectorAdapter stub + tests`.

## Task 4 — `src/connectors/registry.ts` + `test/connectors-registry.test.ts`

```typescript
// src/connectors/registry.ts
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
```

Tests: register one adapter → get by slug returns it; register two adapters with overlapping slug → last wins; `list()` deduplicates (returns 2, not 4, when two adapters each handle 2 slugs); unknown slug returns undefined.

Run `npm test -- test/connectors-registry.test.ts`. Commit: `feat(connectors): Task 4 — ConnectorAdapterRegistry + tests`.

## Task 5 — API capabilities endpoint + tests

Read `src/api/routes.ts` before writing. Add `connectorRegistry?: ConnectorAdapterRegistry` to `CreateGatewayApiRouterOptions`.

Add route inside `createGatewayApiRouter` (when `options.connectorRegistry` is defined):
```
GET /connectors/:slug/capabilities  →  scope connectors.read
```
Response: `{ connectorSlug, adapter: { slug, backendType, status }, capabilities }`.
On unknown slug (adapter not found): `404 { error: "not_found", message: "No adapter registered for connector: <slug>" }`.
On unconfigured adapter: `200` with `capabilities: []` and `adapter.status: "unconfigured"` (not an error).
When `connectorRegistry` is undefined: route not mounted (omit entirely when no registry).

Test `test/api-connectors-capabilities.test.ts` (supertest): known slug with available adapter → 200 with capabilities; known slug with unconfigured adapter → 200 with empty capabilities; unknown slug → 404; no auth → 401.

Run `npm test -- test/api-connectors-capabilities.test.ts`. Commit: `feat(connectors): Task 5 — capabilities API endpoint + tests`.

## Task 6 — `src/config.ts` + `src/index.ts` wiring + final gate

In `src/config.ts`:
- Add `composioAdapterSlugs?: string[]` and `nangoAdapterSlugs?: string[]` to `GatewayConfig`.
- In `loadConfig`: parse `COMPOSIO_ADAPTER_SUPPORTED_SLUGS` and `NANGO_ADAPTER_SUPPORTED_SLUGS` (comma-split, filter empty, return undefined if absent).

In `src/index.ts`:
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
app.use("/api/v1", createGatewayApiRouter({ ..., connectorRegistry }));
```

Gate: `npm run typecheck` clean, `npm run build` clean, full `npm test` green, `git diff package.json` empty.

Commit: `feat(connectors): Task 6 — config + index wiring; full gate green`.

---

## Codex self-review

After all 6 tasks: review diff for spec compliance + type correctness + no new deps.
