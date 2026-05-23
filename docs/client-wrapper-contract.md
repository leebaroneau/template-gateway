# Client Wrapper Contract

A client wrapper repo consumes `template-gateway` as a deployable base and owns only client-specific material:

- deployment domain and `API_BASE_URL`
- allowed email domains
- OAuth client IDs and secrets
- static service-token bindings for unattended clients
- provider allowlist
- policy settings
- client-specific native providers
- client-specific docs and smoke tests

The template repo owns:

- MCP, API, and CLI transports
- session and static-token verification
- provider registry
- token storage primitives
- audit log primitives
- Docker runtime
- shared operator commands

Client repos must not fork core gateway auth logic unless they are contributing the change back to `template-gateway`.

## Operational Boundary

Wrappers configure and extend the template. They do not reimplement template-owned gateway primitives.

- Session/static-token verification stays in the template. Wrappers may provide token config and client-specific smoke coverage, but must not replace verifier semantics or constant-time token comparison.
- Provider registration uses the template provider registry. Wrappers may register client-specific providers through the supported extension surface, but must not build a parallel registry or bypass registry validation.
- Policy evaluation stays in the template policy layer. Wrappers may supply policy settings, scopes, and allowlists, but request handling must continue to call the template policy checks.
- Token storage uses the template storage primitives. Wrappers may set store paths, persistence volumes, and rotation runbooks, but must not introduce incompatible token formats or side stores for the same credentials.
- Audit logging uses the template audit primitives. Wrappers may add client-specific audit fields or display conventions through supported hooks, but must not bypass request audit logging for authenticated operations.
