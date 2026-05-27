# Template Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `leebaroneau/template-gateway` as a reusable TypeScript gateway template for client identity, OAuth provider connections, MCP, HTTP API, CLI operations, audit, and policy, then use it as the foundation for a later Genvest gateway migration.

**Architecture:** Create a new owner repo under `00_repos/template-gateway` with one shared core and three transports: MCP, REST API, and CLI. The template owns identity, provider registry, token storage, policy, audit, and deployment shape; client repos own branding, secrets, allowlists, provider configuration, and any client-specific native tools.

**Tech Stack:** Node 20+, TypeScript, Express 5, MCP TypeScript SDK, Zod, Vitest, Commander, dotenv.

---

## Scope Split

This plan builds the reusable `template-gateway` foundation. It deliberately does not migrate Genvest code in the same pass, because the existing `genvest/00_repos/service-api` repo is dirty, Pipeline Core governed, and carries production auth policy that needs a separate issue, branch, and review path.

Follow-up plans after this passes:

1. `genvest-gateway` migration plan: extract Genvest's Pipedrive-specific policy and tools into a thin client repo that consumes `template-gateway`.
2. Microsoft 365 provider plan: adapt the existing Genvest Microsoft spec to use the template's provider and token-vault interfaces.
3. Google Workspace provider plan: add a provider wrapper around the chosen upstream Workspace MCP instead of hand-maintaining Google API tools in the template.

## File Structure

New repo root: `00_repos/template-gateway/`

- Create `package.json`: scripts, dependencies, and Node version.
- Create `tsconfig.json`: TypeScript compiler settings for source and tests.
- Create `src/config.ts`: parse env into typed gateway config.
- Create `src/http.ts`: Express app, health endpoint, provider directory endpoint.
- Create `src/index.ts`: production entrypoint.
- Create `src/providers/types.ts`: provider definitions and runtime interfaces.
- Create `src/providers/registry.ts`: in-memory provider registry.
- Create `src/storage/json-file-store.ts`: atomic JSON file persistence.
- Create `src/audit/audit-log.ts`: structured append-only audit log.
- Create `src/auth/session-tokens.ts`: bearer token issue/verify with constant-time static-token support.
- Create `src/mcp/server.ts`: MCP server factory with base gateway tools.
- Create `src/cli.ts`: operator CLI for `doctor`, `providers`, and `sessions`.
- Create `test/*.test.ts`: focused Vitest coverage for config, registry, storage, audit, auth, HTTP, MCP, and CLI.
- Create `.env.example`, `.gitignore`, `Dockerfile`, `README.md`: deployable template surface.

---

### Task 1: Create The Template Gateway Repo Skeleton

**Files:**
- Create: `00_repos/template-gateway/package.json`
- Create: `00_repos/template-gateway/tsconfig.json`
- Create: `00_repos/template-gateway/.gitignore`
- Create: `00_repos/template-gateway/.env.example`
- Create: `00_repos/template-gateway/README.md`
- Create: `00_repos/template-gateway/src/index.ts`
- Create: `00_repos/template-gateway/src/config.ts`
- Test: `00_repos/template-gateway/test/config.test.ts`

- [ ] **Step 1: Create repo folder**

Run:

```bash
mkdir -p 00_repos/template-gateway/src 00_repos/template-gateway/test
cd 00_repos/template-gateway
git init
```

Expected: a new empty git repo exists at `00_repos/template-gateway`.

- [ ] **Step 2: Write `package.json`**

Create `package.json`:

```json
{
  "name": "@leebaroneau/template-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Reusable gateway template for MCP, HTTP API, CLI, OAuth, provider routing, audit, and policy.",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "cli": "tsx src/cli.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.4",
    "commander": "^12.1.0",
    "dotenv": "^16.6.1",
    "express": "^5.2.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^24.0.0",
    "@types/supertest": "^6.0.3",
    "supertest": "^7.0.0",
    "tsx": "^4.20.3",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 3: Write TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Write base files**

Create `.gitignore`:

```gitignore
node_modules/
dist/
.env
.env.local
coverage/
*.log
data/
```

Create `.env.example`:

```env
PORT=3000
API_BASE_URL=http://localhost:3000
ALLOWED_EMAIL_DOMAINS=example.com
TOKEN_STORE_PATH=./data/tokens.json
AUDIT_LOG_PATH=./data/audit.jsonl
API_BEARER_TOKENS=
```

Create `README.md`:

````markdown
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
````

- [ ] **Step 5: Write config parser**

Create `src/config.ts`:

```ts
import { z } from "zod";

