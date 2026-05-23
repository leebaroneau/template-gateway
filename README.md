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
- `POST /mcp`

## Operator CLI

```bash
npm run cli -- doctor
npm run cli -- providers
```

## Container Runtime

```bash
cp .env.example .env
docker compose up --build
```

Coolify should use the Dockerfile build pack. No runtime start-command override is required.

## Client Wrappers

Client deployments should use thin wrapper repos instead of editing this template directly. See [Client Wrapper Contract](docs/client-wrapper-contract.md).

For the Genvest migration guardrails, see [Genvest Migration Notes](docs/genvest-migration-notes.md).

Recommended names:

- `genvest-gateway`
- `haverford-gateway`
- `alx-gateway`
