# Composio Demotion + Working-Tree Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demote Composio from the default upstream for `microsoft`/`google` to opt-in fallback under renamed slugs (`microsoft-composio`/`google-composio`), gated by a new `ENABLE_COMPOSIO_PROVIDERS` env flag (default `false`), while preserving the partially-done Composio work currently uncommitted in the working tree.

**Architecture:** The local working tree contains uncommitted Composio integration that assumed Composio would be the default for Microsoft/Google. That assumption is reversed in [2026-05-24-google-native-and-composio-demotion-design.md](../specs/2026-05-24-google-native-and-composio-demotion-design.md). This plan lands the Composio code under renamed slugs and an env-gate so it remains opt-in, while restoring the default registry to native `microsoft` + native `google` (placeholder until Plan 3 lands Google). No code is deleted.

**Tech Stack:** TypeScript, Node 20, Express 4, Vitest, Zod, `@composio/core` (already added to package.json by the uncommitted work).

---

## Pre-flight: Repo state assumptions

- Local working tree has uncommitted Composio work (modified: `.env.example`, `README.md`, `docs/service-auth-flow.md`, `package.json`, `package-lock.json`, `src/cli.ts`, `src/config.ts`, `src/http.ts`, `src/mcp/server.ts`, `src/providers/defaults.ts`, `src/providers/types.ts`; untracked: `src/providers/composio/`, `docs/superpowers/specs/2026-05-23-composio-provider-design.md`, `docs/superpowers/plans/`, `test/composio-provider.test.ts`).
- `origin/main` head is `471848b feat(pipedrive): add Pipedrive OAuth provider with api_domain support (#1)`.
- Repo follows Pipeline Core governance — `.github/pipeline-config.yml` is present; the issue → branch → PR sequence is mandatory.

## File Structure (this plan touches)

```
template-gateway/
├── .env.example                                    # modify (revert + add ENABLE_COMPOSIO_PROVIDERS)
├── README.md                                       # modify (rewrite Composio section as opt-in)
├── docs/
│   ├── service-auth-flow.md                        # modify (note Composio is opt-in)
│   └── superpowers/specs/
│       └── 2026-05-23-composio-provider-design.md  # modify (add superseded header)
├── src/
│   ├── cli.ts                                      # modify (gate Composio commands behind flag)
│   ├── config.ts                                   # modify (add flag, make composio config conditional)
│   ├── http.ts                                     # modify (revert /auth/microsoft-native → /auth/microsoft, gate generic provider routes)
│   ├── mcp/server.ts                               # modify (gate Composio MCP tools behind flag, accept renamed slugs)
│   └── providers/
│       ├── defaults.ts                             # modify (native microsoft+google in defaults; renamed composio slugs opt-in)
│       ├── types.ts                                # keep backend? field (already added by uncommitted work)
│       └── composio/
│           ├── binding-store.ts                    # keep (no changes)
│           ├── factory.ts                          # keep (no changes)
│           ├── service.ts                          # modify (no slug references inside; verify)
│           └── types.ts                            # modify (rename slug constants)
└── test/
    ├── config.test.ts                              # modify (add flag tests)
    ├── http.test.ts                                # modify (revert microsoft-native paths; add gate tests)
    ├── mcp-server.test.ts                          # modify (gate tests)
    ├── providers.test.ts                           # modify (native defaults; opt-in composio)
    └── composio-provider.test.ts                   # modify (rename slugs, add flag scaffolding)
```

---

## Phase 0: Setup

### Task 0.1: Open the GitHub issue

- [ ] **Step 1: Create the issue with the required type-prefix title and label**

The repo's Pipeline Core configuration requires the issue title to start with one of `Bug:`, `Feature request:`, `Task:`, `Spike:`, `Experiment:`, `Epic:` and to carry a matching `type:` label.

Run:

```bash
cd 00_repos/template-gateway
gh issue create \
  --title "Task: demote Composio to opt-in (renamed slugs + env flag)" \
  --label "type:task" \
  --body "$(cat <<'EOF'
Demote the Composio integration from default-on to opt-in fallback.

Per the design spec [2026-05-24-google-native-and-composio-demotion-design.md](docs/superpowers/specs/2026-05-24-google-native-and-composio-demotion-design.md):

- Add `ENABLE_COMPOSIO_PROVIDERS` env flag (default `false`).
- Rename the Composio-backed Microsoft/Google slugs to `microsoft-composio` and `google-composio`.
- Native `microsoft` and native `google` stay in the default registry. Composio entries register only when the flag is on.
- Preserve the uncommitted Composio integration work in the local tree by committing it under the new flag, not discarding it.
- Update README, the Composio spec status, and service-auth-flow.md to reflect opt-in semantics.

Plan: [docs/superpowers/plans/2026-05-24-composio-demotion-and-cleanup.md](docs/superpowers/plans/2026-05-24-composio-demotion-and-cleanup.md)
EOF
)"
```

Expected output: a GitHub issue URL ending in `/issues/N`. Capture the issue number `N` for the branch name below.

- [ ] **Step 2: Create the branch (issue-number from Step 1)**

Replace `<N>` with the issue number returned by Step 1.

Run:

```bash
git checkout main
git fetch origin
git stash push --include-untracked -m "WIP: composio integration pre-demotion"
git reset --hard origin/main
git checkout -b task/<N>-composio-demotion
```

Expected: clean working tree on a new branch derived from origin/main (which has the Pipedrive scaffold at `471848b`). The stash preserves the uncommitted work for cherry-pick reference.

### Task 0.2: Restore needed Composio files from stash into the branch

The uncommitted Composio code is required to land under the new gates. Restore the files but not the slug-flipped registry/route changes — those will be rewritten in later tasks to match the demoted architecture.

- [ ] **Step 1: Restore the new Composio directory files (untracked in stash)**

Run:

```bash
git checkout stash@{0} -- \
  src/providers/composio/binding-store.ts \
  src/providers/composio/factory.ts \
  src/providers/composio/service.ts \
  src/providers/composio/types.ts \
  test/composio-provider.test.ts \
  docs/superpowers/specs/2026-05-23-composio-provider-design.md
```

Expected: those files appear staged in the working tree. The slug-flip and route changes from the stash stay in the stash — we do NOT restore the modifications to `defaults.ts`, `http.ts`, `mcp/server.ts`, `cli.ts`, `config.ts`, `.env.example`, `README.md`, `docs/service-auth-flow.md`, `package.json`, `package-lock.json` here. Those will be re-created in later tasks against the demoted architecture.

- [ ] **Step 2: Restore the `@composio/core` dependency in package.json**

Run:

```bash
git checkout stash@{0} -- package.json package-lock.json
```

Expected: `package.json` now includes `@composio/core` in `dependencies`. Run `npm install` to verify the lockfile is in sync.

Run:

```bash
npm install
```

Expected: completes without errors and `node_modules/@composio/` exists.

- [ ] **Step 3: Verify intermediate working-tree state**

Run:

```bash
git status --short
```

Expected output (file order may vary):

```
A  docs/superpowers/specs/2026-05-23-composio-provider-design.md
A  package.json
A  package-lock.json
A  src/providers/composio/binding-store.ts
A  src/providers/composio/factory.ts
A  src/providers/composio/service.ts
A  src/providers/composio/types.ts
A  test/composio-provider.test.ts
```

No modifications to `cli.ts`, `config.ts`, `http.ts`, `mcp/server.ts`, `defaults.ts`, or `.env.example` yet — those happen in Phases 1–5.

- [ ] **Step 4: Initial commit of restored composio code (still uses old slugs — that's fine, we adapt in next phases)**

Run:

```bash
git add docs/superpowers/specs/2026-05-23-composio-provider-design.md \
  package.json package-lock.json \
  src/providers/composio/binding-store.ts \
  src/providers/composio/factory.ts \
  src/providers/composio/service.ts \
  src/providers/composio/types.ts \
  test/composio-provider.test.ts
git commit -m "chore(composio): restore composio scaffold files from prior branch"
```

Expected: one commit. The restored scaffold still references the old `microsoft`/`google` slugs internally — that's intentional; the rename happens in Phase 2.

---

## Phase 1: Add the env flag to config

### Task 1.1: Add ENABLE_COMPOSIO_PROVIDERS to config schema (TDD)

**Files:**
- Test: `test/config.test.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig — ENABLE_COMPOSIO_PROVIDERS flag", () => {
  it("defaults enableComposioProviders to false when env var is unset", () => {
    const config = loadConfig({
      API_BASE_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "example.com"
    });
    expect(config.enableComposioProviders).toBe(false);
  });

  it("parses true values", () => {
    for (const value of ["1", "true", "yes", "on", "TRUE"]) {
      const config = loadConfig({
        API_BASE_URL: "http://localhost:3000",
        ALLOWED_EMAIL_DOMAINS: "example.com",
        ENABLE_COMPOSIO_PROVIDERS: value
      });
      expect(config.enableComposioProviders, `value=${value}`).toBe(true);
    }
  });

  it("parses false values", () => {
    for (const value of ["0", "false", "no", "off", "FALSE"]) {
      const config = loadConfig({
        API_BASE_URL: "http://localhost:3000",
        ALLOWED_EMAIL_DOMAINS: "example.com",
        ENABLE_COMPOSIO_PROVIDERS: value
      });
      expect(config.enableComposioProviders, `value=${value}`).toBe(false);
    }
  });

  it("throws on unparseable values", () => {
    expect(() => loadConfig({
      API_BASE_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "example.com",
      ENABLE_COMPOSIO_PROVIDERS: "maybe"
    })).toThrow(/Expected boolean/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run test/config.test.ts -t "ENABLE_COMPOSIO_PROVIDERS flag"
```

Expected: FAIL — `enableComposioProviders` does not exist on the config object.

- [ ] **Step 3: Add the flag to config schema and loader**

Edit `src/config.ts`. After `apiBearerTokens: z.array(z.string().min(32)),` add:

```ts
enableComposioProviders: z.boolean(),
```

In `loadConfig`, change the returned object's beginning (right after `apiBearerTokens: splitCsv(env.API_BEARER_TOKENS ?? ""),`) to add:

```ts
enableComposioProviders: parseBoolean(env.ENABLE_COMPOSIO_PROVIDERS, false),
```

At the bottom of the file, add the helper (it does not exist yet on origin/main):

```ts
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Expected boolean value, received: ${value}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run test/config.test.ts -t "ENABLE_COMPOSIO_PROVIDERS flag"
```

Expected: all four tests PASS.

- [ ] **Step 5: Run full config test suite to ensure no regressions**

Run:

```bash
npx vitest run test/config.test.ts
```

Expected: all pre-existing config tests PASS plus the four new ones.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): add ENABLE_COMPOSIO_PROVIDERS env flag (default false)"
```

### Task 1.2: Add Composio config block conditional on the flag

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/config.test.ts`:

```ts
describe("loadConfig — composio block", () => {
  it("does not parse composio config when flag is off", () => {
    const config = loadConfig({
      API_BASE_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "example.com"
    });
    expect(config.composio).toBeUndefined();
  });

  it("parses composio config when flag is on", () => {
    const config = loadConfig({
      API_BASE_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "example.com",
      ENABLE_COMPOSIO_PROVIDERS: "true",
      COMPOSIO_API_KEY: "ck_test",
      COMPOSIO_CLIENT_SLUG: "test-client"
    });
    expect(config.composio).toBeDefined();
    expect(config.composio?.apiKey).toBe("ck_test");
    expect(config.composio?.clientSlug).toBe("test-client");
    expect(config.composio?.bindingStorePath).toBe("./data/composio-bindings.json");
    expect(config.composio?.providers.microsoft.toolkits).toEqual(["outlook", "calendar", "onedrive"]);
    expect(config.composio?.providers.google.toolkits).toEqual(["gmail", "googlecalendar", "googledrive"]);
    expect(config.composio?.authConfigs).toEqual({});
  });

  it("rejects auth config map values that are not non-empty strings", () => {
    expect(() => loadConfig({
      API_BASE_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "example.com",
      ENABLE_COMPOSIO_PROVIDERS: "true",
      COMPOSIO_AUTH_CONFIGS_JSON: '{"microsoft-composio": ""}'
    })).toThrow(/non-empty string auth config id/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run test/config.test.ts -t "composio block"
```

