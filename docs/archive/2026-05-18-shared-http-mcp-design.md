# Shared HTTP MCP for Genvest Hermes Profiles

**Date:** 2026-05-18
**Status:** Draft — pending implementation
**Owner:** Lee Barone
**Scope:** `Genvest-Property/service-api` + per-profile Hermes config on the genvest droplet

## Problem

Three Hermes profiles on the genvest droplet (`genvest-head-of-customer-service`, `genvest-head-of-sales`, `genvest-head-of-marketing`) each spawn their own stdio MCP subprocess from `/data/mcp/genvest-service-api/dist/`. They run the same compiled code with different env vars (actor identity, pipeline access scope, audit-note flag). A fourth copy — the Coolify-deployed HTTP service-api at `https://service-api.209.38.27.69.sslip.io` — sits unused.

The stdio subprocesses don't auto-update on PRs. They drifted by several days before the user noticed (PRs #1 and #2 on `service-api` merged and Coolify-deployed, but the stdio dist was stale, so the bots ran old code).

## Goal

Make the Coolify-deployed HTTP MCP the single source of truth. Each Hermes profile connects via HTTP, identifies itself via a profile-bound bearer token, and gets the correct access scope applied per request. PRs to `service-api` deploy to Coolify and immediately reach every bot — no manual sync, no per-profile subprocess restart.

## Non-Goals

- Pipedrive seat-per-bot.
- OAuth-per-bot flow.
- Renaming or repurposing `PIPEDRIVE_WRITE_AUDIT_NOTES`.
- Changing the Coolify-deployed app's URL, port, or container shape.
- Adding any new external dependencies.

## Architecture

Token-bound profile resolution. Each profile gets one static bearer token (rotatable). The token implies the profile; the profile implies the scope. Header-based profile claims are explicitly rejected — a misconfigured Hermes profile cannot escalate scope.

```
Hermes profile config (config.yaml)
  headers: { Authorization: Bearer <profile-token> }
       │
       ▼
service-api HTTP /mcp
  └─ auth verifier resolves token → AuthInfo{ email, name, profile, isStaticServiceToken }
       │
       ▼
  Tool handler reads extra.authInfo.extra.profile
       │
       ▼
  ProfileConfig lookup → ActorOpts.scope { accessMode, pipelineIds, auditNotes, actor }
       │
       ▼
  services.ts honors per-request scope (overrides this.config defaults)
```

## Detailed design

### 1. Static bearer auth path

`src/auth/session-tokens.ts::verifyAccessToken` is extended to check the static `apiBearerTokens` list before falling through to the existing Pipedrive-OAuth session lookup. On match, it returns:

```ts
{
  token,
  clientId: "static-service-token",
  scopes: [],
  expiresAt: <far-future>,
  resource: undefined,
  extra: {
    email,
    name,
    profile,                  // NEW
    isStaticServiceToken: true // NEW
  }
}
```

On no match, falls through to the existing OAuth-session lookup path unchanged.

### 2. Token format extension

`API_BEARER_TOKENS` env is parsed today as `token:email[,token:email]*`. Extended to `token:email:profile`:

```
API_BEARER_TOKENS=tok_cs_abc...:cs_genvest_bot@genvest.com.au:genvest-head-of-customer-service,tok_sales_def...:co_genvest_bot@genvest.com.au:genvest-head-of-sales,tok_m_ghi...:m_genvest_bot@genvest.com.au:genvest-head-of-marketing
```

Validation:
- Each entry must have three colon-separated fields.
- Profile must exist as a key in `HERMES_PROFILES_JSON` (validated at startup; service fails to boot on mismatch).
- Email must match `ALLOWED_EMAIL_DOMAIN` (existing rule).
- Tokens must be ≥32 characters of `[A-Za-z0-9_-]` (existing-style; entropy enforcement).

### 3. Per-profile config

New env `HERMES_PROFILES_JSON` is a JSON object keyed by profile name:

