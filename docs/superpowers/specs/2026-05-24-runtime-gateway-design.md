# Runtime gateway — design spec

**Status:** draft for review
**Author:** Lee Barone (with Claude)
**Issue:** TBD (file as Spike or Task once spec is approved)
**Date:** 2026-05-24
**Supersedes (partially):** `2026-05-24-composio-pattern-template-design.md` — that spec said this repo is *not* a runtime service. We're reversing that decision for the reasons in §1.

## 1. Context

After this session's work, Genvest is on a pure-Composio surface: nine `composio-*` MCP server entries in each Hermes profile config, pointing directly at `backend.composio.dev/v3/mcp/<uuid>/mcp?user_id=...`. It works (130 tools, ~80 KB tool schemas in the LLM prompt, well under Haiku's 200 K limit).

What it doesn't give us:
- A **single URL per brand** to point Hermes at — every profile config carries 9 URLs and an entity placeholder per URL.
- A **place to put brand-level concerns** that don't belong in Composio or in every brand's Hermes deploy — audit logging across all tool calls, per-role allowlist overrides, rate limiting, custom composite tools.
- A **lazy tool-loading story** for the future when we add more toolkits and 130 grows to 300+ and we exceed Haiku's context again.
- A **clean parallel to the template-agent pattern** — today `template-agent` is the brand-agnostic image, `agent-genvest` is the brand config repo. We want the same shape for the gateway tier.

This spec proposes a runtime brand gateway that solves all four.

## 2. Goals

