# Legacy — pre-2026-05-24 native-OAuth gateway

This folder holds the original purpose of `template-gateway`: a runtime MCP/HTTP gateway that handled OAuth natively for Microsoft 365, Pipedrive, and (planned) Google Workspace.

## Why it's still here

- It's well-tested. PR #5 (2026-05-23) landed a complete Codex security review covering path-traversal, OData injection, refresh-race, and audit-log redaction.
- The token-refresh logic, scope enforcement, and `graph_request` allowlist patterns might be useful reference if a future brand needs a proxy Composio doesn't cover.
- Deleting costs nothing implementation-wise (git history has it) but the lookup cost is non-zero.

## Why we stopped using it

Composio replaces it. One auth config in Composio's dashboard covers what this codebase implements for one toolkit — and Composio supports ~250 toolkits with no per-toolkit code maintenance. Genvest hit the practical limit on building this from scratch when admin-consent in the Genvest Microsoft tenant blocked rollout and we pivoted to Composio in a single session.

See `docs/superpowers/specs/2026-05-23-composio-provider-design.md` and `2026-05-24-google-native-and-composio-demotion-design.md` for the historical decision trail.

## What lives in here

- `src/` — TypeScript source (Express HTTP API, MCP server, providers, audit, auth)
- `test/` — Vitest suite (kept passing as of fd76a91)
- `Dockerfile` + `docker-compose.yaml` — runtime container
- `tsconfig.json` — TypeScript build config

The dependencies these files reference are NOT in the new top-level `package.json`. If you want to run the legacy code, copy this folder out of the repo, add its dependencies (`@modelcontextprotocol/sdk`, `express`, `commander`, etc.), and run `npm install` + `npm run dev` from there.

## Don't extend this

The active surface of this repo is now the scaffolding at the root level (see top-level README). Do not add new features or fixes inside `legacy/` — open a separate repo if you need to revive the native-OAuth approach for a new use case.
