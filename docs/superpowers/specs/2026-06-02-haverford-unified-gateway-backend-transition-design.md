# Haverford Unified Gateway Backend Transition - Design Spec

**Status:** draft for Lee review  
**Issue:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)  
**Date:** 2026-06-02  
**Repo:** `leebaroneau/template-gateway`  
**Branch:** `epic/19-haverford-unified-gateway`

## Context

The local admin UI prototype has validated the first workflow direction: an operational admin tool for brands, regions, connections, connector setup, API access, usage, key rotation, revocation, and audit history.

The next design decision is the backend transition path. The existing Haverford Dev API remains the source of truth for the current setup. It already contains the strongest local primitives for this domain:

- Brands and regions.
- Provider connections.
- OAuth credential records.
- Internal API clients and scoped access.
- Read-only MCP-oriented provider routes.
- A control SQLite database under `data/control.sqlite`.
- App catalog and app install primitives.

The current pain points are not that connections cannot be created. The problems are:

- Existing connections rely heavily on manual setup and deployment/runtime env vars.
- OAuth is not the default setup path for important provider families such as Google products.
- Building app-level capabilities on top of a connection is difficult because the existing model is provider-centric rather than app/tool-centric.
- MCP access must remain first-class for approved Haverford users and domains.

This spec designs a transition backend, not a full Dev API replacement.

## Confirmed Decisions

- Dev API remains the current source of truth during the transition.
- The gateway should optimize and augment Dev API, then gradually take ownership where it proves useful.
- Auth Gate remains the identity source for user/domain approval.
- Gateway stores its own MCP/API policy, app install state, audit, and new gateway-owned connection metadata on the persistent app volume.
- Approved Auth Gate users/domains get read-only MCP access to available connections.
- Admin and write access require explicit gateway scopes.
- Google OAuth should be native first so one operator consent can bind Google product access instead of repeating manual per-connection setup.
- Composio stays available where it makes sense, especially OAuth/toolkit surfaces for agents.
- Native connectors are allowed where Composio/Nango do not fit.
- Nango should remain a serious adapter candidate, but not become the first source of truth for this transition milestone.

## Goals

- Bring current Dev API-backed brands, regions, and connections into the new gateway UI without duplicating the source of truth.
- Prove the gateway can serve MCP and HTTP API access against the current setup.
- Move connection configuration toward persistent app data on a mounted volume that can be backed up.
- Add a policy layer for approved users, domains, API clients, scopes, key rotation, revocation, and audit history.
- Add a native Google OAuth path that can bind one Google credential to GA4, GSC, Google Ads, and Merchant Center resources.
- Preserve Composio as an adapter for providers where it provides the cleanest OAuth/tooling experience.
- Leave room for Nango as an auth/proxy adapter once the gateway ownership boundary is clear.
- Enable a Shopify app/tool layer where a storefront connection can power a reusable dashboard and multiple tools.

## Non-Goals

- Do not replace Dev API in the first backend milestone.
- Do not migrate every existing deployment env secret into gateway storage immediately.
- Do not make Nango the primary data store for Haverford in the first milestone.
- Do not add write-capable MCP tools in the first milestone.
- Do not expose raw tokens, service-account keys, or upstream secrets through the UI, MCP, or API.
- Do not wire real Composio, Nango, native connector execution, or production persistent storage before this backend design is approved and planned.

## Reviewed Primitives

### Dev API

Dev API should be reused because it already models the Haverford domain and has production knowledge embedded in the current brand catalog and provider routes. The gateway should read through Dev API first rather than recreate that work.

Important local primitives:

- `config/brands.ts` - current non-secret platform IDs and brand catalog.
- `lib/control-db.ts` - SQLite tables for brands, regions, provider connections, OAuth clients, OAuth credentials, app catalog, and app installs.
- `lib/providers/google.ts` - existing Google OAuth adapter shape.
- `app/api/internal/*` - internal API route family guarded by internal client credentials.
- `app/api/mcp` and provider routes - read-oriented API/MCP surface.
- `app/brands/[slug]/[region]/page.tsx` and `lib/region-view.ts` - region view and app install concepts.

### Template Gateway

`template-gateway` already provides an Express runtime, MCP JSON-RPC shape, Composio-related gateway code, TypeScript tests, and the new local admin UI prototype. The next milestone should extend this runtime with adapters and storage seams rather than creating a separate service.