- **One MCP endpoint per brand.** Hermes profiles carry exactly one `mcp_servers` entry (the gateway), not 9.
- **Lazy tool loading by default.** Only ~5 meta-tools in the LLM prompt regardless of how many Composio toolkits the brand uses. (Trade-off: search-then-execute pattern adds a reasoning hop; we'll measure with Haiku before deciding to keep it.)
- **Per-profile entity routing.** Each Hermes profile sends its `COMPOSIO_USER_ID` in an HTTP header; gateway translates that into a Composio Tool Router session for that user.
- **Template-image + brand-config-repo pattern.** Matches `template-agent` / `agent-genvest`.
- **Reusable across brands.** Haverford, ALX, etc. consume the same image; their brand config repo wires their own Composio project + allowlists.
- **Side-by-side rollout.** New gateway runs alongside current Hermes-direct-to-Composio setup until validated. No marketing-chat downtime.

## 3. Non-goals

- **Not writing our own MCP server framework.** Composio's Tool Router is the canonical primitive for "single endpoint, dynamic tool discovery, multi-toolkit." We use it; we don't reimplement it.
- **Not reimplementing OAuth.** Composio handles it. Same as today.
- **Not multi-brand-per-deploy.** One brand per deploy. Stays simple.
- **Not stateful audit storage.** v1 logs to stdout / Coolify log stream; if we want persisted audit later that's a follow-up.
- **Not LLM tool-selection logic.** The gateway is dumb; the LLM decides what to call. We just route.

## 4. Architecture

```
Hermes profile config.yaml (in agent-genvest's overlay)
   genvest:
     url: https://gateway.genvest.com.au/mcp
     headers:
       X-Composio-User-Id: ${COMPOSIO_USER_ID}      # per-profile, runtime substituted
       Authorization: Bearer ${GATEWAY_BEARER}      # shared brand secret
        │
        ▼ JSON-RPC over HTTP
gateway-genvest container (template-gateway image)
   - Validates Authorization
   - Reads X-Composio-User-Id
   - Looks up or creates Composio Tool Router session for that userId
   - Forwards JSON-RPC payload to the session URL
        │
        ▼ JSON-RPC over HTTP
Composio Tool Router (backend.composio.dev/v3/tool_router/<session_id>/mcp)
   - Exposes ~5 meta-tools: COMPOSIO_SEARCH_TOOLS, COMPOSIO_EXECUTE_TOOL,
     COMPOSIO_LIST_TOOLKITS, COMPOSIO_LIST_TOOLS, COMPOSIO_GET_REQUIRED_PARAMETERS
   - Behind those: full Composio catalog (9 toolkits for Genvest)
   - Per-user OAuth state managed by Composio
```

## 5. Repo split

| Repo | Role | Branch / status |
|---|---|---|
| `leebaroneau/template-gateway` | Brand-agnostic runtime: src + Dockerfile + scaffolding. Coolify builds the Dockerfile directly from this repo per deploy — no image registry indirection (the build is fast enough that GHCR isn't worth the maintenance cost). | `main` (current scaffolding from PR #9 stays; runtime code added) |
| `genvest/gateway-genvest` | Brand-specific config + deploy. Coolify app points at `leebaroneau/template-gateway` @ `main`, builds the Dockerfile, injects brand env. Repo holds a README documenting the wiring + any brand-only assets (FQDN, etc.). | Wipe current native-OAuth code; replace with thin config repo |
| `genvest/agent-genvest` | (Already on the new pattern.) Brand overlay changes from 9 composio entries → 1 gateway entry; final step after gateway is proven. | Trivial follow-up PR; reversible |

## 6. Runtime code (template-gateway)

Minimal surface — Express server, ~200 LOC excluding tests.

```
template-gateway/
├── src/
│   ├── index.ts                    # Express boot, health endpoint
│   ├── mcp-proxy.ts                # JSON-RPC forwarder to Composio Tool Router
│   ├── session-cache.ts            # In-memory userId → Tool Router session URL
│   ├── auth.ts                     # Bearer token validation
│   └── config.ts                   # Env loader (COMPOSIO_API_KEY, BRAND_SLUG, etc.)
├── test/                           # Vitest unit tests for proxy + cache
├── Dockerfile                          # Coolify builds from source on each deploy (no registry)
├── package.json
└── (existing scaffolding stays: allowlists/, scripts/, overlay-templates/, docs/)
```

**Behaviour:**

1. `POST /mcp` — receives JSON-RPC payload from Hermes.
2. Validates `Authorization: Bearer <GATEWAY_BEARER>`. Reject with 401 on mismatch.
3. Reads `X-Composio-User-Id` header. Reject with 400 if missing.
4. Looks up `(userId → session URL)` in in-memory cache.
   - Cache miss: `composio.toolRouter.create(userId, {...})` → store URL + expiry.
   - Cache hit but expired: refresh same way.
5. Forwards the JSON-RPC payload to the Tool Router URL (with Composio API key header).
6. Streams response back to Hermes.

**Session management:** Composio Tool Router sessions are `trs_*` IDs with TTL (TBD — confirm during impl). Cache them per `userId` with a conservative refresh-before-expiry; rebuild on cold start.

**GET /health** — returns 200 with brand slug + cached session count for monitoring.

## 7. Brand config (gateway-genvest after wipe)

```
gateway-genvest/
├── README.md                       # documents Coolify wiring (source repo, env vars, FQDN)
├── .env.example                    # COMPOSIO_API_KEY, BRAND_SLUG, GATEWAY_BEARER (for local dev only)
└── .github/                        # optional Pipeline Core configs if we want lints to apply here
```

The Coolify app for `gateway-genvest` is configured to:

1. Build source from `leebaroneau/template-gateway` @ `main` (the runtime repo).
2. Use the Dockerfile at the root of that repo.
3. Inject brand-specific env (`COMPOSIO_API_KEY`, `BRAND_SLUG=genvest`, `GATEWAY_BEARER`, optional `TOOLKIT_ALLOWLIST`).
4. Expose port 3000 with Traefik labels for `gateway.genvest.com.au` (and initially `gateway.209.38.27.69.sslip.io`).

`gateway-genvest`'s repo itself only contains documentation + brand-only assets — no compose file, no Dockerfile. The deploy lives in Coolify config.

## 8. Env contract

Template-gateway reads:

| Var | Required? | Meaning |
|---|---|---|
| `COMPOSIO_API_KEY` | yes | Org-level Composio key for the brand's project |
| `COMPOSIO_PROJECT_ID` | optional | Constrain Tool Router to a specific project (defaults to key's primary) |
| `BRAND_SLUG` | yes | e.g. `genvest` — used in logs and as default user_id when header missing |
| `GATEWAY_BEARER` | yes | Shared secret Hermes uses to authenticate to the gateway |
| `TOOLKIT_ALLOWLIST` | optional | Comma-separated toolkits the gateway will route to (e.g. `outlook,onedrive,pipedrive,microsoft_teams,zoom,docusign,google_analytics,google_search_console,microsoft_clarity`). Defaults: all toolkits the API key has access to |
| `PORT` | optional | Defaults to 3000 |

`agent-genvest` Coolify env stays simple — it stops needing `COMPOSIO_API_KEY` once the gateway owns it; it just needs `GATEWAY_BEARER` (the same secret).

## 9. Validation plan (the "don't swap until proven" rollout)

This is the gating section. We do NOT touch agent-genvest's overlay until every step here passes.

**Phase A — Prep, no production impact:**

1. Shut down the OLD `gateway-genvest` Coolify app (frees `api.genvest.com.au` and the project slot).
2. In `leebaroneau/template-gateway`, implement the runtime code + Dockerfile. No image registry — Coolify builds from source directly on each deploy.
3. In `genvest/gateway-genvest`, wipe + replace with thin docs-only repo. Coolify app reconfigured to build from `leebaroneau/template-gateway` @ `main` with brand env, expose at `gateway.209.38.27.69.sslip.io` (sslip.io for now; DNS for `gateway.genvest.com.au` switches later).

**Phase B — Out-of-band validation:**

4. `curl https://gateway.209.38.27.69.sslip.io/health` returns brand slug + uptime.
5. `curl -X POST .../mcp -H "Authorization: Bearer ..." -H "X-Composio-User-Id: genvest-head-of-marketing" --data '{"jsonrpc":"2.0",...}'` succeeds with a valid MCP initialise + tools/list response.
6. Validate the response contains the ~5 meta-tools (search_tools, execute_tool, etc.) and NOT the 130 toolkit tools.
7. Drive an end-to-end tool call (`search_tools` → `execute_tool`) via curl. Verify Composio responds with real data.

**Phase C — Side-by-side in Hermes:**

8. Add a SECOND `mcp_servers` entry on ONE non-critical profile (e.g. `genvest-ceo`, low traffic): leave the 9 existing `composio-*` entries in place, add `genvest_gateway` pointing at the new gateway.
9. Send chat: "Connect my Outlook" — should route through the gateway, lazy-load the OUTLOOK_INITIATE_CONNECTION tool, return the OAuth URL.
10. Validate that genvest-ceo can use BOTH paths (the legacy 9 entries AND the new gateway) without conflict. Either is fine to call.

**Phase D — Cut over (only after C is solid):**

11. Update `agent-genvest`'s overlay: drop 9 `composio-*` entries, add 1 `genvest` entry pointing at the gateway. Header: `X-Composio-User-Id: ${COMPOSIO_USER_ID}`.
12. Open agent-genvest PR; merge; Coolify auto-deploys; verify all six profiles.
13. Drop `COMPOSIO_API_KEY` from agent-genvest Coolify (still needed in gateway-genvest's Coolify).

**Phase E — DNS finalize:**

14. Point `gateway.genvest.com.au` DNS at the Coolify Traefik. Update the gateway-genvest Coolify FQDN. Update agent-genvest overlay URL.

Each phase is reversible — a revert PR on agent-genvest's overlay returns to today's working state.

## 10. Open design choices (decide during implementation, not now)

- **Session TTL.** What's Composio Tool Router's actual session lifetime? Refresh strategy?
- **Cache persistence.** Pure in-memory is simplest. Coolify volume persistence helps survive restarts but adds complexity. Lean in-memory until we feel cold-start pain.
- **Allowlist enforcement location.** Composio Tool Router lets the LLM search across ALL toolkits the API key can see. Per-brand we might want to constrain (e.g. block Slack tools for a brand that hasn't opted in). Implement via gateway-side filter or Composio's project scoping?
- **Audit logging shape.** v1 = stdout. v2 might write to a brand audit store. Out of scope.
- **Composite tools.** Future custom tools (e.g. atomic "DocuSign + Pipedrive update") are easy to add as additional MCP tools the gateway exposes alongside the Tool Router. Out of scope for v1.

## 11. Risks

- **Composio Tool Router availability.** If their service is down, every brand's chat breaks. Mitigation: keep agent-genvest's 9 direct composio entries in a `legacy/` overlay so we can swap back in under a minute. Add to runbook.
- **Search-then-execute LLM cost.** Haiku does worse with the indirection. Possible mitigation: SessionPreset.DIRECT_TOOLS mode for specific tools (always-on Outlook + Pipedrive surface), search-then-execute for the long tail. Measure first.
- **Session leak.** If userId → session cache grows unbounded, memory creeps. Bounded LRU + TTL cleanup.
- **SDK drift.** `@composio/core` has shown breaking changes (allowedTools-on-update silently dropped). Pin the version; smoke-test before each deploy via the validation plan in §9.

## 12. Approval checkpoint

This is design only. After approval:

1. New issue on `leebaroneau/template-gateway` ("Task: implement runtime gateway per spec").
2. Branch `task/<#>-runtime-gateway`.
3. Single PR: runtime code + Dockerfile + tests + docs update + README pivot back. (Initial scope was three smaller PRs; bundled because the tests + docs are tightly coupled to the code.)
4. Separate issue + PR on `genvest/gateway-genvest` to wipe + reconfigure.
5. Phase D's `agent-genvest` overlay swap is a third small PR.

Implementation plan goes into `writing-plans` once this spec is approved.

## 13. What this spec deliberately does NOT decide

- Exact in-memory cache eviction policy (LRU? simple TTL? hybrid?). Implementation choice.
- Audit log format. v1 just emits structured JSON to stdout; format can iterate.
- Whether to bundle the scaffolding (`allowlists/`, `scripts/`, `overlay-templates/`) with the runtime in the same npm package, or split into two packages. Keep together for now — same repo, just adds a `src/` for runtime.

## 14. Rollback story

If Phase D goes wrong: revert the agent-genvest overlay PR. Hermes profiles fall back to today's working 9-composio-entry config on next deploy (~2 minutes). No data loss; no Composio state lost; gateway-genvest can stay running idle (or be paused).
