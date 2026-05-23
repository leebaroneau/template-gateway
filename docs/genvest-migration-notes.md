# Genvest Migration Notes

The current Genvest production MCP lives in `genvest/00_repos/service-api`.
Use that repo's README section `Authentication: Static Service Tokens (Hermes Bots)` as source context before migration work; it documents the current protected bot-auth call chain and the tests that guard it.

## Protected Migration Checklist

- [ ] Preserve profile-bound `API_BEARER_TOKENS`: each static token remains a `token:email:profile` binding, not a bearer token with global write rights.
- [ ] Preserve `HERMES_PROFILES_JSON` cross-validation: startup must fail when a bearer token references a missing profile or mismatched actor email.
- [ ] Preserve per-request scope plumbing: profile scope must flow from auth metadata into each guarded request instead of falling back to global config.
- [ ] Preserve no shared fallback for writes: shared Pipedrive API tokens may support legacy reads, but every write must require the caller's connected OAuth token.
- [ ] Preserve pipeline body/stage checks: scoped deal updates must validate the deal's current pipeline, requested `pipeline_id` / `pipelineId`, and requested `stage_id`.
- [ ] Preserve static-token audit endpoint rejection: static service tokens must not be able to read `/audit/recent` or `audit_recent_requests`.
- [ ] Preserve the inline audit prefix: bot-created notes and activities must keep the visible `<actor>:\n\n` prefix before reaching Pipedrive.
- [ ] Preserve actor sanitisation: audit actors must be stripped of CR/LF before interpolation into Pipedrive-visible text.
- [ ] Keep `/mcp` aliasing behavior until Hermes profiles move to provider-specific URLs.
- [ ] Migrate in a new branch and issue inside the Genvest repo because it has Pipeline Core governance.

The first Genvest wrapper should be named `genvest-gateway` unless Lee keeps `service-api` for continuity.
