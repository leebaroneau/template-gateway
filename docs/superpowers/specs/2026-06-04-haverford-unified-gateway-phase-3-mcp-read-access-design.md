# Haverford Unified Gateway Phase 3 MCP Read Access - Design Spec

**Status:** draft for Lee review  
**Issue:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)  
**Date:** 2026-06-04  
**Repo:** `leebaroneau/template-gateway`

## Context

Phase 2 added the gateway-owned `/api/v1` metadata front door, persistent API clients and keys, API scopes, usage, audit history, and admin controls for key creation, rotation, and revocation. It intentionally did not add MCP read behavior.

Phase 3 should let approved MCP clients read Haverford Gateway metadata through MCP tools without breaking the existing `/mcp` Composio proxy. Lee's explicit constraint is that this must not block users trying to connect the MCP through Claude connectors.

## External Constraints

Claude and MCP compatibility shape this phase:

- MCP tools are discovered with `tools/list` and invoked with `tools/call`.
- Claude API MCP server definitions can pass an `authorization_token` for authenticated servers.
- Claude hosted custom connectors do not currently support user-pasted static bearer tokens, and query-string tokens are not supported.
- MCP HTTP authorization is OAuth-oriented through protected resource metadata when an MCP server chooses to support auth.

References:

- MCP tools specification: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP authorization specification: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Claude connector authentication docs: https://claude.com/docs/connectors/building/authentication
- Claude MCP connector API docs: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector

## Goals

- Add a gateway-owned, read-only MCP endpoint at `/mcp/v1`.
- Preserve the existing `/mcp` endpoint and its Composio Tool Router proxy behavior unchanged.
- Expose Haverford Gateway metadata as MCP tools:
  - brands
  - regions
  - connectors
  - connections
  - individual connection lookup
- Reuse Phase 2 `GatewayConnectionBackend`, `/api/v1` resource mapping, and `GatewayAccessStore` where possible.
- Support `Authorization: Bearer <gw_live_...>` gateway API key authentication for Hermes, Claude API MCP server definitions, local MCP clients, and service/agent clients.
- Keep Auth Gate identity optional in Phase 3, not mandatory.
- Keep the design compatible with a later Claude.ai hosted connector OAuth flow.
- Record MCP read usage and audit events without raw secrets, query tokens, or provider payloads.

## Non-Goals

- Do not merge local gateway tools into the existing `/mcp` Composio proxy.
- Do not add write-capable MCP tools.
- Do not proxy live provider data through MCP.
- Do not implement OAuth, Dynamic Client Registration, Client ID Metadata Document, token exchange, or protected resource metadata in Phase 3.
- Do not add query-token authentication.
- Do not add `/api/compat` routes.
- Do not implement Nango, Composio OAuth setup, native connector execution, or Google/Shopify provider behavior.

## Recommended Architecture

Add a separate versioned MCP endpoint:

```text
/mcp       -> existing Composio Tool Router proxy, unchanged
/mcp/v1    -> gateway-owned read-only MCP metadata tools
/api/v1    -> gateway-owned HTTP metadata API
```

The `/mcp/v1` handler should be a focused JSON-RPC router, not a Composio proxy extension. It should support the minimum MCP messages needed for Claude/Hermes/local clients to discover and call read-only tools:

```text
initialize
notifications/initialized
tools/list
tools/call
ping
```

This avoids unnecessary custom code because:

- Phase 2 already has the canonical metadata read model.
- Phase 2 already has safe public connection resources and redaction rules.
- Phase 2 already has API clients, keys, scopes, usage, and audit history.
- The existing `/mcp` proxy can remain stable while `/mcp/v1` evolves independently.

The smallest custom surface area is:

- MCP JSON-RPC message parser/dispatcher for `/mcp/v1`.
- Tool definitions and tool-call handlers backed by Phase 2 resources.
- MCP auth middleware that reuses `GatewayAccessStore` for gateway API keys in bearer headers and can optionally read trusted Auth Gate identity headers.
- MCP-specific usage/audit rows using the existing access store.

## Endpoint Versioning

`/mcp/v1` versions the Haverford Gateway MCP tool contract, not the MCP protocol itself.

Versioned contract includes:

- endpoint path
- tool names
- tool descriptions
- input schemas
- output shapes
- auth behavior
- audit metadata conventions

The existing `/mcp` path remains the current Composio proxy path for backwards compatibility.

## Authentication Design

Phase 3 must not require two simultaneous checks. A request is allowed if either path succeeds:

```text
MCP read allowed when:
  valid gateway API key with MCP read scope
  OR trusted Auth Gate identity from an approved user/domain
```

For Phase 3, gateway API-key auth is the primary compatibility path because it works with a normal bearer header for:

