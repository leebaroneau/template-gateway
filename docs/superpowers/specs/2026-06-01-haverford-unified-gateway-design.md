# Haverford Unified Gateway — Design Spec

**Status:** approved draft for implementation planning  
**Issue:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)  
**Date:** 2026-06-01  
**Repo:** `leebaroneau/template-gateway`

## Context

Haverford needs a unified gateway control surface for managing integration access across multiple brands, regions, and configured connections. The immediate milestone is a local UI prototype that validates the operational workflow before wiring backend logic.

The existing `template-gateway` repo is currently a small Node/Express runtime that proxies MCP JSON-RPC to Composio Tool Router sessions. It already gives Haverford a single MCP endpoint pattern and Composio-backed OAuth/tool routing where Composio fits.

The existing Haverford Dev API already models much of the desired domain: brands, brand regions, provider connections, OAuth credentials, internal API clients, scopes, key rotation/revocation, and audit logging. Its concepts should be reused rather than reinvented.

Lee also identified three backend candidates to inspect before backend implementation:

- [`NangoHQ/nango`](https://github.com/NangoHQ/nango)
- [`aipotheosis-labs/aci`](https://github.com/aipotheosis-labs/aci)
- [`obot-platform/obot`](https://github.com/obot-platform/obot)

Initial review suggests Nango is the strongest candidate for the connection/auth/config layer because it provides managed auth, token refresh, per-tenant connection management, proxy requests, integration functions, observability, and self-hosting. ACI is more directly a tool-calling/unified MCP platform. Obot is broader MCP hosting, registry, gateway, and chat infrastructure.

## Goals

- Prototype the admin UI inside `template-gateway` with fixture data first.
- Prove multiple brands can be added.
- Prove multiple regions can be added under each brand.
- Prove multiple connections can be added under each brand/region.
- Make the `Brand > Region > Connection` hierarchy clear.
- Validate the connection setup flow before backend work.
- Provide an operational API Access dashboard for clients, keys/tokens, scopes, usage, rotation, revocation, and audit history.
- Keep the design compatible with a later Nango-backed connection layer.
- Keep Composio available where it is a good fit, especially OAuth/tooling surfaces for agents.
- Support native/internal connectors where Nango or Composio is unsupported or inappropriate.

## Non-Goals For The First Milestone

- No real Nango integration.
- No real Composio wiring changes.
- No native connector execution.
- No persistent-volume config writes.
- No real OAuth flows.
- No real API key generation.
- No production deployment changes.
- No actor/profile-specific OAuth binding UI.

Actor bindings, such as `haverford-cmo` using a personal Outlook or Pipedrive identity, are a later advanced connector detail. The first milestone focuses on brand, region, and connection setup.

## Terms

| Term | Meaning |
| --- | --- |
| Brand | Top-level business unit, such as Haverford, Catnets, or Koenig. |
| Region | Market/site under a brand, such as AU, NZ, UK, or US. |
| Connector | Available integration type, such as Shopify, Google Analytics, Outlook, Pipedrive, or Haverford Dev API. |
| Connection | Configured connector instance under a brand/region. |
| Actor binding | Later user/profile-specific OAuth identity binding. Out of scope for milestone 1. |
| Backend type | How a connection will eventually be powered: `nango`, `composio`, `native`, or `internal`. |

## Recommended Approach

Build a fixture-data admin prototype inside `template-gateway`, with clean backend seams.

This approach keeps the immediate milestone fast and local, but avoids committing prematurely to final backend ownership. The UI can validate the workflow now. Later, the fixture adapter can be replaced by a persistent-volume store, Nango adapter, Composio adapter, native connector adapter, or a combination.

Alternative approaches were considered:

- Adopt React Admin or Refine immediately. These are useful CRUD references, but adding a frontend framework before the workflow is validated is premature.
- Keep the UI out of `template-gateway` and build a separate control-plane app immediately. This may become right later, but it slows the requested local UI-first milestone.

## Architecture

The prototype should introduce a backend-neutral gateway control model:

```ts
type GatewayBackendType = "nango" | "composio" | "native" | "internal";

interface GatewayConnectionBackend {
  listConnectors(): Promise<Connector[]>;
  listConnections(): Promise<Connection[]>;
  createConnection(input: CreateConnectionInput): Promise<Connection>;
  updateConnectionConfig(id: string, input: UpdateConnectionConfigInput): Promise<Connection>;
  startOAuth(id: string): Promise<OAuthStartResult>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  rotateSecret(id: string): Promise<SecretRotationResult>;
  revokeConnection(id: string): Promise<Connection>;
  listAuditEvents(filter?: AuditFilter): Promise<AuditEvent[]>;
}
```

For milestone 1, this interface is backed by fixtures only.

For later backend work:

- Nango can own OAuth, token refresh, provider config, per-brand/region connection IDs, proxy calls, and possibly integration functions.
- Composio can remain useful for agent-facing OAuth/tool surfaces and dynamic MCP tool discovery where it fits better than native code.
- Native connectors can cover Haverford-specific services or APIs unsupported by Nango/Composio.
- Haverford Dev API remains the reference model for brand/region/connection shape, admin clients, scopes, and audit.

## Deployment Data Source Of Truth

The first milestone uses in-code fixtures only. This is not the production data model.

For deployment/backend phases, the source of truth must be persistent app data on the mounted volume, not deployment environment variables.

Expected deployment rule:

- Persistent data lives under `/data` or an equivalent mounted volume.
- Brand, region, connection, connector config, API client, key metadata, usage, and audit state read/write from that persistent data store.
- Coolify environment variables are bootstrap/runtime inputs only: app secret, Auth-Gate URL, initial admin/bootstrap token, and global provider credentials if needed.
- Connection variables/config live in the app data store on the persistent volume and are included in backups.
- Real secret values are encrypted at rest or delegated to Nango when Nango owns that connector.
- The later UI/backend should make backup/export/restore expectations explicit.

## UX Structure

The UI should feel like an operational control plane: dense, restrained, clear, and built for repeated admin work.

Primary navigation:

- **Gateway Overview** — fleet-level view of brands, regions, connection health, recent changes, and setup progress.
- **Brands** — manage the `Brand > Region > Connection` hierarchy.
- **Connectors** — catalog of available connector types with backend type.
- **API Access** — clients, keys/tokens, scopes, usage, rotation, revocation.
- **Audit** — timeline of admin actions, connection changes, key events, and test attempts.

Brand workflow:

1. Add a brand from the Brands page.
2. Open a brand detail page.
3. Add one or more regions under that brand.
4. Open a region.
5. Add one or more connections under that region.
6. Launch a connection setup drawer or wizard.
7. Finish into a mock `needs_config`, `pending`, `connected`, `needs_reconnect`, or `error` state.

Connection setup flow:

1. Select connector.
2. Pick backend mode if more than one is available, such as Nango, Composio, Native, or Internal.
3. Review required setup fields.
4. Configure mock values.
5. Review scope/permission summary.
6. Save as a mock connection.
7. Show next action: test, rotate, revoke, or view audit.

The hierarchy should remain visible through breadcrumbs, a brand/region tree, and region-scoped connection tables.

## API Access Dashboard

The API Access area is separate from connectors. Connectors are upstream integrations; API Access manages clients that call the Haverford gateway.

Layout:

- Summary strip: active clients, active keys/tokens, requests in the last 24 hours, failed auth attempts, recently rotated keys.
- Clients table: client name, type, status, scopes, last used, usage, key count, owner, actions.
- Client detail drawer: metadata, allowed scopes, issued keys/tokens, usage trend, recent audit events.
- Keys/tokens tab: create, rotate, revoke, copy one-time secret, view fingerprint/preview, status, created/rotated/revoked timestamps.
- Scopes/permissions tab: scope groups by domain.
- Usage tab: requests over time, top routes, error rate, rate-limit events, last-used timestamps.
- Audit tab: client created, scopes changed, key rotated, key revoked, failed auth, connection accessed.

Initial gateway scopes should include:

- `brands.read`
- `brands.write`
- `regions.read`
- `regions.write`
- `connectors.read`
- `connections.read`
- `connections.write`
- `api_clients.read`
- `api_clients.write`
- `audit.read`

Milestone 1 uses fixture data only and should not generate real credentials.

## Fixture Data Model

Fixtures should be rich enough to prove hierarchy and workflows without implying backend choices are final.

```ts
type Brand = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "disabled";
  regions: Region[];
};

type Region = {
  id: string;
  brandId: string;
  code: string;
  name: string;
  domain?: string;
  status: "active" | "disabled";
  connections: Connection[];
};

type Connector = {
  id: string;
  slug: string;
  name: string;
  category: "commerce" | "analytics" | "marketing" | "crm" | "productivity" | "internal";
  backendOptions: GatewayBackendType[];
  authMode: "oauth" | "api_key" | "service_account" | "none";
  requiredFields: Array<{ key: string; label: string; secret?: boolean }>;
  scopes: string[];
};

type Connection = {
  id: string;
  brandId: string;
  regionId: string;
  connectorId: string;
  backendType: GatewayBackendType;
  displayName: string;
  status: "needs_config" | "pending" | "connected" | "needs_reconnect" | "error";
  configSummary: Record<string, string>;
  lastTestedAt?: string;
  lastUsedAt?: string;
};
```

Seed examples:

- Brands: Haverford, Catnets, Koenig.
- Regions: AU, NZ, UK, US.
- Connections: Shopify, GA4, GSC, Meta Ads, Klaviyo, Outlook, Pipedrive, Haverford Dev API.
- Backend examples: Nango for OAuth/product integrations, Composio for agent-facing OAuth/tool surfaces, native/internal for Haverford-specific services.
- API clients: Marketing Ops, Shopify Sales, Agent Gateway, Reporting Worker.
- Audit events: brand created, region added, connection saved, connection tested, key rotated, key revoked.

Config values in fixtures are summaries only. No real secrets.

## Local Validation And Testing

The first implementation milestone should be UI-only, but still tested enough to trust the workflow.

Local validation path:

1. Run the `template-gateway` dev server locally.
2. Load the admin prototype.
3. Use fixture data by default.
4. Validate adding multiple brands.
5. Validate adding multiple regions under a brand.
6. Validate adding multiple connections under a region.
7. Validate the connection setup drawer or wizard.
8. Validate API clients.
9. Validate mock key rotation and revocation.
10. Validate usage and audit history views.

Automated checks:

- Fixture adapter tests: add brand, add region, add connection, update connection status.
- Typecheck/build.
- UI state tests if the chosen frontend stack supports them cheaply.
- Lightweight browser smoke test if a real frontend route is added: dashboard renders, hierarchy visible, setup drawer opens, API Access page renders.

Acceptance criteria:

- `Brand > Region > Connection` hierarchy is visually clear.
- Multiple brands, regions, and connections work in the prototype.
- Setup flow communicates connector/backend choice clearly.
- API Access dashboard covers clients, keys/tokens, scopes, usage, rotation, revocation, and audit.
- UI feels like an operational admin tool, not a marketing page.
- No backend integrations are wired before approval.
- Spec clearly states deployment data source of truth is persistent volume storage, not env vars.

## Implementation Gate

Do not implement from this spec until the written spec is reviewed and approved by Lee.

After approval, use the Superpowers writing-plans workflow to create the implementation plan. The first implementation plan should target only the fixture-data UI milestone.