Expected: FAIL on the second case — `config.composio` does not exist yet.

- [ ] **Step 3: Add the composio config block (conditional)**

Edit `src/config.ts`. Add to the imports if missing:

```ts
import { z } from "zod";
```

Add the composio config shape to the schema. After the `microsoft` block, add:

```ts
composio: z.object({
  apiKey: z.string().min(1).optional(),
  bindingStorePath: z.string().min(1),
  clientSlug: z.string().min(1),
  authConfigs: z.record(z.string().min(1)),
  providers: z.object({
    microsoft: z.object({
      toolkits: z.array(z.string().min(1)).min(1),
      primaryToolkit: z.string().min(1)
    }),
    google: z.object({
      toolkits: z.array(z.string().min(1)).min(1),
      primaryToolkit: z.string().min(1)
    })
  })
}).optional(),
```

In `loadConfig`, after `const microsoftTenantId = optionalString(env.MICROSOFT_TENANT_ID);` add:

```ts
const enableComposio = parseBoolean(env.ENABLE_COMPOSIO_PROVIDERS, false);
const microsoftToolkits = splitCsv(env.COMPOSIO_MICROSOFT_TOOLKITS ?? "outlook,calendar,onedrive");
const googleToolkits = splitCsv(env.COMPOSIO_GOOGLE_TOOLKITS ?? "gmail,googlecalendar,googledrive");
```

Change `enableComposioProviders: parseBoolean(env.ENABLE_COMPOSIO_PROVIDERS, false),` (from Task 1.1) to `enableComposioProviders: enableComposio,` (use the local).

After `apiBearerTokens: splitCsv(env.API_BEARER_TOKENS ?? ""),` (and the `enableComposioProviders` line), add:

```ts
composio: enableComposio ? {
  apiKey: optionalString(env.COMPOSIO_API_KEY),
  bindingStorePath: env.COMPOSIO_BINDING_STORE_PATH ?? "./data/composio-bindings.json",
  clientSlug: optionalString(env.COMPOSIO_CLIENT_SLUG) ?? "local",
  authConfigs: parseJsonRecord(env.COMPOSIO_AUTH_CONFIGS_JSON ?? "{}"),
  providers: {
    microsoft: {
      toolkits: microsoftToolkits,
      primaryToolkit: optionalString(env.COMPOSIO_MICROSOFT_PRIMARY_TOOLKIT) ?? microsoftToolkits[0]
    },
    google: {
      toolkits: googleToolkits,
      primaryToolkit: optionalString(env.COMPOSIO_GOOGLE_PRIMARY_TOOLKIT) ?? googleToolkits[0]
    }
  }
} : undefined,
```

Add the `parseJsonRecord` helper at the bottom of the file:

```ts
function parseJsonRecord(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object for auth config mapping.");
  }
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed)) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new Error(`Expected non-empty string auth config id for toolkit: ${key}`);
    }
    output[key.trim()] = raw.trim();
  }
  return output;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run test/config.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): add optional composio block gated by ENABLE_COMPOSIO_PROVIDERS"
```

---

## Phase 2: Rename Composio slugs

### Task 2.1: Update Composio types to use renamed slugs

**Files:**
- Modify: `src/providers/composio/types.ts`

- [ ] **Step 1: Inspect current slug declarations**

Run:

```bash
grep -n "\"microsoft\"\|\"google\"" src/providers/composio/types.ts
```

The file currently uses `"microsoft" | "google"` as the `ComposioGatewayProvider` discriminator and as keys in the `AppConfig["composio"]["providers"]` shape.

- [ ] **Step 2: Rewrite `ComposioGatewayProvider` to use renamed slugs**

Edit `src/providers/composio/types.ts`. Locate:

```ts
export type ComposioGatewayProvider = "microsoft" | "google";
```

Replace with:

```ts
export type ComposioGatewayProvider = "microsoft-composio" | "google-composio";

export const COMPOSIO_TOOLKIT_BY_SLUG: Record<ComposioGatewayProvider, "microsoft" | "google"> = {
  "microsoft-composio": "microsoft",
  "google-composio": "google"
};
```

