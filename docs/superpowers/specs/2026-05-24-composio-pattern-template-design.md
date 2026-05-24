# Composio-pattern template — design spec

**Status:** draft for review
**Author:** Lee Barone (with Claude)
**Issue:** [leebaroneau/template-gateway#6](https://github.com/leebaroneau/template-gateway/issues/6)
**Date:** 2026-05-24

## Context

This repo (`leebaroneau/template-gateway`) was built as a native-OAuth Microsoft Graph proxy (PR #5, merged 2026-05-23, archived 2026-05-24). It got replaced by Composio before Genvest ever shipped on it — Composio handles OAuth, token refresh, scope governance, and tool surface for ~250 toolkits with no per-toolkit code to maintain.

The decisive engineering work for Genvest today was figuring out **how to integrate Composio** without blowing the Haiku 200K-token ceiling. The answer: per-toolkit MCP servers + `allowedTools` whitelists + per-profile entity IDs (per-bot OAuth) + shared brand entity for analytics. Persisted via brand-overlay + per-profile env sync.

That pattern is reusable for any future brand (Haverford, ALX Finance, ...). Today it lives only in chat history and Genvest's deploy repo. This repo's new job is to codify it so brand #2 takes 30 minutes to onboard, not half a day.

## Goals

- A single source of truth for the Composio-pattern (architecture doc, reference allowlists, overlay templates, helper scripts).
- A scaffold script (`scripts/composio-create-servers.mjs`) that takes a brand name + auth config IDs + allowlist files and creates the Composio MCP servers, returning the URLs to paste into the brand's deploy overlay.
- A "new brand" walkthrough that takes someone from a fresh Composio project → working Hermes profile in well under an hour.
- A "new toolkit for an existing brand" walkthrough.
- Reference allowlists per toolkit (Outlook, OneDrive, Pipedrive, GA4, GSC, Clarity, Teams) — extracted from what Genvest is using today.

## Non-goals

- Runtime code (no Express, no MCP server implementation, no proxy logic — Composio owns that).
- Brand-specific config (allowlists are generic per-toolkit; brand customisation happens in the brand's own deploy repo).
- A build/deploy target (this is reference scaffolding, not a deployable service).
- A Composio replacement or fallback (if Composio is down, brands degrade with it — out of scope).
- Generating brand overlays in-place (templates exist; rendering them is the brand's job).

## Repo layout (proposed)

```
template-gateway/
├── README.md                              ← new front-door: what this repo is, when to use it
├── docs/
│   ├── architecture.md                    ← the Composio-pattern itself (per-toolkit + allowlists + entities)
│   ├── adding-a-brand.md                  ← step-by-step onboarding for a new brand
│   ├── adding-a-toolkit.md                ← adding a toolkit to an existing brand
│   └── superpowers/specs/                 ← spec history (this file + previous archived designs)
├── scripts/
│   ├── composio-create-servers.mjs        ← scaffold: create N MCP servers from N allowlists
│   ├── composio-list-tools.mjs            ← probe Composio for a toolkit's full catalog
│   └── composio-rotate-key.mjs            ← lifecycle helper (rotate API key / JWT, re-deploy)
├── overlay-templates/
│   ├── per-profile-toolkit.yaml           ← envsubst template; uses ${COMPOSIO_USER_ID}
│   ├── shared-toolkit.yaml                ← envsubst template; hardcoded brand entity
│   └── README.md                          ← how brand overlays compose these
├── allowlists/
│   ├── outlook-mail-calendar.json         ← 15 outlook tools (the set Genvest uses today)
│   ├── onedrive-files.json                ← 12 onedrive tools
│   ├── pipedrive-crm.json                 ← 18 pipedrive tools
│   ├── ga4-reporting.json                 ← 10 ga4 tools (read-only)
│   ├── gsc-search.json                    ← 6 gsc tools (read-only)
│   ├── clarity-export.json                ← 1 clarity tool
│   └── teams-messaging.json               ← TBD when Teams toolkit lands
├── legacy/                                ← (decision: keep, see below)
│   └── README.md                          ← "this is the pre-2026-05-24 native-OAuth code"
└── package.json                           ← dev deps for scripts (@composio/core, minimist)
```

## Scaffold script — signature

```bash
node scripts/composio-create-servers.mjs \
  --brand <brand-slug> \
  --allowlists allowlists/outlook-mail-calendar.json,allowlists/onedrive-files.json,... \
  --auth-configs '{"outlook":"ac_abc","one_drive":"ac_def","pipedrive":"ac_ghi","google_analytics":"ac_jkl","google_search_console":"ac_mno","microsoft_clarity":"ac_pqr"}' \
  --shared-entity-toolkits google_analytics,google_search_console,microsoft_clarity \
  --output overlays/<brand>-composio.yaml
```

**Behaviour:**
1. Reads each allowlist JSON: `{ "toolkit": "outlook", "tools": [...] }`.
2. For each allowlist, calls `composio.mcp.create()` with the toolkit + auth config ID + allowed tools.
3. Generates URLs:
   - Per-profile toolkits: URL contains `?user_id=${COMPOSIO_USER_ID}` (placeholder for runtime substitution by Hermes).
   - Shared-entity toolkits (per the `--shared-entity-toolkits` flag): URL contains `?user_id=<brand-slug>` hardcoded.
4. Writes a brand overlay fragment (YAML) to `--output` path. The brand's deploy repo copies this fragment into its overlay.
5. Prints the MCP server IDs so they can be cross-referenced in Composio dashboard.

**Idempotency:** if a server with the same `name` already exists, the script updates the allowlist on it (Composio's `mcp.update` supports allowlist updates) rather than creating duplicates.

## Allowlist file format

```json
{
  "toolkit": "outlook",
  "description": "Mail + calendar + contacts (read + send/edit)",
  "tools": [
    "OUTLOOK_LIST_MESSAGES",
    "OUTLOOK_GET_MESSAGE",
    "..."
  ]
}
```

Allowlists are extracted from what Genvest is using today and live as committed reference. Brands that want different surfaces fork the JSON and pass their own path to the script.

## Overlay templates

`overlay-templates/per-profile-toolkit.yaml`:

```yaml
${TOOLKIT_KEY}:
  url: ${MCP_BASE_URL}/${SERVER_ID}/mcp?include_composio_helper_actions=true&user_id=$${COMPOSIO_USER_ID}
  headers:
    x-api-key: $${COMPOSIO_API_KEY}
  timeout: 120
```

The script renders these with `envsubst` (POSIX, no jinja dependency). `$$` is preserved for the runtime Hermes substitution layer.

`overlay-templates/shared-toolkit.yaml` is the same but with `user_id=${BRAND_SLUG}` rendered at scaffold time (Hermes doesn't re-substitute it).

## "Adding a new brand" walkthrough (in docs/adding-a-brand.md)

1. **Composio dashboard:** create the project + 6 auth configs (5 OAuth + Clarity API key).
2. **Local clone:** clone this repo, `npm install`.
3. **Run the script** with brand-specific args; outputs `overlays/<brand>-composio.yaml`.
4. **Brand deploy repo:** copy the generated overlay fragment into `runtime/<brand>/hermes/overlays/<brand>.yaml`.
5. **Brand deploy repo:** add a `sync_per_profile_composio_env()` to its docker-compose runtime-seed (template available in this repo's docs).
6. **Coolify env:** set `COMPOSIO_API_KEY=<value>`.
7. **Per-profile sign-in:** each bot user does `Connect my Outlook` in chat.

Estimated effort: ~30 minutes for someone who has done it once.

## "Adding a new toolkit to an existing brand" walkthrough (in docs/adding-a-toolkit.md)

1. **Composio dashboard:** create the auth config.
2. **Probe** the new toolkit with `scripts/composio-list-tools.mjs --toolkit <slug>`.
3. **Allowlist:** write `allowlists/<toolkit>-<purpose>.json`.
4. **Re-run scaffold** for that one toolkit; appends the new server entry to the brand overlay fragment.
5. **PR the brand's overlay change**; deploy.

## Legacy code disposition

**Decision: move existing `src/`, `test/`, `Dockerfile`, etc. into `legacy/` and add a `legacy/README.md` explaining what it is.**

Reasoning:
- The native-OAuth code is well-tested (PR #5 had a full Codex security review) and might be a useful reference if a brand ever needs a custom proxy Composio doesn't cover.
- Deleting it costs no implementation time but loses the reference value.
- Keeping it at the root would be confusing — the new repo purpose is scaffolding, not runtime code.
- A `legacy/` folder is the standard signal: "this used to be the point of the repo; here's where it lives now."

Alternative (rejected): delete the code outright. Reason for rejection: easy to grab from git history if we want it back, but the lookup cost is non-zero and the reference value (security review, error handling for token refresh, etc.) is high.

## Open questions resolved

| Question | Answer |
|---|---|
| Where to save the spec? | `docs/superpowers/specs/2026-05-24-composio-pattern-template-design.md` (this file) |
| jinja vs envsubst for templates? | **envsubst.** POSIX, no new dep. Already used by docker-compose runtime-seed; consistent. |
| npm script CLI vs standalone? | **npm script.** Stays in this repo; users run `npm run create-servers -- --brand <x>`. |
| Repo location? | Un-archive `leebaroneau/template-gateway` (decided 2026-05-24). |
| Auth config creation in script? | No — Composio dashboard. Auth config setup for OAuth needs a redirect-URI step that isn't pure API anyway. |

## Implementation plan (sketched, not part of this spec)

Once this spec is approved:

1. **PR A — Legacy archive + new README + scaffolding folders empty.** Just the file moves, README rewrite, and the empty `scripts/`, `overlay-templates/`, `allowlists/` folders with `.gitkeep`. No code yet. Fast to review.
2. **PR B — Allowlists committed.** All 6 allowlist JSONs extracted from Genvest's current setup. No script yet, but allowlists are usable manually.
3. **PR C — Scaffold script.** `scripts/composio-create-servers.mjs` + `scripts/composio-list-tools.mjs` + tests against the live Composio API.
4. **PR D — Walkthrough docs.** `docs/adding-a-brand.md` + `docs/adding-a-toolkit.md`. Probably tested by onboarding Haverford or ALX Finance as a real first run.
5. **PR E — Spec for `composio-rotate-key.mjs`** (lifecycle).

Each PR is mergeable on its own. PRs B–E can land in any order after A.

## Risks

- **Composio breaking changes.** Their SDK/API has shifted under us today (allowedTools-on-update silently dropped). The scaffold script and its dependencies should pin to a tested `@composio/core` version. Risk: future Composio releases break the script. Mitigation: pin + CI smoke test against live API on a stub project.
- **Spec drift.** If Genvest's overlay evolves but this repo doesn't, the "reference" stops reflecting reality. Mitigation: this repo's docs link back to Genvest's overlay as the canonical live example; cross-PR discipline when both change.
- **Auth config IDs leaking.** Auth config IDs aren't secrets but appearing in committed allowlist examples could surprise users. Mitigation: examples use `ac_PLACEHOLDER` strings only; real IDs only in brand deploy repos.

## What this spec deliberately does NOT decide

- The exact `outlook` allowlist contents — captured by extraction from Genvest's live setup, not hand-curated here. PR B will commit them.
- The `composio-rotate-key.mjs` UX — deferred to PR E once we've actually rotated a key in production.
- Whether to add other brands' overlays into this repo as examples. Tentative answer: no — keep brand overlays in brand repos to avoid contamination.

## Approval checkpoint

This is a design spec, not an implementation plan. After review, the next step is to invoke the writing-plans skill to break PR A into actionable tasks. Implementation does not start until both:
- This spec is approved.
- PR A's implementation plan is approved.
