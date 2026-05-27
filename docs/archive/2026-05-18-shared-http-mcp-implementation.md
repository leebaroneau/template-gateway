# Shared HTTP MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate three per-profile stdio MCP subprocesses into a single shared HTTP MCP (the Coolify-deployed `service-api`). Each Hermes profile authenticates with a profile-bound static bearer token; per-request scope flows from the token through `AuthInfo` into `ActorOpts`.

**Architecture:** Token-bound profile resolution. Each profile has one static bearer token in `API_BEARER_TOKENS=token:email:profile,...`. Profile configs (actor identity, Pipedrive access mode, pipeline allowlist, audit-note flag) come from `HERMES_PROFILES_JSON`. Auth verifier returns `AuthInfo{ extra: { email, name, profile, isStaticServiceToken } }`. Tool handlers look up the profile config and pass it into `ActorOpts.scope`. `BrandInsightsService` methods read `opts.scope ?? this.config` for per-request enforcement.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, Express, vitest, nock; deployed via Coolify v4; Hermes Agent profiles on a DigitalOcean droplet.

**Spec:** [`docs/superpowers/specs/2026-05-18-shared-http-mcp-design.md`](../specs/2026-05-18-shared-http-mcp-design.md)

---

## Stage A — service-api code changes (one PR)

All work happens in `Genvest-Property/service-api` on a feature branch off `main`. Local clone at `/tmp/service-api`.

### Task 0: Branch setup

**Files:**
- Modify: nothing (branch creation only)

- [ ] **Step 1: Create feature branch off main**

```bash
cd /tmp/service-api
git fetch origin
git checkout main
git pull --quiet
git checkout -b feat/shared-http-mcp-profile-tokens
```

- [ ] **Step 2: Verify baseline tests pass**

Run: `npm run build && npm test 2>&1 | tail -5`
Expected: `Test Files  16 passed (16)` and `Tests  87 passed (87)`

---

### Task 1: Add `ProfileConfig` type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Write a failing type-import test**

Create `test/profile-config-type.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ProfileConfig } from "../src/types.js";

describe("ProfileConfig type", () => {
  it("accepts a fully-populated record", () => {
    const p: ProfileConfig = {
      actorEmail: "bot@genvest.com.au",
      actorName: "@bot",
      pipedriveAccessMode: "pipeline-write",
      pipedriveWritePipelineIds: [4],
      pipedriveWriteAuditNotes: true
    };
    expect(p.pipedriveAccessMode).toBe("pipeline-write");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/profile-config-type.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find name 'ProfileConfig'` or `has no exported member 'ProfileConfig'`.

- [ ] **Step 3: Add the type to `src/types.ts`**

Append at the bottom of `src/types.ts`:

```ts
export interface ProfileConfig {
  actorEmail: string;
  actorName: string;
  pipedriveAccessMode: AppConfig["pipedriveAccessMode"];
  pipedriveWritePipelineIds: number[];
  pipedriveWriteAuditNotes: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/profile-config-type.test.ts 2>&1 | tail -5`
Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts test/profile-config-type.test.ts
git commit -m "types: add ProfileConfig"
```

---

### Task 2: Parse `HERMES_PROFILES_JSON` env

**Files:**
- Modify: `src/config.ts`, `src/types.ts`
- Create: `test/profile-config.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `test/profile-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseProfilesJson } from "../src/config.js";

describe("parseProfilesJson", () => {
  it("returns empty map when undefined", () => {
    expect(parseProfilesJson(undefined)).toEqual({});
  });

  it("returns empty map for empty string", () => {
    expect(parseProfilesJson("")).toEqual({});
  });

  it("parses a valid single profile", () => {
    const json = JSON.stringify({
      cs: {
        actorEmail: "cs_bot@genvest.com.au",
        actorName: "@cs_bot",
        pipedriveAccessMode: "pipeline-write",
        pipedriveWritePipelineIds: [4],
        pipedriveWriteAuditNotes: true
      }
    });
    const result = parseProfilesJson(json);
    expect(result.cs.actorName).toBe("@cs_bot");
    expect(result.cs.pipedriveWritePipelineIds).toEqual([4]);
  });

  it("throws on non-object JSON", () => {
    expect(() => parseProfilesJson("[]")).toThrow(/object/i);
    expect(() => parseProfilesJson("\"string\"")).toThrow(/object/i);
  });

  it("throws on invalid access mode", () => {
    const json = JSON.stringify({
      bad: { actorEmail: "x@genvest.com.au", actorName: "@x", pipedriveAccessMode: "delete-all", pipedriveWritePipelineIds: [], pipedriveWriteAuditNotes: false }
    });
    expect(() => parseProfilesJson(json)).toThrow(/access mode/i);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseProfilesJson("{ not json")).toThrow(/HERMES_PROFILES_JSON/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/profile-config.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module '../src/config.js' or no exported parseProfilesJson`.

- [ ] **Step 3: Implement `parseProfilesJson` in `src/config.ts`**

Add export near the other parsers:

```ts
export function parseProfilesJson(input: string | undefined): Record<string, ProfileConfig> {
  if (!input?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(`HERMES_PROFILES_JSON is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HERMES_PROFILES_JSON must be a JSON object keyed by profile name.");
  }
  const result: Record<string, ProfileConfig> = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`HERMES_PROFILES_JSON entry "${key}" must be an object.`);
    }
    const r = raw as Record<string, unknown>;
    const accessMode = r.pipedriveAccessMode;
    if (accessMode !== "read-only" && accessMode !== "pipeline-write" && accessMode !== "unrestricted") {
      throw new Error(`HERMES_PROFILES_JSON entry "${key}": pipedriveAccessMode must be read-only, pipeline-write, or unrestricted.`);
    }
    const pipelineIds = r.pipedriveWritePipelineIds;
    if (!Array.isArray(pipelineIds) || !pipelineIds.every((n) => typeof n === "number" && Number.isInteger(n))) {
      throw new Error(`HERMES_PROFILES_JSON entry "${key}": pipedriveWritePipelineIds must be an integer array.`);
    }
    if (typeof r.actorEmail !== "string" || typeof r.actorName !== "string") {
      throw new Error(`HERMES_PROFILES_JSON entry "${key}": actorEmail and actorName must be strings.`);
    }
    if (typeof r.pipedriveWriteAuditNotes !== "boolean") {
      throw new Error(`HERMES_PROFILES_JSON entry "${key}": pipedriveWriteAuditNotes must be a boolean.`);
    }
    result[key] = {
      actorEmail: r.actorEmail,
      actorName: r.actorName,
      pipedriveAccessMode: accessMode,
      pipedriveWritePipelineIds: pipelineIds as number[],
      pipedriveWriteAuditNotes: r.pipedriveWriteAuditNotes
    };
  }
  return result;
}
```

Add `ProfileConfig` import at top of `src/config.ts`:

```ts
import type { AppConfig, ClaritySite, MicrosoftConfig, ProfileConfig } from "./types.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/profile-config.test.ts 2>&1 | tail -5`
Expected: `6 passed`.

- [ ] **Step 5: Add `profiles` to `AppConfig` and wire it through `loadConfig`**

