# Template Gateway

Reusable gateway template for client identity, OAuth provider connections, MCP, HTTP API, CLI operations, audit, and policy.

## Local Development

```bash
npm install
npm run dev
```

## Endpoints

- `GET /health`
- `GET /providers`
- `GET /mcp`

## Operator CLI

```bash
npm run cli -- doctor
npm run cli -- providers
npm run cli -- sessions
```

## Container Runtime

```bash
cp .env.example .env
docker compose up --build
```

Coolify should use the Dockerfile build pack. No runtime start-command override is required.

## Client Wrappers

Client deployments should use thin wrapper repos instead of editing this template directly. See [Client Wrapper Contract](docs/client-wrapper-contract.md).

All service integrations should follow the shared [Service Auth Flow](docs/service-auth-flow.md): request a service, connect the upstream login, then act as that login through gateway policy and audit.

For the Genvest migration guardrails, see [Genvest Migration Notes](docs/genvest-migration-notes.md).

Recommended names:

- `genvest-gateway`
- `haverford-gateway`
- `alx-gateway`