The new map preserves the upstream toolkit identifier (which Composio's API expects as `microsoft` / `google` per the toolkit slugs we verified earlier in the gateway-genvest investigation). All other internal slug references in the file should already be parameterised on `ComposioGatewayProvider`; verify with:

```bash
grep -n "ComposioGatewayProvider" src/providers/composio/types.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/composio/types.ts
git commit -m "refactor(composio): rename provider slugs to microsoft-composio / google-composio"
```

### Task 2.2: Update Composio service to map renamed slug → Composio toolkit name

**Files:**
- Modify: `src/providers/composio/service.ts`

- [ ] **Step 1: Inspect how the service constructs Composio requests**

Run:

```bash
grep -n "toolkit\|provider\|ComposioGatewayProvider" src/providers/composio/service.ts | head -30
```

The service currently passes `provider` directly as the toolkit. After Task 2.1 that would send `"microsoft-composio"` to Composio's API, which it doesn't recognise. The service must translate the gateway slug to the upstream toolkit name.

- [ ] **Step 2: Add translation at the call sites that hit the Composio API**

Edit `src/providers/composio/service.ts`. Add to the imports at the top:

```ts
import { COMPOSIO_TOOLKIT_BY_SLUG } from "./types.js";
```

Find every line that passes `provider` (the gateway slug) into a Composio API call (search for `toolkit:` or `session.authorize` or similar). For each such line, replace `provider` with `COMPOSIO_TOOLKIT_BY_SLUG[provider]`.

If the service has a `providerConfig.toolkits` lookup that currently does `this.options.config.providers[provider]`, change it to:

```ts
const toolkitKey = COMPOSIO_TOOLKIT_BY_SLUG[provider];
this.options.config.providers[toolkitKey]
```

- [ ] **Step 3: Run composio tests to verify the rename propagated**

Run:

```bash
npx vitest run test/composio-provider.test.ts
```

Expected: tests likely fail because the test file still references `"microsoft"` / `"google"` as gateway slugs. That is fixed in Task 2.3. For now, the failure should be about slug values, not about runtime errors. If runtime errors appear (e.g. `Cannot read properties of undefined`), the slug→toolkit translation in this task is incomplete — re-inspect and fix.

- [ ] **Step 4: Commit**

```bash
git add src/providers/composio/service.ts
git commit -m "refactor(composio): translate renamed slug to upstream toolkit name at API boundary"
```

### Task 2.3: Update composio-provider tests to use renamed slugs

**Files:**
- Modify: `test/composio-provider.test.ts`

- [ ] **Step 1: Read the test file**

Run:

```bash
cat test/composio-provider.test.ts | head -80
```

The test uses `"microsoft"` and `"google"` as gateway slugs. Update each occurrence to `"microsoft-composio"` and `"google-composio"`.

- [ ] **Step 2: Apply the rename**

Run:

```bash
sed -i.bak \
  -e 's/"microsoft"/"microsoft-composio"/g' \
  -e 's/"google"/"google-composio"/g' \
  test/composio-provider.test.ts
rm test/composio-provider.test.ts.bak
```

⚠️ Caveat: if the test contains references to the upstream toolkit name `"microsoft"` (not the gateway slug), the global sed will incorrectly rewrite those too. After running the sed, manually inspect lines that mention `toolkit`, `outlook`, `calendar`, `gmail`, or `googlecalendar` to ensure the upstream toolkit identifier (`"microsoft"` or `"google"`) is preserved in any place that hits Composio's API mock. Restore those manually if needed.

Run:

```bash
grep -n '"microsoft-composio"\|"google-composio"' test/composio-provider.test.ts | head -20
```

Confirm both new slugs appear.

- [ ] **Step 3: Run the test file**

Run:

```bash
npx vitest run test/composio-provider.test.ts
```

Expected: tests PASS, exercising the Composio service against the renamed slugs.

- [ ] **Step 4: Commit**

```bash
git add test/composio-provider.test.ts
git commit -m "test(composio): use renamed microsoft-composio/google-composio slugs"
```

---

## Phase 3: Restore native defaults; conditionally register Composio

### Task 3.1: Rewrite providers/defaults.ts for native-default architecture

**Files:**
- Modify: `src/providers/defaults.ts`
- Test: `test/providers.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/providers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { providersFromConfig, MICROSOFT_PROVIDER, GOOGLE_PROVIDER, MICROSOFT_COMPOSIO_PROVIDER, GOOGLE_COMPOSIO_PROVIDER } from "../src/providers/defaults.js";

describe("providersFromConfig — native-default architecture", () => {
  it("registers native microsoft when listed in enabledProviders", () => {
    const result = providersFromConfig({
      enabledProviders: ["microsoft"],
      enableComposioProviders: false
    });
    expect(result).toEqual([MICROSOFT_PROVIDER]);
  });

  it("registers native google when listed in enabledProviders", () => {
    const result = providersFromConfig({
      enabledProviders: ["google"],
      enableComposioProviders: false
    });
    expect(result).toEqual([GOOGLE_PROVIDER]);
  });

  it("refuses microsoft-composio slug when ENABLE_COMPOSIO_PROVIDERS is off", () => {
    expect(() => providersFromConfig({
      enabledProviders: ["microsoft-composio"],
      enableComposioProviders: false
    })).toThrow(/composio.*disabled|unknown enabled provider/i);
  });

  it("registers microsoft-composio when flag is on and slug is listed", () => {
    const result = providersFromConfig({
      enabledProviders: ["microsoft-composio"],
      enableComposioProviders: true
    });
    expect(result).toEqual([MICROSOFT_COMPOSIO_PROVIDER]);
  });

  it("registers a mix of native and composio entries with flag on", () => {
    const result = providersFromConfig({
      enabledProviders: ["microsoft", "google", "microsoft-composio", "google-composio"],
      enableComposioProviders: true
    });
    expect(result.map((p) => p.slug)).toEqual([
      "microsoft",
      "google",
      "microsoft-composio",
      "google-composio"
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run test/providers.test.ts -t "native-default architecture"
```

Expected: FAIL — most exports do not exist; `providersFromConfig` does not accept the new argument shape.

- [ ] **Step 3: Rewrite `src/providers/defaults.ts`**

Replace the entire file contents:

```ts
import type { GatewayConfig } from "../config.js";
import type { GatewayProviderDefinition } from "./types.js";

export const MICROSOFT_PROVIDER: GatewayProviderDefinition = {
  slug: "microsoft",
  name: "Microsoft 365",
  description: "Microsoft Graph access for Outlook mail, Calendar, and selected Graph operations.",
  auth: "oauth",
  mcpPath: "/mcp/microsoft",
  scopesSummary: "Delegated Microsoft Graph access for the connected Microsoft login.",
  backend: "native"
};

export const GOOGLE_PROVIDER: GatewayProviderDefinition = {
  slug: "google",
  name: "Google Workspace",
  description: "Google Workspace access for Gmail, Calendar, and selected Google API operations.",
  auth: "oauth",
  mcpPath: "/mcp/google",
  scopesSummary: "Delegated Google Workspace access for the connected Google login.",
  backend: "native"
};

export const PIPEDRIVE_PROVIDER: GatewayProviderDefinition = {
  slug: "pipedrive",
  name: "Pipedrive CRM",
  description: "Pipedrive CRM access for deals, persons, organizations, and activities.",
  auth: "oauth",
  mcpPath: "/mcp/pipedrive",
  scopesSummary: "Delegated Pipedrive access for the connected Pipedrive user.",
  backend: "native"
};

export const MICROSOFT_COMPOSIO_PROVIDER: GatewayProviderDefinition = {
  slug: "microsoft-composio",
  name: "Microsoft 365 (Composio)",
  description: "Composio-backed Microsoft 365 access for deployments that opt in to Composio for upstream identity.",
  auth: "oauth",
  mcpPath: "/mcp/microsoft-composio",
  scopesSummary: "Delegated Microsoft Graph access via Composio.",
  backend: "composio"
};

export const GOOGLE_COMPOSIO_PROVIDER: GatewayProviderDefinition = {
  slug: "google-composio",
  name: "Google Workspace (Composio)",
  description: "Composio-backed Google Workspace access for deployments that opt in to Composio for upstream identity.",
  auth: "oauth",
  mcpPath: "/mcp/google-composio",
  scopesSummary: "Delegated Google Workspace access via Composio.",
  backend: "composio"
};

const NATIVE_PROVIDERS = new Map<string, GatewayProviderDefinition>([
  [MICROSOFT_PROVIDER.slug, MICROSOFT_PROVIDER],
  [GOOGLE_PROVIDER.slug, GOOGLE_PROVIDER],
  [PIPEDRIVE_PROVIDER.slug, PIPEDRIVE_PROVIDER]
]);

const COMPOSIO_PROVIDERS = new Map<string, GatewayProviderDefinition>([
  [MICROSOFT_COMPOSIO_PROVIDER.slug, MICROSOFT_COMPOSIO_PROVIDER],
  [GOOGLE_COMPOSIO_PROVIDER.slug, GOOGLE_COMPOSIO_PROVIDER]
]);

export function providersFromConfig(
  // enableComposioProviders is optional so callers that build partial config
  // (e.g. older tests) still type-check; an undefined value behaves as `false`.
  config: Pick<GatewayConfig, "enabledProviders"> & { enableComposioProviders?: boolean }
): GatewayProviderDefinition[] {
  const composioEnabled = config.enableComposioProviders === true;
  return config.enabledProviders.map((rawSlug) => {
    const slug = rawSlug.trim().toLowerCase();
    const native = NATIVE_PROVIDERS.get(slug);
    if (native) {
      return { ...native };
    }
    const composio = COMPOSIO_PROVIDERS.get(slug);
    if (composio) {
      if (!composioEnabled) {
        throw new Error(`Composio providers are disabled; cannot enable: ${slug}. Set ENABLE_COMPOSIO_PROVIDERS=true.`);
      }
      return { ...composio };
    }
    throw new Error(`Unknown enabled provider: ${rawSlug}`);
  });
}
```

- [ ] **Step 4: Run all tests in providers.test.ts**

Run:

```bash
npx vitest run test/providers.test.ts
```

Expected: all tests pass, including any pre-existing tests that referenced `MICROSOFT_PROVIDER` (signature is unchanged for the existing export).

- [ ] **Step 5: Commit**

```bash
git add src/providers/defaults.ts test/providers.test.ts
git commit -m "feat(providers): native microsoft+google as defaults; composio entries opt-in"
```

---

## Phase 4: HTTP routes

### Task 4.1: Microsoft native uses /auth/microsoft/* (no -native suffix)

**Files:**
- Modify: `src/http.ts`
- Test: `test/http.test.ts`

The uncommitted stash renamed Microsoft routes to `/auth/microsoft-native/*` to coexist with Composio-backed `microsoft`. With Composio renamed to `microsoft-composio`, Microsoft native reclaims the plain `/auth/microsoft/*` paths.

- [ ] **Step 1: Write failing tests**

Append to `test/http.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createHttpApp } from "../src/http.js";
import { loadConfig } from "../src/config.js";

describe("HTTP — native Microsoft routes claim /auth/microsoft/*", () => {
  const baseEnv = {
    API_BASE_URL: "http://localhost:3000",
    ALLOWED_EMAIL_DOMAINS: "example.com",
    ENABLED_PROVIDERS: "microsoft",
    MICROSOFT_CLIENT_ID: "test-client",
    MICROSOFT_CLIENT_SECRET: "test-secret",
    MICROSOFT_TENANT_ID: "11111111-1111-1111-1111-111111111111",
    MICROSOFT_TOKEN_STORE_KEY: Buffer.from("0".repeat(32)).toString("base64")
  };

  it("exposes /auth/microsoft/connect", async () => {
    const app = createHttpApp({ config: loadConfig(baseEnv) });
    const res = await request(app).get("/auth/microsoft/connect?actor=test@example.com");
    expect(res.status).not.toBe(404);
  });

  it("does not expose /auth/microsoft-native/connect anymore", async () => {
    const app = createHttpApp({ config: loadConfig(baseEnv) });
    const res = await request(app).get("/auth/microsoft-native/connect?actor=test@example.com");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run test/http.test.ts -t "native Microsoft routes claim"
```

Expected: depending on origin/main state, `/auth/microsoft/connect` may already exist (no microsoft-native rename has been merged yet). If it already passes, that just means we don't need to revert anything — the route was never renamed. Note the result.

- [ ] **Step 3: If `/auth/microsoft-native/*` routes exist in `src/http.ts`, rename them**

Run:

```bash
grep -n "microsoft-native" src/http.ts
```

If any matches: edit `src/http.ts` and replace every occurrence of `microsoft-native` with `microsoft` in the route paths only (not in any internal slug references). After:

```bash
grep -n "microsoft-native" src/http.ts
```

should return no matches.

If no matches existed, skip this step — origin/main already has the correct paths.

- [ ] **Step 4: Run the test again**

Run:

```bash
npx vitest run test/http.test.ts -t "native Microsoft routes claim"
```

Expected: PASS.

- [ ] **Step 5: Commit (only if changes were made; otherwise skip)**

```bash
git add src/http.ts test/http.test.ts
git commit -m "fix(http): native microsoft routes use /auth/microsoft/* (no -native suffix)"
```

### Task 4.2: Composio routes registered conditionally under renamed slugs

**Files:**
- Modify: `src/http.ts`
- Test: `test/http.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/http.test.ts`:

```ts
describe("HTTP — composio routes are flag-gated", () => {
  const composioEnv = {
    API_BASE_URL: "http://localhost:3000",
    ALLOWED_EMAIL_DOMAINS: "example.com",
    ENABLED_PROVIDERS: "microsoft,microsoft-composio",
    ENABLE_COMPOSIO_PROVIDERS: "true",
    COMPOSIO_API_KEY: "ck_test",
    MICROSOFT_CLIENT_ID: "test-client",
    MICROSOFT_CLIENT_SECRET: "test-secret",
    MICROSOFT_TENANT_ID: "11111111-1111-1111-1111-111111111111",
    MICROSOFT_TOKEN_STORE_KEY: Buffer.from("0".repeat(32)).toString("base64")
  };

  it("exposes /providers/microsoft-composio/connect when flag is on", async () => {
    const app = createHttpApp({ config: loadConfig(composioEnv) });
    const res = await request(app).get("/providers/microsoft-composio/connect?actor=test@example.com&actorId=p1");
    expect(res.status).not.toBe(404);
  });

  it("does NOT expose /providers/microsoft-composio/connect when flag is off", async () => {
    const offEnv = { ...composioEnv, ENABLE_COMPOSIO_PROVIDERS: "false", ENABLED_PROVIDERS: "microsoft" };
    const app = createHttpApp({ config: loadConfig(offEnv) });
    const res = await request(app).get("/providers/microsoft-composio/connect?actor=test@example.com&actorId=p1");
    expect(res.status).toBe(404);
  });

  it("rejects /providers/microsoft (the native slug) on the generic provider route", async () => {
    const app = createHttpApp({ config: loadConfig(composioEnv) });
    const res = await request(app).get("/providers/microsoft/connect?actor=test@example.com&actorId=p1");
    expect([400, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run test/http.test.ts -t "composio routes are flag-gated"
```

Expected: FAIL — generic Composio routes either don't exist yet (after restoring uncommitted code) or aren't gated.

- [ ] **Step 3: Update `src/http.ts` to register Composio routes conditionally**

Edit `src/http.ts`. Locate the Composio block restored from the stash (it registers `/providers/:provider/connect`, `/providers/:provider/status`, `/providers/:provider/mcp-url`).

Wrap the entire Composio block in a conditional:

```ts
if (options.config.enableComposioProviders) {
  const composioProvider = options.composioProvider ?? createComposioProviderService(options.config);

  app.get("/providers/:provider/connect", async (request, response, next) => {
    try {
      const providerSlug = parseComposioSlug(request.params.provider);
      response.json(await composioProvider.createConnectUrl(providerSlug, {
        actorId: stringQuery(request.query.actorId),
        actorEmail: stringQuery(request.query.actor) ?? ""
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/providers/:provider/status", async (request, response, next) => {
    try {
      const providerSlug = parseComposioSlug(request.params.provider);
      const actor = stringQuery(request.query.actor);
      if (!actor) {
        response.status(400).json({ error: "actor query parameter is required" });
        return;
      }
      response.json(await composioProvider.status(providerSlug, actor));
    } catch (error) {
      next(error);
    }
  });

  app.get("/providers/:provider/mcp-url", async (request, response, next) => {
    try {
      const providerSlug = parseComposioSlug(request.params.provider);
      const actor = stringQuery(request.query.actor);
      if (!actor) {
        response.status(400).json({ error: "actor query parameter is required" });
        return;
      }
      response.json(await composioProvider.mcpUrl(providerSlug, actor));
    } catch (error) {
      next(error);
    }
  });
}
```

Add the slug parser near the top of the file:

```ts
function parseComposioSlug(value: string): "microsoft-composio" | "google-composio" {
  if (value === "microsoft-composio" || value === "google-composio") return value;
  const err = new Error(`Unknown composio provider slug: ${value}`);
  (err as Error & { status?: number }).status = 400;
  throw err;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run test/http.test.ts -t "composio routes are flag-gated"
```

Expected: PASS.

- [ ] **Step 5: Run all http tests**

```bash
npx vitest run test/http.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/http.ts test/http.test.ts
git commit -m "feat(http): composio /providers/:slug/* routes gated by ENABLE_COMPOSIO_PROVIDERS"
```

---

## Phase 5: MCP server

### Task 5.1: Gate Composio MCP tools behind the flag

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/mcp-server.test.ts`:

```ts
describe("MCP — composio tools are flag-gated", () => {
  it("does not register provider_connect/status/mcp_url when flag is off", async () => {
    const config = loadConfig({
      API_BASE_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "example.com",
      ENABLED_PROVIDERS: "microsoft"
    });
    const server = createTestMcpServer();
    createGatewayMcpServer(server, { config, providerRegistry: createProviderRegistry([]) });
    expect(server.toolNames()).not.toContain("provider_connect");
    expect(server.toolNames()).not.toContain("provider_status");
    expect(server.toolNames()).not.toContain("provider_mcp_url");
  });

  it("registers provider_connect/status/mcp_url when flag is on", async () => {
    const config = loadConfig({
      API_BASE_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "example.com",
      ENABLED_PROVIDERS: "microsoft,microsoft-composio",
      ENABLE_COMPOSIO_PROVIDERS: "true",
      COMPOSIO_API_KEY: "ck_test"
    });
    const server = createTestMcpServer();
    createGatewayMcpServer(server, { config, providerRegistry: createProviderRegistry([]) });
    expect(server.toolNames()).toContain("provider_connect");
    expect(server.toolNames()).toContain("provider_status");
    expect(server.toolNames()).toContain("provider_mcp_url");
  });
});
```

If `test/mcp-server.test.ts` doesn't already define `createTestMcpServer()` and `toolNames()` helpers, add them at the top:

```ts
function createTestMcpServer() {
  const tools = new Map<string, unknown>();
  return {
    tool: (name: string, ..._rest: unknown[]) => { tools.set(name, true); },
    toolNames: () => Array.from(tools.keys())
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run test/mcp-server.test.ts -t "composio tools are flag-gated"
```

Expected: FAIL — either tools always register or never register.

- [ ] **Step 3: Edit `src/mcp/server.ts`**

Find the Composio tool registration block (restored from stash). The block registers `provider_connect`, `provider_status`, `provider_mcp_url` with `z.enum(["microsoft", "google"])`.

Update the enum to the renamed slugs:

```ts
{ provider: z.enum(["microsoft-composio", "google-composio"]) }
```

Wrap the entire Composio block in a conditional:

```ts
if (options.config.enableComposioProviders && options.composioProvider) {
  server.tool(
    "provider_connect",
    "Return a Composio provider connect URL for the authenticated gateway actor.",
    { provider: z.enum(["microsoft-composio", "google-composio"]) },
    async (input, extra) => {
      // ... existing handler body, unchanged
    }
  );
  // similar for provider_status and provider_mcp_url
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run test/mcp-server.test.ts -t "composio tools are flag-gated"
```

Expected: PASS.

- [ ] **Step 5: Run all mcp-server tests**

```bash
npx vitest run test/mcp-server.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts test/mcp-server.test.ts
git commit -m "feat(mcp): composio provider_* tools gated by ENABLE_COMPOSIO_PROVIDERS"
```

---

## Phase 6: CLI

### Task 6.1: Gate Composio CLI commands behind the flag

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/cli.test.ts`:

```ts
describe("CLI — composio commands are flag-gated", () => {
  it("does not advertise composio commands when flag is off", async () => {
    const env = { API_BASE_URL: "http://localhost:3000", ALLOWED_EMAIL_DOMAINS: "example.com" };
    const result = await runCli(["--help"], env);
    expect(result.stdout).not.toMatch(/provider connect/i);
  });

  it("advertises composio commands when flag is on", async () => {
    const env = {
      API_BASE_URL: "http://localhost:3000",
      ALLOWED_EMAIL_DOMAINS: "example.com",
      ENABLE_COMPOSIO_PROVIDERS: "true",
      COMPOSIO_API_KEY: "ck_test"
    };
    const result = await runCli(["--help"], env);
    expect(result.stdout).toMatch(/provider connect/i);
  });
});
```

(If `runCli()` helper does not exist in `test/cli.test.ts`, add the pattern used by existing CLI tests — typically a `spawnSync` against the built `dist/cli.js` or a programmatic call to the CLI's exported entry function.)

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run test/cli.test.ts -t "composio commands are flag-gated"
```

Expected: FAIL.

- [ ] **Step 3: Edit `src/cli.ts`**

Find the Composio command registration block (`provider connect`, `provider status`, `provider mcp-url` — restored from stash). Wrap it in a conditional that checks the loaded config:

```ts
if (config.enableComposioProviders) {
  program
    .command("provider")
    .description("Composio provider operations (opt-in)")
    // ...subcommands registered here...
    ;
}
```

Also update the slug enums or argument validators inside those subcommands to accept only `microsoft-composio` and `google-composio`, not `microsoft`/`google`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run test/cli.test.ts -t "composio commands are flag-gated"
```

Expected: PASS.

- [ ] **Step 5: Run full CLI test suite**

```bash
npx vitest run test/cli.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts test/cli.test.ts
git commit -m "feat(cli): composio commands registered only when ENABLE_COMPOSIO_PROVIDERS=true"
```

---

## Phase 7: .env.example

### Task 7.1: Update .env.example to native defaults + clearly mark opt-in Composio block

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace the .env.example contents with native-default scaffolding**

Replace the entire file:

```env
PORT=3000
API_BASE_URL=http://localhost:3000
ALLOWED_EMAIL_DOMAINS=example.com
ENABLED_PROVIDERS=microsoft,google,pipedrive
TOKEN_STORE_PATH=./data/tokens.json
AUDIT_LOG_PATH=./data/audit.jsonl
API_BEARER_TOKENS=

# Microsoft 365 (native OAuth via Microsoft Graph)
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
MICROSOFT_ALLOWED_TENANTS=
MICROSOFT_ALLOWED_DOMAINS=example.com
MICROSOFT_TOKEN_STORE_PATH=./data/microsoft-tokens.json
MICROSOFT_TOKEN_STORE_KEY=

# Google Workspace (native OAuth via Google APIs) — implementation lands in Plan 3 (Google native)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
GOOGLE_ALLOWED_DOMAINS=example.com
GOOGLE_TOKEN_STORE_PATH=./data/google-tokens.json
GOOGLE_TOKEN_STORE_KEY=

# Pipedrive CRM (native OAuth)
# (existing pipedrive env vars preserved from origin/main; see top of file before edits)

# --- Composio (opt-in fallback) ---
# Enable Composio-backed providers by setting ENABLE_COMPOSIO_PROVIDERS=true and
# adding microsoft-composio / google-composio to ENABLED_PROVIDERS.
ENABLE_COMPOSIO_PROVIDERS=false
COMPOSIO_API_KEY=
COMPOSIO_BINDING_STORE_PATH=./data/composio-bindings.json
COMPOSIO_CLIENT_SLUG=local
COMPOSIO_MICROSOFT_TOOLKITS=outlook,calendar,onedrive
COMPOSIO_GOOGLE_TOOLKITS=gmail,googlecalendar,googledrive
COMPOSIO_AUTH_CONFIGS_JSON={}
```

Important: preserve any existing Pipedrive env vars from origin/main (they were added by commit `471848b`). Run `git show origin/main:.env.example` before writing to confirm the Pipedrive section is captured correctly.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): .env.example reflects native defaults; composio opt-in section"
```

---

## Phase 8: Docs

### Task 8.1: Mark the older Composio spec as superseded

**Files:**
- Modify: `docs/superpowers/specs/2026-05-23-composio-provider-design.md`

- [ ] **Step 1: Insert the supersession header at the top of the file**

Add immediately after the H1 title:

```markdown
> **Status:** Opt-in fallback. Superseded as the default by [2026-05-24-google-native-and-composio-demotion-design.md](./2026-05-24-google-native-and-composio-demotion-design.md). The architecture below remains accurate for deployments that set `ENABLE_COMPOSIO_PROVIDERS=true`; the gateway slugs have been renamed from `microsoft` / `google` to `microsoft-composio` / `google-composio`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-23-composio-provider-design.md
git commit -m "docs(composio): mark composio provider design as superseded default"
```

### Task 8.2: Rewrite the README Composio-Backed Providers section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Locate the existing Composio section**

Run:

```bash
grep -n "Composio" README.md
```

Identify the section heading and its extent.

- [ ] **Step 2: Replace the section with opt-in framing**

Replace the section with:

```markdown
## Composio-Backed Providers (Opt-In)

Composio support is retained as an opt-in fallback for deployments that prefer Composio-managed upstream identity instead of native gateway OAuth.

To enable, set the following in the wrapper's `.env`:

```env
ENABLE_COMPOSIO_PROVIDERS=true
ENABLED_PROVIDERS=microsoft,google,microsoft-composio,google-composio
COMPOSIO_API_KEY=ck_...
COMPOSIO_AUTH_CONFIGS_JSON={"microsoft-composio":"ac_...","google-composio":"ac_..."}
```

Composio-backed providers register under the renamed slugs `microsoft-composio` and `google-composio` to keep the native `microsoft` and `google` slugs available for the gateway's own OAuth flow.

See [docs/superpowers/specs/2026-05-23-composio-provider-design.md](docs/superpowers/specs/2026-05-23-composio-provider-design.md) for the full Composio architecture and [docs/superpowers/specs/2026-05-24-google-native-and-composio-demotion-design.md](docs/superpowers/specs/2026-05-24-google-native-and-composio-demotion-design.md) for the rationale behind the demotion.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): rewrite composio section to opt-in framing with renamed slugs"
```

### Task 8.3: Update service-auth-flow.md to note Composio opt-in

**Files:**
- Modify: `docs/service-auth-flow.md`

- [ ] **Step 1: Locate any Composio reference**

Run:

```bash
grep -n -i "composio" docs/service-auth-flow.md
```

- [ ] **Step 2: Adjust references**

Any sentence stating Composio is the default upstream for Microsoft or Google should be reworded to: "Composio is available as an opt-in fallback under the renamed slugs `microsoft-composio` / `google-composio`; native Microsoft and Google providers are the defaults."

- [ ] **Step 3: Commit**

```bash
git add docs/service-auth-flow.md
git commit -m "docs(service-auth-flow): note composio is opt-in"
```

---

## Phase 9: Final validation, push, PR

### Task 9.1: Run full test suite

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: 0 failures. If anything fails, fix the failing test or implementation. Do not move to Step 2 until all tests pass.

- [ ] **Step 2: Type check**

Run:

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Lint**

Run (whichever the repo uses; check package.json scripts):

```bash
npm run lint 2>/dev/null || npx eslint src test
```

Expected: no errors. Warnings acceptable if pre-existing.

### Task 9.2: Push and open PR

- [ ] **Step 1: Push branch**

Run:

```bash
git push -u origin task/<N>-composio-demotion
```

- [ ] **Step 2: Open PR with proper Fixes link**

Replace `<N>` with the issue number from Task 0.1.

```bash
gh pr create --title "Task: demote Composio to opt-in (renamed slugs + env flag)" --body "$(cat <<'EOF'
## Summary

- Adds `ENABLE_COMPOSIO_PROVIDERS` env flag (default `false`).
- Renames Composio-backed Microsoft and Google slugs to `microsoft-composio` and `google-composio`.
- Restores native `microsoft` and native `google` as the default registry entries (`google` is a placeholder definition; full native implementation lands in a later plan).
- Native Microsoft routes reclaim `/auth/microsoft/*` (no `-native` suffix).
- Composio routes register under `/providers/:slug/*` only when the flag is on, restricted to the renamed slugs.
- Composio MCP tools (`provider_connect`, `provider_status`, `provider_mcp_url`) and CLI commands register only when the flag is on.
- Marks the older Composio spec as superseded; rewrites README Composio section as opt-in.
- Preserves the previously uncommitted Composio scaffold under the new flag; no Composio code deleted.

Fixes #<N>

## Test plan

- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` clean
- [ ] `ENABLE_COMPOSIO_PROVIDERS=false` and `ENABLED_PROVIDERS=microsoft,google,pipedrive` boots and reports the three native providers in `GET /providers`
- [ ] `ENABLE_COMPOSIO_PROVIDERS=true ENABLED_PROVIDERS=microsoft,microsoft-composio` boots, `GET /providers/microsoft-composio/connect?actor=...` returns a Composio URL
- [ ] `ENABLED_PROVIDERS=microsoft-composio` without the flag fails fast with a clear error message

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify Pipeline Core checks**

Wait ~30 seconds, then run:

```bash
gh pr checks $(gh pr view --json number -q .number)
```

Expected: `pipeline/branch-name`, `pipeline/issue-link`, and `pipeline/merge-gate` all green. If any are red, see [00_resources/skills/pipeline-workflow](../../../00_resources/skills/pipeline-workflow) (or read the failed check output) and fix.

- [ ] **Step 4: Report PR URL**

Print the PR URL with:

```bash
gh pr view --json url -q .url
```

Stop here. Plan 2 (Microsoft native completion) takes over once this PR merges and unblocks the shared registration files.