const configSchema = z.object({
  port: z.number().int().min(1).max(65535),
  apiBaseUrl: z.string().url(),
  allowedEmailDomains: z.array(z.string().min(1)),
  tokenStorePath: z.string().min(1),
  auditLogPath: z.string().min(1),
  apiBearerTokens: z.array(z.string().min(32))
});

export type GatewayConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return configSchema.parse({
    port: parseInteger(env.PORT, 3000),
    apiBaseUrl: env.API_BASE_URL ?? "http://localhost:3000",
    allowedEmailDomains: splitCsv(env.ALLOWED_EMAIL_DOMAINS ?? "example.com"),
    tokenStorePath: env.TOKEN_STORE_PATH ?? "./data/tokens.json",
    auditLogPath: env.AUDIT_LOG_PATH ?? "./data/audit.jsonl",
    apiBearerTokens: splitCsv(env.API_BEARER_TOKENS ?? "")
  });
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
```

- [ ] **Step 6: Write config tests**

Create `test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads defaults", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      apiBaseUrl: "http://localhost:3000",
      allowedEmailDomains: ["example.com"],
      tokenStorePath: "./data/tokens.json",
      auditLogPath: "./data/audit.jsonl",
      apiBearerTokens: []
    });
  });

  it("parses comma-separated domains and bearer tokens", () => {
    const config = loadConfig({
      PORT: "4100",
      API_BASE_URL: "https://gateway.example.com",
      ALLOWED_EMAIL_DOMAINS: "genvest.com.au, haverford.au",
      TOKEN_STORE_PATH: "/data/tokens.json",
      AUDIT_LOG_PATH: "/data/audit.jsonl",
      API_BEARER_TOKENS: "abcdefghijklmnopqrstuvwxyz123456,ZYXWVUTSRQPONMLKJIHGFEDCBA654321"
    });

    expect(config.port).toBe(4100);
    expect(config.allowedEmailDomains).toEqual(["genvest.com.au", "haverford.au"]);
    expect(config.apiBearerTokens).toHaveLength(2);
  });
});
```

- [ ] **Step 7: Write entrypoint**

Create `src/index.ts`:

```ts
import "dotenv/config";
import { loadConfig } from "./config.js";

const config = loadConfig();

console.log(`template-gateway config loaded for ${config.apiBaseUrl}`);
```

- [ ] **Step 8: Run initial tests and verify pass**

Run:

```bash
npm install
npm run typecheck && npm test -- test/config.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add .
git commit -m "chore: scaffold template gateway"
```

Expected: commit succeeds.

---

### Task 2: Add Provider Registry And HTTP Directory

**Files:**
- Create: `00_repos/template-gateway/src/providers/types.ts`
- Create: `00_repos/template-gateway/src/providers/registry.ts`
- Create: `00_repos/template-gateway/src/http.ts`
- Modify: `00_repos/template-gateway/src/index.ts`
- Test: `00_repos/template-gateway/test/providers.test.ts`
- Test: `00_repos/template-gateway/test/http.test.ts`

- [ ] **Step 1: Write failing provider tests**

Create `test/providers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../src/providers/registry.js";

describe("provider registry", () => {
  it("lists providers in stable slug order", () => {
    const registry = createProviderRegistry([
      {
        slug: "pipedrive",
        name: "Pipedrive",
        description: "CRM",
        auth: "oauth",
        mcpPath: "/mcp/pipedrive",
        scopesSummary: "Read and write CRM data."
      },
      {
        slug: "microsoft",
        name: "Microsoft 365",
        description: "Outlook, Calendar, OneDrive",
        auth: "oauth",
        mcpPath: "/mcp/microsoft",
        scopesSummary: "Read and write Microsoft 365 data."
      }
    ]);

    expect(registry.list().map((provider) => provider.slug)).toEqual(["microsoft", "pipedrive"]);
    expect(registry.get("microsoft")?.name).toBe("Microsoft 365");
    expect(registry.get("missing")).toBeUndefined();
  });
});
```

Create `test/http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createHttpApp } from "../src/http.js";