- existing Hermes-style gateway clients
- Claude API `mcp_servers[].authorization_token`
- local MCP clients and test clients
- service and agent clients

Auth Gate identity is optional and should be treated as a convenience path for internal browser/proxy environments. It must not be required for Claude connectors.

The existing `/mcp` endpoint continues to use `GATEWAY_BEARER`. `/mcp/v1` should use Phase 2 gateway API keys (`gw_live_...`) for scoped read access. This keeps the legacy shared-secret proxy stable while giving gateway-owned MCP tools per-client scopes, revocation, usage, and audit.

Optional Auth Gate identity should be disabled unless allowlists are configured. Add explicit config:

```text
MCP_AUTH_GATE_ALLOWED_DOMAINS=haverford.au,haverford.com.au
MCP_AUTH_GATE_ALLOWED_USERS=lee@haverford.au
```

Trusted identity headers, in priority order:

```text
x-auth-gate-email
x-forwarded-email
x-user-email
```

Allowed domain matching is exact on the email domain after lowercasing and trimming. Allowed user matching is exact on the full lowercased email. If neither allowlist is configured, Auth Gate identity does not grant `/mcp/v1` access.

### Scopes

Add one new scope:

```text
mcp.read
```

Scope behavior:

- `mcp.read` grants access to all `/mcp/v1` read-only metadata tools.
- Existing granular read scopes may also authorize matching tools:
  - `brands.read` for brand tools
  - `regions.read` for region tools
  - `connectors.read` for connector tools
  - `connections.read` for connection tools
- `mcp.read` is the simplest scope for Claude/API clients.
- Unknown scopes remain rejected by the Phase 2 access store.

### Claude Hosted Connector Compatibility

Phase 3 should not claim to fully support Claude.ai hosted custom connectors with static bearer tokens. Claude's current connector authentication guidance says user-pasted static bearer tokens are not yet supported for hosted connectors and query tokens are not supported.

Therefore:

- `/mcp/v1` should support gateway API keys in bearer headers for clients that can send them.
- `/mcp/v1` should not use query tokens.
- OAuth protected-resource metadata should be designed as the Phase 4 auth path for Claude.ai hosted connectors.
- Phase 3 should keep response and error behavior compatible with adding MCP OAuth later.

## MCP Tool Contract

Initial read-only tools:

```text
gateway_list_brands
gateway_list_regions
gateway_list_connectors
gateway_list_connections
gateway_get_connection
gateway_find_connections
```

### `gateway_list_brands`

Input:

```json
{
  "status": "active | disabled | optional"
}
```

Output:

```json
{
  "brands": [
    {
      "id": "brand_haverford",
      "name": "Haverford",
      "slug": "haverford",
      "status": "active"
    }
  ]
}
```

### `gateway_list_regions`

Input:

```json
{
  "brandId": "optional brand id",
  "status": "active | disabled | optional"
}
```

Output:

```json
{
  "regions": [
    {
      "id": "region_haverford_au",
      "brandId": "brand_haverford",
      "code": "AU",
      "name": "Australia",
      "status": "active",
      "domain": "haverford.au"
    }
  ]
}
```

### `gateway_list_connectors`

Input:

```json
{
  "category": "optional category",
  "backendType": "optional backend type"
}
```

Output:

```json
{
  "connectors": [
    {
      "id": "connector_shopify",
      "slug": "shopify",
      "name": "Shopify",
      "category": "commerce",
      "authMode": "oauth",
      "backendOptions": ["nango", "native"],
      "scopes": ["orders:read"],
      "description": "Commerce storefront orders, customers, and catalog data."
    }
  ]
}
```

### `gateway_list_connections`

Input:

```json
{
  "brandId": "optional brand id",
  "regionId": "optional region id",
  "connectorId": "optional connector id",
  "status": "optional connection status",
  "setupMode": "current | manual_ref | oauth_managed | optional"
}
```

Output uses the Phase 2 `GatewayConnectionApiResource` shape:

```json
{
  "connections": [
    {
      "id": "connection_haverford_au_shopify",
      "brandId": "brand_haverford",
      "regionId": "region_haverford_au",
      "connectorId": "connector_shopify",
      "backendType": "nango",
      "displayName": "Haverford AU Shopify",
      "status": "connected",
      "setupMode": "current",
      "runtimeStatus": "metadata_only",
      "migrationStatus": "not_started",
      "source": "fixture",
      "configSummary": {
        "shop_domain": "haverford-au.myshopify.com"
      }
    }
  ]
}
```

### `gateway_get_connection`

Input:

```json
{
  "connectionId": "connection_haverford_au_shopify"
}
```

Output:

```json
{
  "connection": {
    "id": "connection_haverford_au_shopify"
  }
}
```

The actual response should include the full `GatewayConnectionApiResource`.

### `gateway_find_connections`

Input:

```json
{
  "query": "shopify au"
}
```

Output:

```json
{
  "connections": []
}
```

Search should be simple, deterministic, and local:

- match case-insensitive substrings across display name, connection id, connector slug/name, brand name/slug, region code/name, and safe config summary values.
- no embeddings, no external search, no provider calls.

## MCP Response Format

Tool calls should return both:

- `structuredContent` with the JSON payload.
- `content` with a concise text summary for clients that display text content.

Example:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Found 3 brands."
    }
  ],
  "structuredContent": {
    "brands": []
  },
  "isError": false
}
```

Tool-level validation errors should return `isError: true` in the MCP tool result, not a protocol-level JSON-RPC error. Protocol-level errors should be reserved for invalid JSON-RPC, unknown method, invalid request shape, and server failures outside a tool call.

## Audit And Usage

Record MCP reads using existing Phase 2 persistence:

- `gateway_api_usage`
  - route: `/mcp/v1`
  - method: request method
  - scope: `mcp.read` or matching granular read scope
  - status code: HTTP status when request-level failure, or `200` for JSON-RPC tool-level success/error
- `gateway_audit_events`
  - add actions:
    - `mcp_auth.succeeded`
    - `mcp_auth.failed`
    - `mcp_tool.listed`
    - `mcp_tool.called`
    - `mcp_tool.failed`

Audit metadata may include:

- tool name
- client id
- key fingerprint
- actor email/domain when Auth Gate identity is present
- filter fields used
- result counts

Audit metadata must not include:

- raw Authorization header
- raw API key
- query token values
- provider tokens
- service account JSON
- full provider payloads

## Error Handling

HTTP-level errors:

- missing/invalid gateway API key bearer with no trusted Auth Gate identity: `401`
- missing scope: `403`
- invalid content type or invalid JSON: `400`
- unsupported HTTP method: `405`
- unhandled server error: `500` with generic public message

JSON-RPC errors:

- invalid request: `-32600`
- method not found: `-32601`
- invalid params: `-32602`
- internal error: `-32603`

Tool call errors:

- unknown entity id
- invalid filters
- unsupported tool argument

These should return a `tools/call` result with `isError: true`.

## Local Testing Strategy

Unit tests:

- MCP tool definitions match the intended names and schemas.
- Tool handlers filter brands, regions, connectors, and connections correctly.
- `gateway_get_connection` returns `isError: true` for unknown connection id.
- `gateway_find_connections` matches across connection, brand, region, connector, and safe config fields.
- Tool responses include `structuredContent` and text `content`.
- No raw secret-like values appear in MCP tool output.

Route tests:

- `/mcp` existing Composio proxy behavior is unchanged.
- `/mcp/v1` `initialize` works.
- `/mcp/v1` `tools/list` returns the gateway tools.
- `/mcp/v1` `tools/call` invokes read tools.
- valid gateway API key with `mcp.read` can call all tools.
- valid key with granular read scope can call matching tool and is denied for unrelated tools.
- missing/invalid auth returns `401`.
- Auth Gate identity path works when trusted headers are present and allowlist config permits it.
- query-string tokens are ignored and not audited.
- usage and audit events are recorded without raw secrets.

Local smoke:

- Run `fixture-overlay`.
- Create API client with `mcp.read`.
- Create key.
- Call `/mcp/v1` `tools/list`.
- Call `gateway_list_connections`.
- Restart with same SQLite path.
- Confirm same key still works and usage/audit persisted.

Optional live smoke:

- If local Haverford Dev API is running, run `dev-api-overlay`.
- Confirm Dev API imported connections appear through `gateway_list_connections` as `setupMode="current"`.

## Acceptance Criteria

- `/mcp` still works exactly as the existing Composio proxy.
- `/mcp/v1` exists and exposes read-only gateway metadata tools.
- `/mcp/v1` uses Phase 2 data/resource mapping and does not expose raw secrets.
- Gateway API keys with `mcp.read` can use MCP read tools.
- Granular read scopes work for matching tools.
- Auth Gate identity is optional and does not block bearer-compatible MCP clients.
- No query-token auth is added.
- Current/manual-ref connections are not represented as OAuth-managed.
- Usage and audit events record MCP reads without storing raw credentials.
- No provider execution, OAuth setup, Nango/Composio/native connector execution, or MCP write behavior is added.

## Later Phase Boundaries

- Phase 4: Claude.ai hosted connector OAuth compatibility, including protected resource metadata, authorization server integration, and audience-bound tokens.
- Phase 5: native Google OAuth and credential binding for GA4, GSC, Google Ads, and Merchant Center.
- Phase 6: Shopify app/dashboard layer on top of storefront connections.
- Phase 7: evaluate Nango, Composio, ACI, and Obot against real adapter seams and provider execution needs.