### Auth Gate

Auth Gate should remain the user/domain approval source. The gateway should trust headers such as `x-auth-email` only when the request arrived through Auth Gate or trusted internal infrastructure. Local development can use an explicit test override, but production should not accept arbitrary client-supplied identity headers.

### Nango

Nango is a strong future adapter for OAuth connection management, provider-specific connection configuration, metadata, tags, and proxy requests. Its connection tags and metadata model maps well to brand, region, account, and app-install reconciliation.

Nango should not be the first source of truth in this milestone because Dev API already owns the current Haverford setup. Using Nango immediately as the core store would force a migration before the gateway access model is proven.

### Composio

Composio remains useful where agent-facing toolkits, hosted MCP, managed auth, or dynamic tool discovery save custom work. It should be retained as an adapter behind the gateway connector interface, not treated as the only integration runtime.

### ACI and Obot

ACI and Obot are valuable references for MCP/tool platform patterns. ACI is closer to a unified tool-calling platform. Obot is a broader MCP hosting, registry, gateway, and chat platform. Both are bigger than the immediate Haverford transition need, so they should inform the MCP and policy design without replacing the current gateway runtime.

## Recommended Architecture

Use a strangler-style transition gateway:

```text
Admin UI / MCP clients / HTTP API clients
  -> template-gateway
      -> Gateway policy and overlay store on /data
      -> Dev API source adapter
      -> Connector adapters
          -> Native Google OAuth
          -> Composio where useful
          -> Native provider implementations
          -> Nango adapter in Phase 6 if approved
```

The gateway starts as a read-through control plane over Dev API plus a persistent overlay. It gradually takes ownership of new policy, app install, OAuth, and connection config data.

This avoids unnecessary custom code because:

- Brand, region, and existing provider inventory come from Dev API.
- Existing Dev API Google OAuth code provides the first native connector model.
- Existing Dev API app catalog/install primitives guide the Shopify app layer.
- Auth Gate remains the identity primitive.
- Composio/Nango stay adapter choices instead of being reimplemented or prematurely adopted as the core.

The smallest custom surface area is:

- A Dev API adapter that maps current records into the gateway admin/MCP model.
- A persistent gateway overlay store on `/data`.
- A policy engine for MCP/API scopes.
- A connector interface that can route to Dev API, native, Composio, or Nango-backed providers.
- Native Google OAuth routes and token binding when implementation reaches that phase.
- A Shopify app install/read model that layers app dashboards over storefront connections.

## Data Ownership

| Domain | First transition owner | Notes |
| --- | --- | --- |
| Current brands and regions | Dev API | Gateway reads and caches. |
| Current provider IDs and resource references | Dev API | Imported/read-through records keep Dev API source refs. |
| Gateway MCP/API policy | Gateway `/data` store | Domain/user allowlist, scopes, client grants. |
| API clients and key metadata | Gateway `/data` store | Secret values are generated once, then only fingerprints/previews remain visible. |
| Gateway audit history | Gateway `/data` store | Includes MCP reads, API client actions, admin changes, OAuth events. |
| New gateway-owned OAuth credentials | Gateway `/data` store | Encrypted at rest. |
| Existing Dev API secrets | Dev API/Coolify for now | Do not migrate until a specific credential migration plan exists. |
| App catalog and app installs | Gateway overlay first, Dev API-compatible shape | Can sync with Dev API app primitives in Phase 6 or a dedicated migration. |
| Nango/Composio connection IDs | Gateway overlay as adapter refs | Gateway stores mapping, not necessarily provider secrets. |

Every connection record visible in the gateway should carry source metadata:

```ts
type GatewayConnectionSource =
  | "dev_api"
  | "gateway"
  | "native"
  | "composio"
  | "nango";

interface GatewayConnectionRef {
  id: string;
  brandId: string;
  regionId: string;
  connectorSlug: string;
  displayName: string;
  status: "needs_config" | "pending" | "connected" | "needs_reconnect" | "error";
  source: GatewayConnectionSource;
  sourceRef: {
    devApiConnectionId?: string;
    devApiBrandSlug?: string;
    devApiRegionCode?: string;
    composioConnectionId?: string;
    nangoIntegrationId?: string;
    nangoConnectionId?: string;
    nativeCredentialId?: string;
  };
  configSummary: Record<string, string>;
  capabilities: string[];
  appInstallIds: string[];
}
```