```json
{
  "genvest-head-of-customer-service": {
    "actorEmail": "cs_genvest_bot@genvest.com.au",
    "actorName": "@cs_genvest_bot",
    "pipedriveAccessMode": "pipeline-write",
    "pipedriveWritePipelineIds": [4],
    "pipedriveWriteAuditNotes": true
  },
  "genvest-head-of-sales": {
    "actorEmail": "co_genvest_bot@genvest.com.au",
    "actorName": "@co_genvest_bot",
    "pipedriveAccessMode": "pipeline-write",
    "pipedriveWritePipelineIds": [2],
    "pipedriveWriteAuditNotes": true
  },
  "genvest-head-of-marketing": {
    "actorEmail": "m_genvest_bot@genvest.com.au",
    "actorName": "@m_genvest_bot",
    "pipedriveAccessMode": "read-only",
    "pipedriveWritePipelineIds": [],
    "pipedriveWriteAuditNotes": false
  }
}
```

The existing process-level env defaults (`PIPEDRIVE_ACCESS_MODE`, `PIPEDRIVE_WRITE_PIPELINE_IDS`, `PIPEDRIVE_WRITE_AUDIT_NOTES`, `GENVEST_MCP_ACTOR_*`) remain as fallbacks for non-bot callers (e.g., a future Claude.ai OAuth user with no profile binding). When the auth path is a static service token, the profile config overrides them entirely.

### 4. Per-request scope plumbing

`ActorOpts` (in `src/services.ts`) gains an optional `scope` field:

```ts
export interface ActorOpts {
  actorEmail?: string;
  actorName?: string;
  scope?: {
    pipedriveAccessMode: "read-only" | "pipeline-write" | "unrestricted";
    pipedriveWritePipelineIds: number[];
    pipedriveWriteAuditNotes: boolean;
    isStaticServiceToken: boolean;
  };
}
```

Methods on `BrandInsightsService` that currently read `this.config.pipedrive*` are refactored to read `opts.scope ?? this.config` via a single private helper:

```ts
private scopeFor(opts: ActorOpts): {
  accessMode: ...;
  pipelineIds: number[];
  auditNotes: boolean;
} {
  return opts.scope ?? {
    accessMode: this.config.pipedriveAccessMode,
    pipelineIds: this.config.pipedriveWritePipelineIds,
    auditNotes: this.config.pipedriveWriteAuditNotes
  };
}
```

Affected methods: `requireGenericPipedriveWriteAccess`, `requireDealInAllowedPipeline`, `requireAllowedPipelineId`, `writePipedriveAuditNoteForDeal`, `applyInlineAuditSuffix`, `requireUserAccessForWrite`.

`requireUserAccessForWrite` additionally skips its check when `opts.scope?.isStaticServiceToken === true` — a static service token explicitly grants write access without needing user OAuth.

### 5. Tool handler glue

`src/tools/shared.ts` gains a helper:

```ts
export function scopeFromExtra(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  profiles: Record<string, ProfileConfig>
): { actorEmail?: string; actorName?: string; scope?: ActorOpts["scope"] } {
  const profileName = extra.authInfo?.extra?.profile;
  if (typeof profileName !== "string" || !profiles[profileName]) return {};
  const p = profiles[profileName];
  return {
    actorEmail: p.actorEmail,
    actorName: p.actorName,
    scope: {
      pipedriveAccessMode: p.pipedriveAccessMode,
      pipedriveWritePipelineIds: p.pipedriveWritePipelineIds,
      pipedriveWriteAuditNotes: p.pipedriveWriteAuditNotes,
      isStaticServiceToken: extra.authInfo?.extra?.isStaticServiceToken === true
    }
  };
}
```

Existing `actorEmailFromExtra` / `actorNameFromExtra` lookups in `register.ts` and `generated.ts` are wrapped: prefer the profile-derived values when present; fall through to the existing OAuth-based lookup otherwise.

`createMcpServer` is updated to accept the `profiles` map alongside its existing `config` option, so handlers can call `scopeFromExtra` without each looking up env.

### 6. Pipedrive token used for writes

For static service tokens, `getPipedriveAccessToken(opts.actorEmail)` will not find a per-user OAuth record. The downstream `PipedriveConnector.request` falls back to the shared `PIPEDRIVE_API_TOKEN` from env — same as today's stdio behavior. Writes attribute in Pipedrive UI to whoever owns the API token; the bot identity is delivered via the inline audit suffix shipped in PRs #1 and #2.

### 7. Hermes-side config