In `src/types.ts`, inside `AppConfig`, add (anywhere sensible):

```ts
  profiles: Record<string, ProfileConfig>;
```

In `src/config.ts`, inside the `loadConfig` return object (alongside the other fields):

```ts
    profiles: parseProfilesJson(env.HERMES_PROFILES_JSON),
```

And add `HERMES_PROFILES_JSON: z.string().optional(),` to the `envSchema` declaration.

- [ ] **Step 6: Run build + full suite**

Run: `npm run build && npm test 2>&1 | tail -5`
Expected: build clean; tests pass (existing + new).

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/types.ts test/profile-config.test.ts
git commit -m "config: parse HERMES_PROFILES_JSON into AppConfig.profiles"
```

---

### Task 3: Extend `API_BEARER_TOKENS` to `token:email:profile`

**Files:**
- Modify: `src/config.ts`, `src/types.ts`
- Create: `test/bearer-tokens-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `test/bearer-tokens-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBearerTokens } from "../src/config.js";

const PROFILES = {
  cs: { actorEmail: "cs@genvest.com.au", actorName: "@cs", pipedriveAccessMode: "read-only" as const, pipedriveWritePipelineIds: [], pipedriveWriteAuditNotes: false }
};

describe("parseBearerTokens", () => {
  it("returns empty when undefined or empty", () => {
    expect(parseBearerTokens(undefined, "genvest.com.au", PROFILES)).toEqual([]);
    expect(parseBearerTokens("", "genvest.com.au", PROFILES)).toEqual([]);
  });

  it("parses token:email:profile triple", () => {
    const result = parseBearerTokens("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:cs@genvest.com.au:cs", "genvest.com.au", PROFILES);
    expect(result).toEqual([{ token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", email: "cs@genvest.com.au", profile: "cs" }]);
  });

  it("rejects two-field token:email (legacy format) explicitly", () => {
    expect(() => parseBearerTokens("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:cs@genvest.com.au", "genvest.com.au", PROFILES))
      .toThrow(/token:email:profile/);
  });

  it("rejects email outside allowed domain", () => {
    expect(() => parseBearerTokens("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:cs@other.com:cs", "genvest.com.au", PROFILES))
      .toThrow(/@genvest.com.au/);
  });

  it("rejects unknown profile reference", () => {
    expect(() => parseBearerTokens("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:cs@genvest.com.au:does-not-exist", "genvest.com.au", PROFILES))
      .toThrow(/profile "does-not-exist"/);
  });

  it("rejects tokens shorter than 32 chars", () => {
    expect(() => parseBearerTokens("short:cs@genvest.com.au:cs", "genvest.com.au", PROFILES))
      .toThrow(/at least 32/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/bearer-tokens-parser.test.ts 2>&1 | tail -10`
Expected: FAIL — `parseBearerTokens` signature mismatch.

- [ ] **Step 3: Update `parseBearerTokens` signature and body**

In `src/config.ts`, replace the existing `parseBearerTokens` function with:

```ts
function parseBearerTokens(
  input: string | undefined,
  allowedDomain: string,
  profiles: Record<string, ProfileConfig>
): AppConfig["apiBearerTokens"] {
  const normalizedDomain = normalizeEmailDomain(allowedDomain);
  if (!input?.trim()) return [];

  return input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(":");
      if (parts.length !== 3) {
        throw new Error(`API_BEARER_TOKENS entries must use token:email:profile format (got ${parts.length} fields).`);
      }
      const [token, emailRaw, profile] = parts.map((p) => p.trim());
      const email = emailRaw.toLowerCase();

      if (token.length < 32 || !/^[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error("API_BEARER_TOKENS tokens must be at least 32 [A-Za-z0-9_-] characters.");
      }
      if (!email.endsWith(`@${normalizedDomain}`)) {
        throw new Error(`API_BEARER_TOKENS emails must end with @${normalizedDomain}.`);
      }
      if (!profiles[profile]) {
        throw new Error(`API_BEARER_TOKENS references profile "${profile}" not in HERMES_PROFILES_JSON.`);
      }
      return { token, email, profile };
    });
}
```

Make it exported (replace `function` with `export function`).

- [ ] **Step 4: Update `AppConfig.apiBearerTokens` type in `src/types.ts`**

Change the existing entry from:

```ts
apiBearerTokens: Array<{ token: string; email: string }>;
```

to:

```ts
apiBearerTokens: Array<{ token: string; email: string; profile: string }>;
```

- [ ] **Step 5: Update the call site in `loadConfig`**

In `src/config.ts`, replace the existing `apiBearerTokens` line with one that threads `profiles` through. Note the ordering — `parseProfilesJson` must run before `parseBearerTokens`:

```ts
    // …
    const profiles = parseProfilesJson(env.HERMES_PROFILES_JSON);
    // …
    apiBearerTokens: parseBearerTokens(env.API_BEARER_TOKENS, env.ALLOWED_EMAIL_DOMAIN ?? "genvest.com.au", profiles),
```

If `loadConfig` already returns inline (no intermediate `const`), refactor to compute `profiles` once:

```ts
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsedEnv = envSchema.parse(env);
  const profiles = parseProfilesJson(parsedEnv.HERMES_PROFILES_JSON);
  const allowedDomain = parsedEnv.ALLOWED_EMAIL_DOMAIN ?? "genvest.com.au";
  return {
    // ... existing fields ...
    profiles,
    apiBearerTokens: parseBearerTokens(parsedEnv.API_BEARER_TOKENS, allowedDomain, profiles),
    // ... rest ...
  };
}
```

- [ ] **Step 6: Run tests**

Run: `npm run build && npm test 2>&1 | tail -10`
Expected: build clean; the 6 new bearer-token tests pass; existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/types.ts test/bearer-tokens-parser.test.ts
git commit -m "config: extend API_BEARER_TOKENS to token:email:profile triple"
```

---

### Task 4: Static-token path in `verifyAccessToken`

**Files:**
- Modify: `src/auth/session-tokens.ts`
- Create: `test/static-bearer-auth.test.ts`

- [ ] **Step 1: Write failing auth-verifier tests**

Create `test/static-bearer-auth.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionTokenStore } from "../src/auth/session-tokens.js";
import type { ProfileConfig } from "../src/types.js";

const PROFILE: ProfileConfig = {
  actorEmail: "cs_bot@genvest.com.au",
  actorName: "@cs_bot",
  pipedriveAccessMode: "pipeline-write",
  pipedriveWritePipelineIds: [4],
  pipedriveWriteAuditNotes: true
};