Raw secrets never appear in `configSummary`, MCP responses, audit payloads, or API responses.

## Persistent Volume Store

The gateway should use a local SQLite database on the mounted app data volume, for example `/data/gateway.sqlite`.

Initial tables:

- `gateway_sources` - Dev API source configuration, sync cursors, last sync status.
- `gateway_brands_cache` - read-through brand snapshots from Dev API.
- `gateway_regions_cache` - read-through region snapshots from Dev API.
- `gateway_connections_cache` - read-through connection snapshots from Dev API and adapter sources.
- `gateway_connection_overlays` - gateway-owned labels, status overrides, app install links, setup notes.
- `gateway_oauth_credentials` - encrypted gateway-owned OAuth token payloads.
- `gateway_policy_subjects` - approved users/domains and their grant tier.
- `gateway_scope_grants` - subject/client scope assignments.
- `gateway_api_clients` - API client metadata.
- `gateway_api_keys` - key fingerprints, previews, status, rotation metadata.
- `gateway_audit_events` - immutable event stream.
- `gateway_app_catalog` - app/tool definitions.
- `gateway_app_installs` - installed apps per brand/region/connection.

Secrets should be encrypted at rest with an envelope key derived from bootstrap configuration. The encryption key itself must not live only inside the SQLite database. Backup and restore procedures must include both the `/data` volume and the operator-managed encryption key material.

## Dev API Source Adapter

The first backend milestone should add a `DevApiSourceAdapter` with a narrow contract:

```ts
interface DevApiSourceAdapter {
  listBrands(): Promise<GatewayBrandSnapshot[]>;
  listRegions(brandSlug: string): Promise<GatewayRegionSnapshot[]>;
  listConnections(input?: DevApiConnectionFilter): Promise<GatewayConnectionRef[]>;
  listApps(input?: DevApiAppFilter): Promise<GatewayAppSnapshot[]>;
  callReadTool(input: DevApiReadToolCall): Promise<DevApiReadToolResult>;
}
```

Use Dev API JSON/internal routes where they exist. If a required read model only exists in rendered pages, add a minimal Dev API JSON endpoint rather than scraping HTML.

Authentication to Dev API should use internal client credentials for server-to-server calls. Those credentials remain bootstrap env vars because they are runtime service credentials, not per-brand connection config.

## Connector Model

The gateway should distinguish connector type from connection instance:

- Connector: the integration kind, such as Shopify, GA4, GSC, Google Ads, Merchant Center, Klaviyo, Meta Ads, Microsoft, Pipedrive, or Composio toolkit.
- Connection: a configured instance under a brand/region, with a source and capability set.
- Credential: an OAuth/token/service-account binding used by one or more connections.
- App: a Haverford product capability that depends on one or more connections.

Connector interface:

```ts
interface GatewayConnectorAdapter {
  slug: string;
  source: GatewayConnectionSource;
  listCapabilities(): ConnectorCapability[];
  startSetup(input: ConnectorSetupStartInput): Promise<ConnectorSetupStartResult>;
  completeSetup(input: ConnectorSetupCompleteInput): Promise<GatewayConnectionRef>;
  getStatus(connectionId: string): Promise<ConnectorStatus>;
  callRead(input: ConnectorReadCall): Promise<ConnectorReadResult>;
}
```

This lets Dev API, native Google, Composio, and future Nango adapters implement the same gateway-facing shape.

## Native Google OAuth

Google should be the first native OAuth connector family because it addresses the largest current setup pain.

The implementation should follow Dev API's existing `googleAdapter` model:

- Authorization URL uses Google OAuth with offline access and consent when needed.
- Token exchange uses Google's OAuth token endpoint.
- One parent Google credential can bind multiple Google subresources.
- Supported initial product capabilities are GA4, GSC, Google Ads, and Merchant Center.

Flow:

1. Admin selects Google connector setup for a brand/region.
2. Gateway starts a Google OAuth consent flow.
3. Operator grants consent for the required Google account.
4. Gateway stores the encrypted OAuth credential in `/data/gateway.sqlite`.
5. Gateway discovers or binds available Google subresources.
6. Gateway maps those subresources to connection records under the selected brand/region.
7. MCP and API reads use those mapped connection records without exposing token material.