Each profile's `/data/hermes/profiles/<profile>/config.yaml` `mcp_servers.genvest` block changes from:

```yaml
genvest:
  command: /data/mcp/genvest-service-api/scripts/run-hermes-mcp.sh
  args: [customer-service]
```

to:

```yaml
genvest:
  url: "https://service-api.209.38.27.69.sslip.io/mcp"
  headers:
    Authorization: "Bearer <profile-specific-token>"
  enabled: true
  timeout: 120
  connect_timeout: 60
  tools:
    # preserved from existing config
```

Existing `tools.include` / `tools.exclude` blocks (if any) are preserved verbatim.

### 8. Cleanup (after migration)

- Delete `/data/mcp/genvest-service-api/` from the Hermes container volume.
- Delete the `run-hermes-mcp.sh` launcher.
- Remove `GENVEST_MCP_ACTOR_EMAIL`, `GENVEST_MCP_ACTOR_NAME`, per-profile `PIPEDRIVE_*` from each profile's `.env` (the env vars are now superseded by `HERMES_PROFILES_JSON` on the Coolify side).

## Testing

Existing 87 tests in `service-api` stay green.

New tests (estimated 6-8 cases, one new file `test/static-bearer-auth.test.ts`):

1. **Static token resolves to AuthInfo with profile** — given a configured token, `verifyAccessToken` returns the expected `extra.profile` and `isStaticServiceToken: true`.
2. **Unknown token falls through to OAuth path** — does not match static, doesn't synthesize, returns InvalidTokenError as today.
3. **Token referencing unknown profile fails at startup** — `parseBearerTokens` throws during config load.
4. **Profile scope (read-only) blocks writes** — `requestPipedrive` with the marketing profile rejects a POST to `/v1/notes`.
5. **Profile scope (pipeline-write) blocks wrong pipeline** — CS profile writing to pipeline 2 is rejected.
6. **Profile scope (pipeline-write) allows correct pipeline** — CS profile writing to pipeline 4 succeeds.
7. **Static token bypasses requireUserAccessForWrite** — write succeeds with no user OAuth token in store.
8. **Profile-derived actor name flows into audit suffix** — POST `/v1/notes` body suffix uses the profile's `actorName`.

## Rollout

Each step is independently reversible (rollback = restore old config.yaml + restart that one gateway).

| Step | Action | Verification |
|---|---|---|
| 1 | Open service-api PR with code + tests. Merge. | Coolify deploys; HTTP MCP `/mcp` responds; new tests pass in CI. |
| 2 | Generate three profile tokens (≥32 chars each). Set `API_BEARER_TOKENS` and `HERMES_PROFILES_JSON` in Coolify env. Redeploy. | `curl` with each token to `/mcp` `initialize` succeeds; wrong-profile writes are blocked. |
| 3 | Update CS profile's `config.yaml` to HTTP + token. Restart `genvest-head-of-customer-service` gateway. | Bot replies; test note shows inline suffix with `@cs_genvest_bot`. |
| 4 | Repeat for sales + marketing. | Both bots respond; marketing can't write (read-only). |
| 5 | Delete `/data/mcp/genvest-service-api/`, the launcher script, and stale env vars. | Hermes still runs; bots still work. |

## Risks

- **Token leak.** Static bearer tokens grant scope without user interaction. Mitigations: stored only in Coolify env and Hermes profile configs (both root-owned on the droplet); rotatable by replacing the env value and per-profile config; tokens are profile-bound, so a leaked token can only act as that profile's scope (not escalate).
- **Coolify outage = all bots down.** Today's stdio path is independent of Coolify. After migration, the HTTP MCP container becomes a SPOF for bot writes. Acceptable given Coolify's track record on this droplet and the operational gain. Manual rollback available via step-5-reverse.
- **Cold session restart on Coolify redeploy.** Each Coolify redeploy invalidates Hermes's MCP session ID. The MCP SDK's `404 → re-initialize` flow (already wired in `http.ts:174`) handles this transparently.

## Open questions

None blocking. Items for future PRs:

- Audit log enrichment with the static-token request count (operational visibility).
- Per-token rate limit (defensive; no current need).
- Switching ALX Hermes profiles to the same HTTP model when/if they consolidate similarly.
