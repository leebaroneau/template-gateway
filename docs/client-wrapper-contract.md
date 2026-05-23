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