describe("HTTP app", () => {
  it("returns health", async () => {
    const app = createHttpApp({ config: baseConfig() });
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "template-gateway" });
  });

  it("returns provider directory", async () => {
    const app = createHttpApp({ config: baseConfig() });
    const response = await request(app).get("/providers");
    expect(response.status).toBe(200);
    expect(response.body.providers).toEqual([]);
  });
});

function baseConfig() {
  return {
    port: 3000,
    apiBaseUrl: "http://localhost:3000",
    allowedEmailDomains: ["example.com"],
    tokenStorePath: "./data/tokens.json",
    auditLogPath: "./data/audit.jsonl",
    apiBearerTokens: []
  };
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- test/providers.test.ts test/http.test.ts
```

Expected: FAIL because provider registry and HTTP app are not implemented.

- [ ] **Step 3: Implement provider types**

Create `src/providers/types.ts`:

```ts
export type ProviderAuthMode = "none" | "oauth" | "static-service-token";

export interface GatewayProviderDefinition {
  slug: string;
  name: string;
  description: string;
  auth: ProviderAuthMode;
  mcpPath: string;
  scopesSummary: string;
}

export interface ProviderRegistry {
  list(): GatewayProviderDefinition[];
  get(slug: string): GatewayProviderDefinition | undefined;
}
```

- [ ] **Step 4: Implement provider registry**

Create `src/providers/registry.ts`:

```ts
import type { GatewayProviderDefinition, ProviderRegistry } from "./types.js";

export function createProviderRegistry(
  providers: GatewayProviderDefinition[] = []
): ProviderRegistry {
  const normalized = providers
    .map((provider) => ({ ...provider, slug: provider.slug.trim().toLowerCase() }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const bySlug = new Map(normalized.map((provider) => [provider.slug, provider]));

  return {
    list: () => [...normalized],
    get: (slug: string) => bySlug.get(slug.trim().toLowerCase())
  };
}
```

- [ ] **Step 5: Implement HTTP app with test helper**

Create `src/http.ts`:

```ts
import express, { type Express } from "express";
import type { GatewayConfig } from "./config.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { GatewayProviderDefinition, ProviderRegistry } from "./providers/types.js";

export interface HttpAppOptions {
  config: GatewayConfig;
  providers?: GatewayProviderDefinition[];
}

export function createHttpApp(options: HttpAppOptions): Express {
  const app = express();
  const providers = createProviderRegistry(options.providers ?? []);

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "template-gateway" });
  });

  app.get("/providers", (_request, response) => {
    response.json(toProviderDirectory(options.config.apiBaseUrl, providers));
  });

  app.get("/mcp", (_request, response) => {
    response.json(toProviderDirectory(options.config.apiBaseUrl, providers));
  });

  return app;
}

function toProviderDirectory(apiBaseUrl: string, providers: ProviderRegistry) {
  return {
    providers: providers.list().map((provider) => ({
      ...provider,
      url: new URL(provider.mcpPath, apiBaseUrl).toString()
    }))
  };
}
```

- [ ] **Step 6: Wire production entrypoint to HTTP app**

Replace `src/index.ts` with:

```ts
import "dotenv/config";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";

const config = loadConfig();
const app = createHttpApp({ config });

app.listen(config.port, () => {
  console.log(`template-gateway listening on ${config.port}`);
});
```

- [ ] **Step 7: Run tests and verify pass**

Run:

```bash
npm run typecheck && npm test -- test/providers.test.ts test/http.test.ts test/config.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add src test
git commit -m "feat: add provider directory"
```

Expected: commit succeeds.

---

### Task 3: Add Atomic JSON Storage And Audit Log

**Files:**
- Create: `00_repos/template-gateway/src/storage/json-file-store.ts`
- Create: `00_repos/template-gateway/src/audit/audit-log.ts`
- Test: `00_repos/template-gateway/test/json-file-store.test.ts`
- Test: `00_repos/template-gateway/test/audit-log.test.ts`

- [ ] **Step 1: Write storage and audit tests**

Create `test/json-file-store.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { JsonFileStore } from "../src/storage/json-file-store.js";

describe("JsonFileStore", () => {
  it("reads default state and writes updates atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "template-gateway-store-"));
    const path = join(dir, "state.json");
    const store = new JsonFileStore(path, { count: 0 });

    expect(await store.read()).toEqual({ count: 0 });
    await store.update((current) => ({ count: current.count + 1 }));
    expect(await store.read()).toEqual({ count: 1 });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ count: 1 });
  });
});
```

Create `test/audit-log.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../src/audit/audit-log.js";