This does not eliminate consent. It reduces repeated manual setup by using one OAuth credential to power multiple Google product connections where scopes and account access allow it.

## MCP Access Design

MCP remains a first-class gateway surface.

Identity:

- Production requests rely on Auth Gate and trusted `x-auth-email`.
- Approved domains/users are mapped into gateway policy subjects.
- Local development uses explicit test identity configuration.

Default access:

- Approved user/domain: read-only MCP access.
- API client with `mcp.read`: read-only MCP access.
- Admin/write scopes: not granted implicitly.

Allowed read-only MCP operations:

- List available tools.
- Discover available brands, regions, connections, and non-secret config summaries.
- Call read-only provider tools backed by available connections.
- Read app/tool catalog metadata.

Denied by default:

- Connection mutation.
- Secret reveal.
- Key creation, rotation, or revocation.
- Provider write actions.
- App install mutation.

Every MCP call should be filtered by subject scope and connection availability. Audit must record actor, domain, tool, connection reference, source, outcome, and latency. Audit payloads must redact tool inputs that may contain secrets or upstream customer data.

## HTTP API Access Design

API Access is separate from MCP user access.

Core entities:

- API client.
- API key or token.
- Scope grant.
- Usage counter.
- Audit event.

Initial scopes:

- `brands.read`
- `regions.read`
- `connectors.read`
- `connections.read`
- `connections.write`
- `mcp.read`
- `api_clients.read`
- `api_clients.write`
- `audit.read`
- `apps.read`
- `apps.write`

Keys should support:

- One-time secret reveal at creation.
- Fingerprint and preview storage.
- Rotation with new key activation and old key revocation.
- Immediate revocation.
- Last-used and usage counters.
- Audit events for create, rotate, revoke, failed auth, and scope changes.

## Shopify App And Tool Layer

Shopify should become a platform capability, not only a token/config record.

The gateway should introduce an app manifest model:

```ts
interface GatewayAppManifest {
  slug: string;
  name: string;
  description: string;
  requiredConnectors: string[];
  optionalConnectors: string[];
  dashboardEntrypoint: string;
  tools: Array<{
    slug: string;
    name: string;
    mode: "read" | "write";
    requiredScopes: string[];
  }>;
  provisioning: {
    autoCreateOnConnection?: boolean;
    defaultStatus: "pending" | "enabled" | "disabled";
  };
}
```

For Shopify storefronts:

- A Shopify connection can trigger a pending or enabled app install for that brand/region.
- The app install can expose a dashboard surface for the storefront.
- Multiple tools can hang off the same app install.
- Tool availability depends on the Shopify connection state and required scopes.

Example first app surface:

- Storefront overview.
- Product health.
- Collection and merchandising checks.
- SEO/product metadata review.
- Order/customer read summaries.
- Suggested action queue, initially read-only or draft-only.

The first implementation should model app installs and dashboard visibility before building any production Shopify automation.

## Backend Milestones

### Phase 1 - Dev API Read-Through Backend

- Add Dev API adapter configuration.
- Load brands, regions, connections, and non-secret summaries from Dev API or fixture-equivalent JSON.
- Show real/read-through data in the existing admin UI.
- Keep mutations disabled or local-only.
- Add audit events for gateway reads.
- Add tests for Dev API response mapping.

### Phase 2 - Persistent Gateway Policy Store

- Add `/data/gateway.sqlite`.
- Add policy subject, scope, API client, key metadata, and audit tables.
- Use Auth Gate identity for user/domain MCP policy checks.
- Add API client auth for HTTP API access.
- Add key rotation and revocation backed by persistent storage.

### Phase 3 - MCP Read Gateway

- Add read-only MCP tool registry backed by available connection refs.
- Filter tools by user/domain/API client scopes.
- Route read calls to Dev API or connector adapters.
- Audit every MCP read.
- Keep writes disabled.

### Phase 4 - Native Google OAuth

- Add Google setup routes and callback handling.
- Store encrypted OAuth credentials in the gateway store.
- Bind one Google credential to supported product connections.
- Add reconnect state and status checks.
- Keep Google write actions out of scope.

### Phase 5 - Shopify App Install Prototype

- Add app manifest/catalog model.
- Add app installs per brand/region/connection.
- Auto-create pending app installs for Shopify connection availability.
- Show the app dashboard shell and tool availability states.