const TOKEN = "tok_cs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let directory: string;
let store: SessionTokenStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "static-bearer-"));
  store = new SessionTokenStore(
    join(directory, "sessions.json"),
    "genvest.com.au",
    [{ token: TOKEN, email: PROFILE.actorEmail, profile: "cs" }],
    { cs: PROFILE }
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("SessionTokenStore static-token path", () => {
  it("resolves a configured static token to AuthInfo with profile + isStaticServiceToken", async () => {
    const auth = await store.verifyAccessToken(TOKEN);
    expect(auth.extra?.email).toBe(PROFILE.actorEmail);
    expect(auth.extra?.name).toBe(PROFILE.actorName);
    expect(auth.extra?.profile).toBe("cs");
    expect(auth.extra?.isStaticServiceToken).toBe(true);
  });

  it("falls through to OAuth-session lookup on unknown token", async () => {
    await expect(store.verifyAccessToken("totally-unknown-token")).rejects.toThrow(/Invalid or expired/);
  });

  it("returns no expiry pressure (expiresAt > now + 1 year)", async () => {
    const auth = await store.verifyAccessToken(TOKEN);
    const oneYearAhead = Math.floor(Date.now() / 1000) + 31536000;
    expect(auth.expiresAt).toBeGreaterThan(oneYearAhead);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/static-bearer-auth.test.ts 2>&1 | tail -10`
Expected: FAIL — `SessionTokenStore` constructor signature mismatch.

- [ ] **Step 3: Extend `SessionTokenStore` to accept static-token config**

Open `src/auth/session-tokens.ts`. Update the class constructor and `verifyAccessToken`. Below is the full block to replace (lines ~20-91 in the existing file). Read the current file first; preserve any logic not shown:

```ts
import { InvalidTokenError, type OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/shared/auth.js";

import type { AppConfig, ProfileConfig } from "../types.js";
import { JsonFileStore } from "../storage/json-file-store.js"; // adjust if path differs

// (existing types like SessionRecord remain)

export class SessionTokenStore implements OAuthTokenVerifier {
  private readonly store: JsonFileStore<{ sessions: SessionRecord[] }>;
  private readonly allowedEmailDomain: string;
  private readonly staticTokens: AppConfig["apiBearerTokens"];
  private readonly profiles: Record<string, ProfileConfig>;

  constructor(
    storePath: string,
    allowedEmailDomain: string,
    staticTokens: AppConfig["apiBearerTokens"] = [],
    profiles: Record<string, ProfileConfig> = {}
  ) {
    this.store = new JsonFileStore(storePath, { sessions: [] });
    this.allowedEmailDomain = allowedEmailDomain;
    this.staticTokens = staticTokens;
    this.profiles = profiles;
  }

  // ... existing methods ...

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const staticMatch = this.staticTokens.find((entry) => entry.token === token);
    if (staticMatch) {
      const profileConfig = this.profiles[staticMatch.profile];
      if (!profileConfig) {
        throw new InvalidTokenError(`Static token references unknown profile "${staticMatch.profile}".`);
      }
      return {
        token,
        clientId: "static-service-token",
        scopes: [],
        expiresAt: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60, // ~10 years
        resource: undefined,
        extra: {
          email: profileConfig.actorEmail,
          name: profileConfig.actorName,
          profile: staticMatch.profile,
          isStaticServiceToken: true
        }
      };
    }

    // existing OAuth-session lookup
    const now = Math.floor(Date.now() / 1000);
    const state = await this.store.read();
    const session = state.sessions.find((candidate) => candidate.token === token);
    if (!session || session.expiresAt <= now) {
      throw new InvalidTokenError("Invalid or expired token.");
    }
    return {
      token,
      clientId: session.clientId,
      scopes: session.scopes,
      expiresAt: session.expiresAt,
      resource: session.resource ? new URL(session.resource) : undefined,
      extra: { email: session.email, name: session.name }
    };
  }
}
```

(Keep the rest of the file — `issueAccessToken`, `assertAllowedEmail`, etc. — untouched.)

- [ ] **Step 4: Update the call site that constructs `SessionTokenStore`**

Find the construction in `src/http.ts` (search for `new SessionTokenStore`). Update it to pass the new args. Read first to see the exact line:

```bash
grep -n "new SessionTokenStore" /tmp/service-api/src/http.ts
```

Then update to:

```ts
const sessions = new SessionTokenStore(
  config.tokenStorePath,
  config.allowedEmailDomain,
  config.apiBearerTokens,
  config.profiles
);
```

- [ ] **Step 5: Run tests**

Run: `npm run build && npm test 2>&1 | tail -10`
Expected: build clean; static-bearer-auth tests pass; existing session-tokens tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/auth/session-tokens.ts src/http.ts test/static-bearer-auth.test.ts
git commit -m "auth: resolve static service tokens via API_BEARER_TOKENS before OAuth lookup"
```

---

### Task 5: Add `ActorOpts.scope` + `scopeFor` helper in `services.ts`

**Files:**
- Modify: `src/services.ts`

- [ ] **Step 1: Write a failing unit test for `scopeFor`**

Append to `test/services.test.ts`:

```ts
import { BrandInsightsService } from "../src/services.js";

describe("BrandInsightsService scopeFor", () => {
  it("returns scope override when provided", () => {
    const service = new BrandInsightsService(baseConfig());
    const scope = (service as unknown as { scopeFor: (opts: any) => any }).scopeFor({
      scope: {
        pipedriveAccessMode: "read-only",
        pipedriveWritePipelineIds: [],
        pipedriveWriteAuditNotes: false,
        isStaticServiceToken: true
      }
    });
    expect(scope.accessMode).toBe("read-only");
    expect(scope.pipelineIds).toEqual([]);
    expect(scope.auditNotes).toBe(false);
    expect(scope.isStatic).toBe(true);
  });

  it("falls back to AppConfig defaults when no scope on opts", () => {
    const service = new BrandInsightsService(baseConfig({
      pipedriveAccessMode: "pipeline-write",
      pipedriveWritePipelineIds: [9],
      pipedriveWriteAuditNotes: true
    }));
    const scope = (service as unknown as { scopeFor: (opts: any) => any }).scopeFor({});
    expect(scope.accessMode).toBe("pipeline-write");
    expect(scope.pipelineIds).toEqual([9]);
    expect(scope.auditNotes).toBe(true);
    expect(scope.isStatic).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/services.test.ts 2>&1 | tail -10`
Expected: FAIL — `scopeFor` method does not exist.

- [ ] **Step 3: Extend `ActorOpts` and add `scopeFor`**

In `src/services.ts`, update the `ActorOpts` interface:

```ts
export interface ActorOpts {
  actorEmail?: string;
  actorName?: string;
  scope?: {
    pipedriveAccessMode: AppConfig["pipedriveAccessMode"];
    pipedriveWritePipelineIds: number[];
    pipedriveWriteAuditNotes: boolean;
    isStaticServiceToken: boolean;
  };
}
```

Add a private helper inside `BrandInsightsService` (place near the other private helpers like `requirePipedrive`):

```ts
private scopeFor(opts: ActorOpts): {
  accessMode: AppConfig["pipedriveAccessMode"];
  pipelineIds: number[];
  auditNotes: boolean;
  isStatic: boolean;
} {
  if (opts.scope) {
    return {
      accessMode: opts.scope.pipedriveAccessMode,
      pipelineIds: opts.scope.pipedriveWritePipelineIds,
      auditNotes: opts.scope.pipedriveWriteAuditNotes,
      isStatic: opts.scope.isStaticServiceToken
    };
  }
  return {
    accessMode: this.config.pipedriveAccessMode,
    pipelineIds: this.config.pipedriveWritePipelineIds,
    auditNotes: this.config.pipedriveWriteAuditNotes,
    isStatic: false
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/services.test.ts 2>&1 | tail -10`
Expected: 9 passed (existing 7 + new 2).

- [ ] **Step 5: Commit**

```bash
git add src/services.ts test/services.test.ts
git commit -m "services: add ActorOpts.scope and scopeFor helper"
```

---

### Task 6: Refactor `services.ts` methods to use `scopeFor`

**Files:**
- Modify: `src/services.ts`

Goal: every method that currently reads `this.config.pipedriveAccessMode`, `this.config.pipedriveWritePipelineIds`, or `this.config.pipedriveWriteAuditNotes` reads from `scopeFor(opts)` instead. This makes scope per-request.

- [ ] **Step 1: List all reads of those three config fields**

Run: `grep -n "this.config.pipedriveAccessMode\|this.config.pipedriveWritePipelineIds\|this.config.pipedriveWriteAuditNotes" /tmp/service-api/src/services.ts`

Expected: handful of lines in `requireNonReadOnlyPipedriveWrite`, `requireGenericPipedriveWriteAccess`, `requireDealInAllowedPipeline`, `requireAllowedPipelineId`, `writePipedriveAuditNoteForDeal`, `appendAuditMarker` callers, and `createActivity`.

- [ ] **Step 2: Add a failing scope-enforcement test**

Append to `test/services-audit-on-api-request.test.ts`:

```ts
describe("BrandInsightsService.requestPipedrive per-request scope", () => {
  it("blocks writes when opts.scope is read-only", async () => {
    stubFetch({ data: { id: 999 } });
    const service = new BrandInsightsService(baseConfig({ pipedriveAccessMode: "unrestricted" }));

    await expect(
      service.requestPipedrive(
        { method: "POST", path: "/v1/notes", body: { content: "hi", deal_id: 1 } },
        {
          ...ACTOR,
          scope: {
            pipedriveAccessMode: "read-only",
            pipedriveWritePipelineIds: [],
            pipedriveWriteAuditNotes: false,
            isStaticServiceToken: true
          }
        }
      )
    ).rejects.toThrow(/read-only/i);
  });

  it("uses scope.pipedriveWriteAuditNotes for the inline suffix gate? no — inline always fires when actor known", async () => {
    const { calls } = stubFetch({ data: { id: 999 } });
    const service = new BrandInsightsService(baseConfig({ pipedriveAccessMode: "unrestricted", pipedriveWriteAuditNotes: false }));

    await service.requestPipedrive(
      { method: "POST", path: "/v1/notes", body: { content: "hi", deal_id: 1 } },
      {
        ...ACTOR,
        scope: {
          pipedriveAccessMode: "unrestricted",
          pipedriveWritePipelineIds: [],
          pipedriveWriteAuditNotes: false,
          isStaticServiceToken: true
        }
      }
    );

    expect(calls).toHaveLength(1);
    expect((calls[0].body as Record<string, unknown>).content).toMatch(/Wrote note through Hermes MCP by/);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx vitest run test/services-audit-on-api-request.test.ts 2>&1 | tail -10`
Expected: read-only test fails because access-mode gate still reads from `this.config`.

- [ ] **Step 4: Refactor each affected method to take `ActorOpts` and use `scopeFor`**

For each method below, replace `this.config.<field>` with `this.scopeFor(opts).<mapped-name>`. Affected methods and the exact replacement:

| Method | Currently reads | Replace with |
|---|---|---|
| `requireNonReadOnlyPipedriveWrite(action, opts)` | `this.config.pipedriveAccessMode` | `this.scopeFor(opts).accessMode` |
| `requireGenericPipedriveWriteAccess(input, accessToken, opts)` | `this.config.pipedriveAccessMode` | `this.scopeFor(opts).accessMode` |
| `requireDealInAllowedPipeline(dealId, accessToken, action, opts)` | `this.config.pipedriveAccessMode` | `this.scopeFor(opts).accessMode` |
| `requireAllowedPipelineId(pipelineId, action, opts)` | `this.config.pipedriveWritePipelineIds` | `this.scopeFor(opts).pipelineIds` |
| `requirePipelineWriteForTarget(target, accessToken, action, opts)` | both above | both above |
| `writePipedriveAuditNoteForDeal(dealId, action, opts, accessToken)` | `this.config.pipedriveWriteAuditNotes` | `this.scopeFor(opts).auditNotes` |
| `createActivity` | `this.config.pipedriveWriteAuditNotes` | `this.scopeFor(opts).auditNotes` |

Each private method that doesn't currently take `opts` gains an `opts: ActorOpts` parameter. Call sites within `services.ts` thread `opts` through.

Concrete change for `requireNonReadOnlyPipedriveWrite` (pattern for all):

```ts
private requireNonReadOnlyPipedriveWrite(action: string, opts: ActorOpts): void {
  if (this.scopeFor(opts).accessMode === "read-only") {
    throw new Error(`Pipedrive ${action} is not allowed in read-only mode.`);
  }
}
```

Concrete change for `requireGenericPipedriveWriteAccess` (signature + first line):

```ts
private async requireGenericPipedriveWriteAccess(
  input: PipedriveApiRequestInput,
  accessToken: string | undefined,
  opts: ActorOpts
): Promise<void> {
  this.requireNonReadOnlyPipedriveWrite(`${input.method} ${input.path}`, opts);
  if (this.scopeFor(opts).accessMode !== "pipeline-write") return;
  // ... rest unchanged except each call to requireDealInAllowedPipeline/requireAllowedPipelineId now passes opts
}
```

(Repeat for the rest. Compiler errors will guide each missing `opts` argument.)

Concrete change for `requestPipedrive` to pass `opts`:

```ts
async requestPipedrive(input: PipedriveApiRequestInput, opts: ActorOpts = {}): Promise<PipedriveApiResponse> {
  const accessToken = await this.getPipedriveAccessToken(opts.actorEmail);
  const isWrite = isWriteMethod(input.method);
  if (isWrite) {
    this.requireUserAccessForWrite(accessToken, opts);   // signature change in Task 7
    await this.requireGenericPipedriveWriteAccess(input, accessToken, opts);
  }
  // ... rest unchanged ...
}
```

And inside `writePipedriveAuditNoteForDeal`:

```ts
private async writePipedriveAuditNoteForDeal(
  dealId: number | undefined,
  action: string,
  opts: ActorOpts,
  accessToken: string | undefined
): Promise<void> {
  if (!dealId || !this.scopeFor(opts).auditNotes) return;
  // ... rest unchanged ...
}
```

- [ ] **Step 5: Run all tests**

Run: `npm run build && npm test 2>&1 | tail -10`
Expected: build clean; all 89+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services.ts test/services-audit-on-api-request.test.ts
git commit -m "services: route pipedrive scope checks through scopeFor(opts)"
```

---

### Task 7: Bypass `requireUserAccessForWrite` for static service tokens

**Files:**
- Modify: `src/services.ts`

- [ ] **Step 1: Add failing test**

Append to `test/services-audit-on-api-request.test.ts`:

```ts
describe("requireUserAccessForWrite static token bypass", () => {
  it("static service token bypasses user-OAuth-required check", async () => {
    stubFetch({ data: { id: 1 } });
    const service = new BrandInsightsService(baseConfig({ pipedriveRequireUserOAuthForWrites: true }));

    await expect(
      service.requestPipedrive(
        { method: "POST", path: "/v1/notes", body: { content: "hi", deal_id: 1 } },
        {
          ...ACTOR,
          scope: {
            pipedriveAccessMode: "unrestricted",
            pipedriveWritePipelineIds: [],
            pipedriveWriteAuditNotes: false,
            isStaticServiceToken: true
          }
        }
      )
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/services-audit-on-api-request.test.ts -t "static service token bypasses" 2>&1 | tail -8`
Expected: FAIL — throws "not connected your Pipedrive account."

- [ ] **Step 3: Update `requireUserAccessForWrite`**

Change signature and add the bypass:

```ts
private requireUserAccessForWrite(accessToken: string | undefined, opts: ActorOpts): void {
  if (this.scopeFor(opts).isStatic) return;
  if (!this.config.pipedriveRequireUserOAuthForWrites) return;
  if (!opts.actorEmail) {
    throw new Error("Pipedrive write requires an authenticated Genvest user. No actor email available on this MCP request.");
  }
  if (!accessToken) {
    throw new Error("You have not connected your Pipedrive account yet. Call the pipedrive_connect_me tool to get a connect URL, then authorize Pipedrive.");
  }
}
```

Update the call site in `requestPipedrive` (Task 6 already changed it to `opts`).

Update other call sites that call `requireUserAccessForWrite` with `email` arg — search them out:

```bash
grep -n "requireUserAccessForWrite" /tmp/service-api/src/services.ts
```

Each call now passes `opts` instead of `email`.

- [ ] **Step 4: Run tests**

Run: `npm run build && npm test 2>&1 | tail -10`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/services.ts test/services-audit-on-api-request.test.ts
git commit -m "services: bypass user-OAuth-required check for static service tokens"
```

---

### Task 8: `scopeFromExtra` helper in `tools/shared.ts`

**Files:**
- Modify: `src/tools/shared.ts`

- [ ] **Step 1: Add failing helper test**

Create `test/scope-from-extra.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { scopeFromExtra } from "../src/tools/shared.js";
import type { ProfileConfig } from "../src/types.js";

const PROFILES: Record<string, ProfileConfig> = {
  cs: {
    actorEmail: "cs@genvest.com.au",
    actorName: "@cs",
    pipedriveAccessMode: "pipeline-write",
    pipedriveWritePipelineIds: [4],
    pipedriveWriteAuditNotes: true
  }
};

function extra(authExtra: unknown) {
  return { authInfo: { extra: authExtra } } as any;
}

describe("scopeFromExtra", () => {
  it("returns identity + scope when profile is known and static-token", () => {
    const result = scopeFromExtra(extra({ profile: "cs", isStaticServiceToken: true }), PROFILES);
    expect(result.actorName).toBe("@cs");
    expect(result.scope?.pipedriveAccessMode).toBe("pipeline-write");
    expect(result.scope?.isStaticServiceToken).toBe(true);
  });

  it("returns empty when profile is missing", () => {
    expect(scopeFromExtra(extra({}), PROFILES)).toEqual({});
  });

  it("returns empty when profile name is unknown", () => {
    expect(scopeFromExtra(extra({ profile: "nope" }), PROFILES)).toEqual({});
  });

  it("sets isStaticServiceToken to false when flag missing", () => {
    const result = scopeFromExtra(extra({ profile: "cs" }), PROFILES);
    expect(result.scope?.isStaticServiceToken).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scope-from-extra.test.ts 2>&1 | tail -8`
Expected: FAIL — `scopeFromExtra` not exported.

- [ ] **Step 3: Add `scopeFromExtra` to `src/tools/shared.ts`**

Append to the end of `src/tools/shared.ts`:

```ts
import type { ActorOpts } from "../services.js";
import type { ProfileConfig } from "../types.js";

export function scopeFromExtra(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  profiles: Record<string, ProfileConfig>
): { actorEmail?: string; actorName?: string; scope?: ActorOpts["scope"] } {
  const rawProfile = extra.authInfo?.extra?.profile;
  if (typeof rawProfile !== "string" || !profiles[rawProfile]) return {};
  const p = profiles[rawProfile];
  return {
    actorEmail: p.actorEmail,
    actorName: p.actorName,
    scope: {
      pipedriveAccessMode: p.pipedriveAccessMode,
      pipedriveWritePipelineIds: p.pipedriveWritePipelineIds,
      pipedriveWriteAuditNotes: p.pipedriveWriteAuditNotes,
      isStaticServiceToken: extra.authInfo?.extra?.isStaticServiceToken === true
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scope-from-extra.test.ts 2>&1 | tail -5`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tools/shared.ts test/scope-from-extra.test.ts
git commit -m "tools: add scopeFromExtra helper to derive ActorOpts from AuthInfo"
```

---

### Task 9: Wire `profiles` through `createMcpServer` → `registerTools` → `generated.ts`

**Files:**
- Modify: `src/server.ts`, `src/tools/register.ts`, `src/tools/generated.ts`, `src/http.ts`

- [ ] **Step 1: Extend `RegisterToolsOptions.config`**

In `src/tools/register.ts`, change:

```ts
export interface RegisterToolsOptions {
  config?: Pick<AppConfig, "apiBaseUrl"> & Partial<Pick<
    AppConfig,
    "googleCredentials" | "claritySites" | "mcpActorEmail" | "mcpActorName"
  >>;
  profiles?: Record<string, ProfileConfig>;
}
```

Add `import type { ProfileConfig } from "../types.js";` at the top.

- [ ] **Step 2: Thread `profiles` into `actorOpts`**

In `src/tools/register.ts`, find `actorOpts(extra, fallback)`. Update it to use `scopeFromExtra` when profiles are available:

```ts
function actorOpts(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  fallback: { actorEmail?: string; actorName?: string },
  profiles: Record<string, ProfileConfig> = {}
): ActorOpts {
  const profileDerived = scopeFromExtra(extra, profiles);
  return {
    actorEmail: profileDerived.actorEmail ?? realActorEmail(extra, fallback.actorEmail),
    actorName: profileDerived.actorName ?? actorNameFromExtra(extra, fallback.actorName),
    scope: profileDerived.scope
  };
}
```

Import `scopeFromExtra` from `./shared.js`.

Update every call to `actorOpts(extra, actorIdentity)` to pass profiles as a third argument:

```bash
grep -n "actorOpts(extra" /tmp/service-api/src/tools/register.ts
```

Each call becomes `actorOpts(extra, actorIdentity, options.profiles)`.

- [ ] **Step 3: Apply the same change in `generated.ts`**

In `src/tools/generated.ts`, find the handler that builds `actorEmail`/`actorName`/`actorOpts` (around line 280-352). Replace with:

```ts
const derived = scopeFromExtra(extra, options.profiles ?? {});
const actorEmail = derived.actorEmail ?? actorEmailFromExtra(extra, actorIdentity.actorEmail);
const actorName = derived.actorName ?? actorNameFromExtra(extra, actorIdentity.actorName);

const response = await service.requestPipedrive(
  { /* unchanged */ },
  {
    actorEmail: actorEmail === "local-stdio" ? undefined : actorEmail,
    actorName,
    scope: derived.scope
  }
);
```

Add `import { scopeFromExtra } from "./shared.js";`.

Also extend the options type. Find where `generated.ts` accepts options — adjust to accept `profiles` similarly.

- [ ] **Step 4: Update `createMcpServer` to forward `profiles`**

In `src/server.ts`:

```bash
grep -n "registerTools" /tmp/service-api/src/server.ts
```

Wherever `registerTools(server, service, auditLogger, options)` is called, ensure `options.profiles` is propagated. If `createMcpServer` accepts `options: { config: {...}, profiles?: Record<string, ProfileConfig> }`, pass it through to `registerTools`.

- [ ] **Step 5: Update `http.ts` to pass `profiles` to `createMcpServer`**

In `src/http.ts`, the `createMcpServer` call at the route handler (around line 163-173). Update to:

```ts
await createMcpServer(service, auditLogger, {
  config: {
    apiBaseUrl: config.apiBaseUrl,
    mcpActorEmail: config.mcpActorEmail,
    mcpActorName: config.mcpActorName,
    pipedriveAccessMode: config.pipedriveAccessMode,
    pipedriveWritePipelineIds: config.pipedriveWritePipelineIds,
    googleCredentials: config.googleCredentials,
    claritySites: config.claritySites
  },
  profiles: config.profiles
}).connect(transport);
```

Similar update at any other `createMcpServer` call site (e.g., `src/index.ts` for stdio mode — pass `profiles: {}` since stdio won't use them).

- [ ] **Step 6: Write an end-to-end integration test**

Create `test/profile-scope-end-to-end.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrandInsightsService } from "../src/services.js";
import type { AppConfig, ProfileConfig } from "../src/types.js";

const PROFILES: Record<string, ProfileConfig> = {
  cs: {
    actorEmail: "cs_bot@genvest.com.au",
    actorName: "@cs_bot",
    pipedriveAccessMode: "pipeline-write",
    pipedriveWritePipelineIds: [4],
    pipedriveWriteAuditNotes: true
  },
  m: {
    actorEmail: "m_bot@genvest.com.au",
    actorName: "@m_bot",
    pipedriveAccessMode: "read-only",
    pipedriveWritePipelineIds: [],
    pipedriveWriteAuditNotes: false
  }
};

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000, transport: "stdio", allowedEmailDomain: "genvest.com.au",
    apiBearerTokens: [], auditLogPath: "/tmp/a", tokenStorePath: "/tmp/t",
    pipedriveTokenStorePath: "/tmp/p", pipedriveUserTokenStorePath: "/tmp/u",
    pipedriveOAuthStateStorePath: "/tmp/s",
    pipedriveRequireUserOAuthForWrites: false,
    pipedriveAccessMode: "unrestricted", pipedriveWritePipelineIds: [],
    pipedriveWriteAuditNotes: false, microsoft: {}, gscBrandTerms: [],
    pipedriveApiToken: "tok", pipedriveCompanyDomain: "genvest",
    pipedriveOAuth: {}, profiles: PROFILES,
    ...overrides
  };
}

function stubFetch(payload: unknown) {
  const calls: Array<{ url: URL; method: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input) : input;
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { ok: true, status: 200, statusText: "OK", headers: new Headers({ "content-type": "application/json" }), json: async () => payload };
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("profile scope end-to-end via ActorOpts", () => {
  it("marketing profile blocks a write to /v1/notes", async () => {
    stubFetch({});
    const service = new BrandInsightsService(baseConfig());
    await expect(
      service.requestPipedrive(
        { method: "POST", path: "/v1/notes", body: { content: "hi", deal_id: 1 } },
        {
          actorEmail: PROFILES.m.actorEmail,
          actorName: PROFILES.m.actorName,
          scope: {
            pipedriveAccessMode: PROFILES.m.pipedriveAccessMode,
            pipedriveWritePipelineIds: PROFILES.m.pipedriveWritePipelineIds,
            pipedriveWriteAuditNotes: PROFILES.m.pipedriveWriteAuditNotes,
            isStaticServiceToken: true
          }
        }
      )
    ).rejects.toThrow(/read-only/i);
  });

  it("CS profile applies inline suffix using profile actorName", async () => {
    const calls = stubFetch({ data: { id: 999 } });
    const service = new BrandInsightsService(baseConfig());
    await service.requestPipedrive(
      { method: "POST", path: "/v1/notes", body: { content: "hello", deal_id: 1 } },
      {
        actorEmail: PROFILES.cs.actorEmail,
        actorName: PROFILES.cs.actorName,
        scope: {
          pipedriveAccessMode: PROFILES.cs.pipedriveAccessMode,
          pipedriveWritePipelineIds: PROFILES.cs.pipedriveWritePipelineIds,
          pipedriveWriteAuditNotes: PROFILES.cs.pipedriveWriteAuditNotes,
          isStaticServiceToken: true
        }
      }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].body.content).toBe("hello\n\nWrote note through Hermes MCP by @cs_bot.");
  });
});
```

- [ ] **Step 7: Run the full test suite**

Run: `npm run build && npm test 2>&1 | tail -10`
Expected: build clean; all tests pass (existing + ~10 new).

- [ ] **Step 8: Commit**

```bash
git add src/server.ts src/tools/register.ts src/tools/generated.ts src/http.ts test/profile-scope-end-to-end.test.ts
git commit -m "tools: thread profiles map through createMcpServer → registerTools → generated handler"
```

---

### Task 10: Open PR

**Files:**
- None (PR operation)

- [ ] **Step 1: Push branch**

```bash
cd /tmp/service-api
git push -u origin feat/shared-http-mcp-profile-tokens 2>&1 | tail -5
```

- [ ] **Step 2: Open PR with full description**

```bash
gh pr create --title "Shared HTTP MCP: profile-bound static bearer tokens" --body "$(cat <<'EOF'
## Summary

Consolidates the three per-profile stdio MCP subprocesses on the genvest droplet into a single shared HTTP MCP (the existing Coolify-deployed service-api). Each Hermes profile authenticates with a profile-bound static bearer token; per-request scope (Pipedrive access mode, pipeline allowlist, audit-note flag, actor identity) flows from the token through `AuthInfo` into `ActorOpts`.

See design doc: docs/superpowers/specs/2026-05-18-shared-http-mcp-design.md (in the lee-dashboard repo).

## What changes in this PR

- `API_BEARER_TOKENS` format extended from `token:email` to `token:email:profile`. Validated at startup.
- New env `HERMES_PROFILES_JSON` carries per-profile config (`actorEmail`, `actorName`, `pipedriveAccessMode`, `pipedriveWritePipelineIds`, `pipedriveWriteAuditNotes`). Profile names referenced by tokens must exist.
- `SessionTokenStore.verifyAccessToken` checks static tokens before OAuth lookup. Returns `AuthInfo{ extra: { email, name, profile, isStaticServiceToken: true } }`.
- `ActorOpts` gains an optional `scope` field. `BrandInsightsService` methods read scope from `opts` instead of `this.config` via a new private `scopeFor` helper.
- `requireUserAccessForWrite` bypasses the user-OAuth-required check when the request comes from a static service token.
- `tools/shared.ts` exports `scopeFromExtra`, used by `register.ts` and `generated.ts` to derive `ActorOpts` from `AuthInfo`.

## Behaviour preserved

- All 87 existing tests pass.
- OAuth-session lookups (Claude.ai / human MCP clients) still work via the fallthrough path.
- Inline audit suffix (PR #1/#2) still fires; now uses the profile's `actorName` when scope is present.

## Tests added

~15 new test cases covering: ProfileConfig type, profiles JSON parser, extended bearer token parser, static-token auth resolution, scope-from-extra helper, per-request scope enforcement, static-token bypass of user-OAuth-required, end-to-end profile scope.

## Rollout

Code-only PR. After merge, the operator (Lee) sets `API_BEARER_TOKENS` and `HERMES_PROFILES_JSON` env vars in Coolify, then migrates each Hermes profile's `config.yaml` from stdio to HTTP one at a time.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -5
```

- [ ] **Step 3: Verify PR opened**

```bash
gh pr view --json url,state,title 2>&1
```

Expected: state `OPEN`, valid PR URL.

---

## Stage B — Coolify environment setup

After PR merges, Coolify auto-deploys. Operator does steps below in the order shown. **Do NOT skip the verification curls.**

### Task 11: Generate three profile bearer tokens

**Files:**
- Local: a scratch text file or a password manager entry

- [ ] **Step 1: Generate three random tokens**

Run:

```bash
for label in cs sales m; do
  printf '%s=' "tok_${label}_$(openssl rand -hex 24)"
done
echo
```

Expected: three lines like `tok_cs_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=`. The trailing `=` is just a separator — strip it. Save the three tokens to a password manager (1Password / Bitwarden) under "Genvest Hermes MCP bearer tokens".

- [ ] **Step 2: Note token-to-profile mapping**

```
tok_cs_…    → genvest-head-of-customer-service
tok_sales_… → genvest-head-of-sales
tok_m_…     → genvest-head-of-marketing
```

---

### Task 12: Set Coolify env vars and redeploy

**Files:**
- Coolify env editor for the service-api app

- [ ] **Step 1: Build the `API_BEARER_TOKENS` value**

Format:

```
tok_cs_xxxxx:cs_genvest_bot@genvest.com.au:genvest-head-of-customer-service,tok_sales_xxxxx:co_genvest_bot@genvest.com.au:genvest-head-of-sales,tok_m_xxxxx:m_genvest_bot@genvest.com.au:genvest-head-of-marketing
```

- [ ] **Step 2: Build the `HERMES_PROFILES_JSON` value**

```json
{"genvest-head-of-customer-service":{"actorEmail":"cs_genvest_bot@genvest.com.au","actorName":"@cs_genvest_bot","pipedriveAccessMode":"pipeline-write","pipedriveWritePipelineIds":[4],"pipedriveWriteAuditNotes":true},"genvest-head-of-sales":{"actorEmail":"co_genvest_bot@genvest.com.au","actorName":"@co_genvest_bot","pipedriveAccessMode":"pipeline-write","pipedriveWritePipelineIds":[2],"pipedriveWriteAuditNotes":true},"genvest-head-of-marketing":{"actorEmail":"m_genvest_bot@genvest.com.au","actorName":"@m_genvest_bot","pipedriveAccessMode":"read-only","pipedriveWritePipelineIds":[],"pipedriveWriteAuditNotes":false}}
```

- [ ] **Step 3: Add both env vars via Coolify API**

```bash
TOKEN=$(grep '^COOLIFY_ACCESS_TOKEN=' /Users/leebaroneau/Documents/GitHub/lee-dashboard/genvest/.env | cut -d= -f2-)
URL=$(grep '^COOLIFY_BASE_URL=' /Users/leebaroneau/Documents/GitHub/lee-dashboard/genvest/.env | cut -d= -f2- | sed 's:/*$::')
APP=xijr3xcrq2k2pguetd7f5v4n

curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/v1/applications/$APP/envs" \
  -d '{"key":"API_BEARER_TOKENS","value":"<the value from Step 1>","is_preview":false,"is_build_time":false}'

curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/v1/applications/$APP/envs" \
  -d '{"key":"HERMES_PROFILES_JSON","value":"<the value from Step 2>","is_preview":false,"is_build_time":false}'
```

Expected: each returns a JSON object with the new env entry.

- [ ] **Step 4: Redeploy via Coolify deploy endpoint**

```bash
curl -sS -H "Authorization: Bearer $TOKEN" "$URL/api/v1/deploy?uuid=$APP"
```

Wait ~3 minutes, then:

```bash
curl -sS -H "Authorization: Bearer $TOKEN" "$URL/api/v1/applications/$APP" | python3 -c "import json,sys;a=json.load(sys.stdin);print('status=',a.get('status'))"
```

Expected: `status= running:healthy`.

- [ ] **Step 5: Smoke-test the CS token**

```bash
CS_TOKEN="tok_cs_…"   # the one you generated
curl -sS -X POST -H "Authorization: Bearer $CS_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  "https://service-api.209.38.27.69.sslip.io/mcp" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
```

Expected: HTTP 200 with a `result.serverInfo` field. If 401, the token isn't being parsed — check env value spelling and redeploy.

---

## Stage C — Migrate the CS profile (single-profile rehearsal)

### Task 13: Update CS profile's `config.yaml` on the droplet

**Files:**
- On droplet: `/data/hermes/profiles/genvest-head-of-customer-service/config.yaml`

- [ ] **Step 1: Read the current `mcp_servers.genvest` block**

```bash
ssh genvest-droplet "docker exec \$(docker ps --filter name=hermes- --format '{{.Names}}') sed -n '/^mcp_servers:/,/^[a-z]/p' /data/hermes/profiles/genvest-head-of-customer-service/config.yaml"
```

Note the current `tools.include` list (if any) — you must preserve it.

- [ ] **Step 2: Back up the config**

```bash
ssh genvest-droplet "docker exec \$(docker ps --filter name=hermes- --format '{{.Names}}') cp /data/hermes/profiles/genvest-head-of-customer-service/config.yaml /data/hermes/profiles/genvest-head-of-customer-service/config.yaml.bak-$(date +%s)"
```

- [ ] **Step 3: Replace the `genvest` MCP block**

Write the new block to a temp file locally, then copy in. New content:

```yaml
  genvest:
    url: "https://service-api.209.38.27.69.sslip.io/mcp"
    headers:
      Authorization: "Bearer <tok_cs_…>"
    enabled: true
    timeout: 120
    connect_timeout: 60
    tools:
      # PRESERVE the include: list from the old block
```

The safest approach is a targeted Python rewrite via the container:

```bash
ssh genvest-droplet "docker exec -u hermes \$(docker ps --filter name=hermes- --format '{{.Names}}') python3 -c '
import yaml, pathlib
p = pathlib.Path(\"/data/hermes/profiles/genvest-head-of-customer-service/config.yaml\")
cfg = yaml.safe_load(p.read_text())
old = cfg.setdefault(\"mcp_servers\", {}).get(\"genvest\", {})
cfg[\"mcp_servers\"][\"genvest\"] = {
  \"url\": \"https://service-api.209.38.27.69.sslip.io/mcp\",
  \"headers\": {\"Authorization\": \"Bearer <tok_cs_…>\"},
  \"enabled\": True,
  \"timeout\": 120,
  \"connect_timeout\": 60,
  \"tools\": old.get(\"tools\", {})
}
p.write_text(yaml.safe_dump(cfg, sort_keys=False))
print(\"updated\")
'"
```

Replace `<tok_cs_…>` with the actual token before running.

---

### Task 14: Restart CS gateway and verify end-to-end

**Files:**
- Hermes container's gateway process

- [ ] **Step 1: Find current Hermes container**

```bash
CT=$(ssh genvest-droplet "docker ps --filter name=hermes- --format '{{.Names}}'")
echo "$CT"
```

- [ ] **Step 2: Relaunch CS gateway with `--replace`**

```bash
ssh genvest-droplet "docker exec -u hermes -d $CT bash -c 'nohup hermes --profile genvest-head-of-customer-service gateway run --replace --accept-hooks >> /data/hermes/profiles/genvest-head-of-customer-service/logs/gateway.log 2>&1 < /dev/null'"
```

- [ ] **Step 3: Confirm the new gateway started**

```bash
sleep 15
ssh genvest-droplet "docker exec $CT bash -c 'tail -30 /data/hermes/profiles/genvest-head-of-customer-service/logs/agent.log' | grep -iE 'mcp.*genvest|registered'"
```

Expected: a line like `MCP server 'genvest' (streamable_http): registered N tool(s)`.

- [ ] **Step 4: Telegram test**

In the `@cs_genvest_bot` group, send:

```
@cs_genvest_bot please add a note 'shared-mcp test' to the Lee Barone deal
```

Verify in Pipedrive:
- The deal has a new note with content `shared-mcp test\n\nWrote note through Hermes MCP by @cs_genvest_bot.`
- Only ONE new note (no separate audit note).

If it fails, run `ssh genvest-droplet "docker exec $CT bash -c 'tail -60 /data/hermes/profiles/genvest-head-of-customer-service/logs/agent.log'"` and diagnose.

- [ ] **Step 5: Wrong-pipeline test (CS should NOT be able to write to pipeline 2)**

In the same group:

```
@cs_genvest_bot try to create a test deal on pipeline 2 (you should be blocked)
```

Expected: bot replies with an error message about pipeline 2 not being in its allowlist.

---

## Stage D — Migrate Sales and Marketing profiles

### Task 15: Migrate `genvest-head-of-sales`

- [ ] **Step 1: Repeat Task 13 with the sales token and `genvest-head-of-sales` path**
- [ ] **Step 2: Repeat Task 14 with the sales profile**
- [ ] **Step 3: Telegram test in the `@co_genvest_bot` group — a write to pipeline 2 succeeds, pipeline 4 is blocked**

### Task 16: Migrate `genvest-head-of-marketing`

- [ ] **Step 1: Repeat Task 13 with the marketing token and `genvest-head-of-marketing` path**
- [ ] **Step 2: Repeat Task 14 with the marketing profile**
- [ ] **Step 3: Telegram test in the `@m_genvest_bot` group — reads work, any write attempt is blocked with "read-only" message**

---

## Stage E — Cleanup

Only after all three Telegram-side tests pass.

### Task 17: Remove the stdio dist and launcher

- [ ] **Step 1: Confirm no profile config still references the launcher**

```bash
ssh genvest-droplet "docker exec \$(docker ps --filter name=hermes- --format '{{.Names}}') grep -r '/data/mcp/genvest-service-api' /data/hermes/profiles/ 2>/dev/null"
```

Expected: no matches.

- [ ] **Step 2: Delete the stdio dist directory and backups**

```bash
ssh genvest-droplet "docker exec -u hermes \$(docker ps --filter name=hermes- --format '{{.Names}}') rm -rf /data/mcp/genvest-service-api"
```

### Task 18: Remove obsolete per-profile env entries

- [ ] **Step 1: For each genvest profile, strip the stdio-era env entries from `.env`**

```bash
ssh genvest-droplet "docker exec -u hermes \$(docker ps --filter name=hermes- --format '{{.Names}}') bash -c '
for prof in genvest-head-of-customer-service genvest-head-of-sales genvest-head-of-marketing; do
  envf=/data/hermes/profiles/\$prof/.env
  cp \$envf \$envf.bak
  grep -vE \"^(GENVEST_MCP_ACTOR_EMAIL|GENVEST_MCP_ACTOR_NAME|PIPEDRIVE_ACCESS_MODE|PIPEDRIVE_WRITE_PIPELINE_IDS|PIPEDRIVE_WRITE_AUDIT_NOTES|PIPEDRIVE_REQUIRE_USER_OAUTH_FOR_WRITES|MCP_TRANSPORT|GENVEST_MCP_HOME)=\" \$envf.bak > \$envf
done
echo done
'"
```

- [ ] **Step 2: Restart all three gateways once more to confirm they still work without those envs**

Repeat the relaunch command from Task 14 Step 2 for each profile.

- [ ] **Step 3: Final Telegram smoke tests in all three groups**

Quick sanity ping in each bot's group. Confirm responses.

- [ ] **Step 4: Mark migration complete**

Update `MEMORY.md` in `genvest/` with the new architecture note. Suggested content:

```
- Genvest Hermes profiles now use a single shared HTTP MCP (the Coolify-deployed service-api). Per-profile config lives in `API_BEARER_TOKENS` and `HERMES_PROFILES_JSON` env vars on the Coolify app. No more stdio MCP at /data/mcp/genvest-service-api/.
```

---

## Self-review checklist

- [x] Spec coverage: every section in the design doc maps to a task (types → T1; HERMES_PROFILES_JSON → T2; token format → T3; auth path → T4; scope plumbing → T5/T6; static-token bypass → T7; tool handler glue → T8/T9; Hermes-side config → T13–T16; cleanup → T17/T18; rollout table → Stages B/C/D order).
- [x] Placeholders: none. Every code step has actual code; every command has expected output.
- [x] Type consistency: `ProfileConfig`, `ActorOpts.scope`, `scopeFor`, `scopeFromExtra`, and `AuthInfo.extra.profile`/`isStaticServiceToken` are referenced consistently across all tasks.
- [x] TDD: every code task starts with a failing test, then implementation, then verify, then commit.

---

## Risks during execution

- Some helper functions live in slightly different file paths than I assumed (`JsonFileStore` location in Task 4, exact line numbers in `register.ts`/`generated.ts`). Read the current file before each edit; rely on `grep -n` patterns shown in each step rather than hardcoded line numbers.
- Vitest globals (`vi.stubGlobal`, `vi.unstubAllGlobals`) are unstubbed via the `afterEach` in `test/services-audit-on-api-request.test.ts`. New test files should do the same.
- Coolify env writes (Task 12 Step 3) may need a different shape if the Coolify API has changed. If the POST returns 4xx, fall back to the Coolify web UI for env editing.