describe("AuditLog", () => {
  it("appends JSONL records with timestamps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "template-gateway-audit-"));
    const path = join(dir, "audit.jsonl");
    const audit = new AuditLog(path);

    await audit.append({ provider: "gateway", action: "doctor", status: "ok" });

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      provider: "gateway",
      action: "doctor",
      status: "ok"
    });
    expect(JSON.parse(lines[0]).ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- test/json-file-store.test.ts test/audit-log.test.ts
```

Expected: FAIL because storage and audit classes do not exist.

- [ ] **Step 3: Implement atomic JSON store**

Create `src/storage/json-file-store.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonFileStore<T extends object> {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly defaultValue: T
  ) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as T;
    } catch (error: any) {
      if (error?.code === "ENOENT") return structuredClone(this.defaultValue);
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmpPath = `${this.path}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.path);
  }

  async update(mutator: (current: T) => T | Promise<T>): Promise<T> {
    let nextValue!: T;
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.read();
      nextValue = await mutator(current);
      await this.write(nextValue);
    });
    await this.writeQueue;
    return nextValue;
  }
}
```

- [ ] **Step 4: Implement audit log**

Create `src/audit/audit-log.ts`:

```ts
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type AuditStatus = "ok" | "error" | "denied";

export interface AuditRecord {
  provider: string;
  action: string;
  status: AuditStatus;
  actorEmail?: string;
  details?: Record<string, unknown>;
}

export class AuditLog {
  constructor(private readonly path: string) {}

  async append(record: AuditRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, "utf8");
  }

  async recent(limit = 50): Promise<Array<AuditRecord & { ts: string }>> {
    try {
      const lines = (await readFile(this.path, "utf8")).trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((line) => JSON.parse(line));
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }
}
```

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
npm test -- test/json-file-store.test.ts test/audit-log.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/storage src/audit test/json-file-store.test.ts test/audit-log.test.ts
git commit -m "feat: add gateway storage and audit"
```

Expected: commit succeeds.

---

### Task 4: Add Bearer Sessions And Static Service Tokens

**Files:**
- Create: `00_repos/template-gateway/src/auth/session-tokens.ts`
- Test: `00_repos/template-gateway/test/session-tokens.test.ts`

- [ ] **Step 1: Write failing auth tests**

Create `test/session-tokens.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { SessionTokenStore } from "../src/auth/session-tokens.js";

describe("SessionTokenStore", () => {
  it("issues and verifies user bearer tokens", async () => {
    const store = new SessionTokenStore(join(await tmp(), "tokens.json"), ["genvest.com.au"], []);
    const issued = await store.issue("Lee@Genvest.com.au", "claude", ["mcp:tools"]);
    const auth = await store.verifyAccessToken(issued.access_token);

    expect(auth.extra.email).toBe("lee@genvest.com.au");
    expect(auth.scopes).toEqual(["mcp:tools"]);
  });

  it("rejects emails outside allowed domains", async () => {
    const store = new SessionTokenStore(join(await tmp(), "tokens.json"), ["genvest.com.au"], []);
    await expect(store.issue("person@example.com", "claude", ["mcp:tools"])).rejects.toThrow(/domain/i);
  });

  it("verifies static service tokens without storing them", async () => {
    const token = "abcdefghijklmnopqrstuvwxyz123456";
    const store = new SessionTokenStore(join(await tmp(), "tokens.json"), ["genvest.com.au"], [
      { token, email: "bot@genvest.com.au", name: "@bot", profile: "genvest-bot" }
    ]);

    const auth = await store.verifyAccessToken(token);
    expect(auth.extra).toMatchObject({
      email: "bot@genvest.com.au",
      name: "@bot",
      profile: "genvest-bot",
      isStaticServiceToken: true
    });
  });
});

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "template-gateway-sessions-"));
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- test/session-tokens.test.ts
```

Expected: FAIL because `SessionTokenStore` does not exist.

- [ ] **Step 3: Implement session token store**

Create `src/auth/session-tokens.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { JsonFileStore } from "../storage/json-file-store.js";

export interface StaticServiceToken {
  token: string;
  email: string;
  name?: string;
  profile?: string;
}

