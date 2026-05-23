# Genvest Migration Notes

The current Genvest production MCP lives in `genvest/00_repos/service-api`.

Migration rules:

1. Preserve static Hermes bot protections from the existing README.
2. Preserve profile-bound pipeline write scopes.
3. Preserve Pipedrive-visible audit attribution.
4. Keep `/mcp` aliasing behavior until Hermes profiles move to provider-specific URLs.
5. Migrate in a new branch and issue inside the Genvest repo because it has Pipeline Core governance.

The first Genvest wrapper should be named `genvest-gateway` unless Lee keeps `service-api` for continuity.