### Phase 6 - Adapter Evaluation

- Add a Composio adapter only for a connector where it clearly reduces custom code.
- Add a Nango adapter proof only after the gateway source-of-truth boundary is stable.
- Revisit ACI/Obot only if the gateway needs broader MCP hosting/registry behavior than `template-gateway` should own.

## Testing Strategy

Unit tests:

- Dev API adapter maps brands, regions, and connections into gateway state.
- Source metadata is preserved for imported connections.
- Policy subjects resolve approved users and domains correctly.
- Scope checks deny writes for read-only MCP subjects.
- API key rotation revokes old keys and audits the change.
- OAuth credential summaries never expose raw tokens.
- App manifests create expected install records for Shopify connections.

Route tests:

- Admin state endpoint can render Dev API-backed data.
- MCP list-tools is filtered by identity/scope.
- MCP read tool call records audit.
- API client auth accepts active keys and rejects revoked keys.
- Google OAuth start/callback handle mocked token exchange.

Local smoke tests:

- Run with fixture Dev API responses first.
- Run against local Dev API only when internal credentials are configured.
- Confirm UI no longer depends on fixture-only data once Phase 1 is active.
- Confirm `/data/gateway.sqlite` survives process restart.

## Error Handling

- Dev API unavailable: show cached last-known snapshots with stale status and a clear sync error.
- Auth Gate identity missing: deny MCP/API access unless explicit local development identity is enabled.
- Scope missing: return a structured forbidden response and audit the denial.
- Connector unavailable: mark affected connections degraded without deleting source refs.
- OAuth callback failure: preserve prior credential if present, mark reconnect required, and audit the failure.
- Encryption key missing: fail startup for secret-owning phases rather than silently writing plaintext.

## Deployment Notes

- `/data` must be mounted as persistent storage in deployment.
- `/data/gateway.sqlite` is the gateway-owned source for policy, audit, app installs, and new gateway-owned connection config.
- Bootstrap env vars remain acceptable for service-level configuration: Dev API URL, Dev API internal client credentials, Auth Gate trust configuration, encryption key reference, app base URL.
- Per-connection config should move into the gateway store when the gateway owns that connector.
- Backup/restore must include the `/data` volume and the operator-managed encryption key material.

## Open Risks

- Dev API may need a small JSON endpoint for a clean connection/app read model if current internal routes do not expose exactly what the gateway needs.
- Current local Dev API database can be empty, so fixture-derived and live-derived tests need separate paths.
- Moving existing Google credentials from service account/env style to OAuth requires an operator consent and a migration policy for each account family.
- OAuth token encryption and backup procedures need to be designed before any production credential writes.
- MCP tool outputs may include customer or operational data, so audit logging must record metadata without storing sensitive payloads by default.

## Approval Gate

Implementation planning can start after Lee confirms:

- Dev API read-through plus gateway overlay is the right transition architecture.
- Auth Gate should remain the user/domain identity source.
- MCP access should be read-only by default for approved users/domains.
- Native Google OAuth should be the first OAuth connector phase.
- Shopify app installs should be modeled before production Shopify automation is built.

## Sources

- Local Dev API reference: `/Users/leebaroneau/Documents/GitHub/lee-dashboard/haverford-brands/00_resources/infrastructure/haverford-dev-api-reference.md`
- Dev API source: `/Users/leebaroneau/Documents/GitHub/lee-dashboard/haverford-brands/00_repos/services/service-Haverford-Dev-API`
- Auth Gate handoff: `/Users/leebaroneau/Documents/GitHub/lee-dashboard/haverford-brands/00_resources/infrastructure/auth-gate-handoff.md`
- Gateway UI design: `docs/superpowers/specs/2026-06-01-haverford-unified-gateway-design.md`
- Nango self-hosting: `https://nango.dev/docs/guides/platform/self-hosting`
- Nango connection tags/configuration/metadata: `https://nango.dev/docs/guides/auth/connection-tags-configuration-metadata`
- Composio MCP intro: `https://docs.composio.dev/mcp/introduction`
- Composio Connect: `https://docs.composio.dev/docs/composio-connect`
- ACI repo: `https://github.com/aipotheosis-labs/aci`
- Obot repo: `https://github.com/obot-platform/obot`