interface StoredSession {
  tokenHash: string;
  email: string;
  name?: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
}

interface SessionState {
  sessions: StoredSession[];
}

export class SessionTokenStore {
  private readonly store: JsonFileStore<SessionState>;

  constructor(
    path: string,
    private readonly allowedDomains: string[],
    private readonly staticTokens: StaticServiceToken[]
  ) {
    this.store = new JsonFileStore(path, { sessions: [] });
  }

  async issue(email: string, clientId: string, scopes: string[], name?: string): Promise<OAuthTokens> {
    const normalizedEmail = normalizeEmail(email);
    this.assertAllowedEmail(normalizedEmail);
    const token = randomBytes(32).toString("base64url");
    const session: StoredSession = {
      tokenHash: hashToken(token),
      email: normalizedEmail,
      name,
      clientId,
      scopes,
      createdAt: new Date().toISOString()
    };
    await this.store.update((current) => ({ sessions: [...current.sessions, session] }));
    return {
      access_token: token,
      token_type: "Bearer",
      scope: scopes.join(" ")
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const staticAuth = this.verifyStaticToken(token);
    if (staticAuth) return staticAuth;

    const state = await this.store.read();
    const tokenHash = hashToken(token);
    const session = state.sessions.find((candidate) => candidate.tokenHash === tokenHash);
    if (!session) throw new Error("Invalid bearer token.");
    return {
      token,
      scopes: session.scopes,
      clientId: session.clientId,
      extra: {
        email: session.email,
        name: session.name,
        isStaticServiceToken: false
      }
    };
  }

  async listSessions(): Promise<Array<Pick<StoredSession, "email" | "clientId" | "scopes" | "createdAt">>> {
    const state = await this.store.read();
    return state.sessions.map(({ email, clientId, scopes, createdAt }) => ({ email, clientId, scopes, createdAt }));
  }

  private verifyStaticToken(token: string): AuthInfo | undefined {
    for (const entry of this.staticTokens) {
      if (!constantTimeEqual(token, entry.token)) continue;
      const email = normalizeEmail(entry.email);
      this.assertAllowedEmail(email);
      return {
        token,
        scopes: ["mcp:tools"],
        clientId: entry.profile ?? "static-service-token",
        extra: {
          email,
          name: entry.name,
          profile: entry.profile,
          isStaticServiceToken: true
        }
      };
    }
    return undefined;
  }

  private assertAllowedEmail(email: string): void {
    if (!this.allowedDomains.some((domain) => email.endsWith(`@${domain.toLowerCase()}`))) {
      throw new Error(`Email domain is not allowed: ${email}`);
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  const maxLength = Math.max(left.length, right.length);
  const paddedLeft = Buffer.concat([left, Buffer.alloc(maxLength - left.length)]);
  const paddedRight = Buffer.concat([right, Buffer.alloc(maxLength - right.length)]);
  return timingSafeEqual(paddedLeft, paddedRight) && left.length === right.length;
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- test/session-tokens.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/auth/session-tokens.ts test/session-tokens.test.ts
git commit -m "feat: add gateway bearer sessions"
```

Expected: commit succeeds.

---

### Task 5: Add MCP Base Endpoint And Gateway Tools

**Files:**
- Create: `00_repos/template-gateway/src/mcp/server.ts`
- Modify: `00_repos/template-gateway/src/http.ts`
- Test: `00_repos/template-gateway/test/mcp-server.test.ts`

- [ ] **Step 1: Write MCP server tests**

Create `test/mcp-server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createGatewayMcpServer } from "../src/mcp/server.js";
import { createProviderRegistry } from "../src/providers/registry.js";

describe("createGatewayMcpServer", () => {
  it("registers base gateway tools", async () => {
    const fakeServer: any = { tools: {}, tool(name: string, description: string, schema: any, handler: any) {
      this.tools[name] = { description, schema, handler };
    } };
    createGatewayMcpServer(fakeServer, {
      providers: createProviderRegistry([
        { slug: "microsoft", name: "Microsoft 365", description: "MS", auth: "oauth", mcpPath: "/mcp/microsoft", scopesSummary: "MS scopes" }
      ]),
      apiBaseUrl: "https://gateway.example.com"
    });

    expect(Object.keys(fakeServer.tools)).toEqual(["gateway_whoami", "gateway_list_providers"]);
    const result = await fakeServer.tools.gateway_list_providers.handler({});
    expect(JSON.parse(result.content[0].text).providers[0].url).toBe("https://gateway.example.com/mcp/microsoft");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- test/mcp-server.test.ts
```

Expected: FAIL because MCP server factory does not exist.

- [ ] **Step 3: Implement base MCP tool registration**

Create `src/mcp/server.ts`:

```ts
import { z } from "zod";
import type { ProviderRegistry } from "../providers/types.js";

interface ToolCapableServer {
  tool(name: string, description: string, inputSchema: Record<string, z.ZodTypeAny>, handler: (input: any, extra?: any) => Promise<any> | any): void;
}

export interface GatewayMcpServerOptions {
  providers: ProviderRegistry;
  apiBaseUrl: string;
}

export function createGatewayMcpServer<T extends ToolCapableServer>(
  server: T,
  options: GatewayMcpServerOptions
): T {
  server.tool(
    "gateway_whoami",
    "Return the authenticated gateway actor identity for this MCP session.",
    {},
    async (_input, extra) => toolResult({
      email: extra?.authInfo?.extra?.email,
      name: extra?.authInfo?.extra?.name,
      profile: extra?.authInfo?.extra?.profile,
      isStaticServiceToken: extra?.authInfo?.extra?.isStaticServiceToken === true
    })
  );

  server.tool(
    "gateway_list_providers",
    "List providers available from this gateway.",
    {},
    async () => toolResult({
      providers: options.providers.list().map((provider) => ({
        ...provider,
        url: new URL(provider.mcpPath, options.apiBaseUrl).toString()
      }))
    })
  );

  return server;
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: { data }
  };
}
```

- [ ] **Step 4: Run MCP tests and verify pass**

Run:

```bash
npm test -- test/mcp-server.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add src/mcp/server.ts test/mcp-server.test.ts
git commit -m "feat: add gateway MCP base tools"
```

Expected: commit succeeds.

---

### Task 6: Add Operator CLI

**Files:**
- Create: `00_repos/template-gateway/src/cli.ts`
- Test: `00_repos/template-gateway/test/cli.test.ts`

- [ ] **Step 1: Write CLI tests**

Create `test/cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCli } from "../src/cli.js";

describe("buildCli", () => {
  it("prints doctor output", async () => {
    const output: string[] = [];
    const cli = buildCli({ write: (line) => output.push(line) });
    await cli.parseAsync(["node", "gateway", "doctor"], { from: "node" });
    expect(output.join("\n")).toContain("template-gateway: ok");
  });

  it("prints provider output", async () => {
    const output: string[] = [];
    const cli = buildCli({ write: (line) => output.push(line) });
    await cli.parseAsync(["node", "gateway", "providers"], { from: "node" });
    expect(output.join("\n")).toContain("No providers configured");
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- test/cli.test.ts
```

Expected: FAIL because `src/cli.ts` does not exist.

- [ ] **Step 3: Implement CLI**

Create `src/cli.ts`:

```ts
import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { createProviderRegistry } from "./providers/registry.js";

export interface CliIo {
  write(line: string): void;
}

export function buildCli(io: CliIo = { write: (line) => console.log(line) }): Command {
  const program = new Command();
  program.name("template-gateway").description("Operator CLI for template-gateway");

  program.command("doctor").description("Check local gateway configuration").action(() => {
    const config = loadConfig();
    io.write("template-gateway: ok");
    io.write(`apiBaseUrl: ${config.apiBaseUrl}`);
    io.write(`allowedEmailDomains: ${config.allowedEmailDomains.join(",")}`);
  });

  program.command("providers").description("List configured providers").action(() => {
    const registry = createProviderRegistry([]);
    const providers = registry.list();
    if (providers.length === 0) {
      io.write("No providers configured");
      return;
    }
    for (const provider of providers) {
      io.write(`${provider.slug}: ${provider.name} (${provider.mcpPath})`);
    }
  });

  return program;
}

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
  await buildCli().parseAsync(process.argv);
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- test/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat: add gateway operator cli"
```

Expected: commit succeeds.

---

### Task 7: Add Container And Coolify-Friendly Runtime Shape

**Files:**
- Create: `00_repos/template-gateway/Dockerfile`
- Create: `00_repos/template-gateway/docker-compose.yaml`
- Modify: `00_repos/template-gateway/README.md`

- [ ] **Step 1: Write Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
```

- [ ] **Step 2: Write local compose file**

Create `docker-compose.yaml`:

```yaml
services:
  gateway:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - gateway-data:/app/data

volumes:
  gateway-data:
```

- [ ] **Step 3: Update README runtime section**

Append this section to `README.md`:

````markdown

## Container Runtime

```bash
cp .env.example .env
docker compose up --build
```

Coolify should use the Dockerfile build pack. The image includes a default `CMD`, so no Coolify runtime start-command override is required.
````

- [ ] **Step 4: Run build and tests**

Run:

```bash
npm run build && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

Run:

```bash
git add Dockerfile docker-compose.yaml README.md
git commit -m "chore: add gateway container runtime"
```

Expected: commit succeeds.

---

### Task 8: Add Template-To-Client Contract Documentation

**Files:**
- Create: `00_repos/template-gateway/docs/client-wrapper-contract.md`
- Create: `00_repos/template-gateway/docs/genvest-migration-notes.md`
- Modify: `00_repos/template-gateway/README.md`

- [ ] **Step 1: Write client wrapper contract**

Create `docs/client-wrapper-contract.md`:

```markdown
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
```

- [ ] **Step 2: Write Genvest migration notes**

Create `docs/genvest-migration-notes.md`:

```markdown
# Genvest Migration Notes

The current Genvest production MCP lives in `genvest/00_repos/service-api`.

Migration rule:

1. Preserve all static Hermes bot protections from the existing README.
2. Preserve profile-bound pipeline write scopes.
3. Preserve Pipedrive-visible audit attribution.
4. Keep `/mcp` aliasing behavior until every Hermes profile has moved to provider-specific URLs.
5. Migrate in a new branch and issue inside the Genvest repo because it has Pipeline Core governance.

The first Genvest wrapper should be named `genvest-gateway` unless Lee chooses to keep the existing `service-api` repo name for continuity.
```

- [ ] **Step 3: Update README with client wrapper section**

Append to `README.md`:

````markdown

## Client Wrappers

Client deployments should use thin wrapper repos instead of editing this template directly. See `docs/client-wrapper-contract.md`.

Recommended names:

- `genvest-gateway`
- `haverford-gateway`
- `alx-gateway`
````

- [ ] **Step 4: Run documentation sanity check**

Run:

```bash
npm run build && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

Run:

```bash
git add docs README.md
git commit -m "docs: define client wrapper contract"
```

Expected: commit succeeds.

---

### Task 9: Publish Repo To GitHub

**Files:**
- Remote repo: `leebaroneau/template-gateway`

- [ ] **Step 1: Create GitHub repo**

Run:

```bash
gh repo create leebaroneau/template-gateway --private --source=. --remote=origin --push
```

Expected: GitHub creates `leebaroneau/template-gateway` and pushes the local `main` branch.

- [ ] **Step 2: Verify remote**

Run:

```bash
git remote -v
git status --short
```

Expected: `origin` points at `git@github.com:leebaroneau/template-gateway.git` or `https://github.com/leebaroneau/template-gateway.git`; status is clean.

- [ ] **Step 3: Tag the foundation version**

Run:

```bash
git tag v0.1.0-foundation
git push origin v0.1.0-foundation
```

Expected: tag appears on GitHub.

---

## Self-Review

Spec coverage:

- The old Microsoft-only spec is not implemented directly in this plan because it is client-specific and service-api-specific.
- The reusable gateway foundation needed by that spec is covered: config, provider registry, HTTP directory, storage, audit, bearer sessions, base MCP tools, CLI, container runtime, and client wrapper contract.
- Genvest migration is not mixed into this plan. It gets a separate Pipeline Core compliant plan after `template-gateway` exists.

Placeholder scan:

- No unfinished-task markers are present.
- Provider-specific Microsoft, Google, and Pipedrive work is named as follow-up plans rather than left as vague steps inside this plan.

Type consistency:

- `GatewayConfig`, `GatewayProviderDefinition`, `ProviderRegistry`, `JsonFileStore`, `AuditLog`, and `SessionTokenStore` are introduced before use.
- The MCP base server test uses a fake server so the first foundation plan does not depend on Streamable HTTP wiring details.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-template-gateway.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
