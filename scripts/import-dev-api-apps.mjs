/**
 * Import Dev API registered apps from an operator manifest into gateway API Access.
 *
 * Usage:
 *   npm run build
 *   node scripts/import-dev-api-apps.mjs [--dry-run] [--rotate]
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

try {
  const { config } = await import("dotenv");
  config({ path: path.join(__dirname, "../.env") });
} catch {}

const MANIFEST_PATH = process.env.MANIFEST_PATH ?? "./config/dev-api-apps.manifest.json";
const STORE_PATH = process.env.GATEWAY_STORE_PATH ?? "./data/gateway.sqlite";
const ACTOR = "dev-api-importer";
const args = new Set(process.argv.slice(2));
const rotate = args.has("--rotate");
const dryRun = args.has("--dry-run");

let validateAppImportManifest;
let normalizeImportApps;
let GatewayAccessStore;
try {
  ({ validateAppImportManifest, normalizeImportApps } = await import("../dist/access/app-import.js"));
  ({ GatewayAccessStore } = await import("../dist/access/store.js"));
} catch {
  console.error("ERROR: run `npm run build` first — dist/access/app-import.js or dist/access/store.js not found");
  process.exit(1);
}

let manifest;
try {
  manifest = validateAppImportManifest(JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")));
} catch (error) {
  console.error(`ERROR: could not read valid manifest at ${MANIFEST_PATH}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const apps = normalizeImportApps(manifest, today);
const results = [];
const issued = [];

if (dryRun) {
  const existingClients = listExistingImportClientsReadOnly(STORE_PATH);
  for (const app of apps) {
    const existing = existingClients.find((client) => client.status === "active" && client.owner === `dev-api:${app.manifestKey}`);
    results.push({
      manifestKey: app.manifestKey,
      clientId: existing?.id ?? "-",
      keyId: "-",
      fingerprint: "-",
      action: existing === undefined ? "WOULD_CREATE" : rotate ? "WOULD_ROTATE" : "EXISTS"
    });
  }
} else {
  const store = new GatewayAccessStore(STORE_PATH);
  try {
    for (const app of apps) {
      const activeClients = store
        .listApiClients()
        .filter((client) => client.status === "active" && client.owner === `dev-api:${app.manifestKey}`);
      const existing = activeClients[0];

      if (existing === undefined) {
        const client = store.createClient({ ...app.client, owner: `dev-api:${app.manifestKey}` }, ACTOR);
        const created = store.createKey(client.id, { label: app.keyLabel }, ACTOR);
        results.push({
          manifestKey: app.manifestKey,
          clientId: client.id,
          keyId: created.key.id,
          fingerprint: created.key.fingerprint,
          action: "CREATED"
        });
        issued.push({ manifestKey: app.manifestKey, clientId: client.id, key: created.key, secret: created.secret });
        continue;
      }

      if (!rotate) {
        results.push({
          manifestKey: app.manifestKey,
          clientId: existing.id,
          keyId: "-",
          fingerprint: "-",
          action: "EXISTS"
        });
        continue;
      }

      const created = store.createKey(existing.id, { label: uniqueLabel(app.keyLabel, existing.keys) }, ACTOR);
      results.push({
        manifestKey: app.manifestKey,
        clientId: existing.id,
        keyId: created.key.id,
        fingerprint: created.key.fingerprint,
        action: "ROTATED"
      });
      issued.push({ manifestKey: app.manifestKey, clientId: existing.id, key: created.key, secret: created.secret });
    }
  } finally {
    store.close();
  }
}

console.log(`${dryRun ? "DRY RUN " : ""}Import plan from ${MANIFEST_PATH} into ${STORE_PATH}`);
console.table(results);

if (issued.length > 0) {
  console.log("\nCOPY THESE NOW — not re-fetchable:");
  for (const item of issued) {
    console.log(`${item.manifestKey} (${item.clientId}, ${item.key.label}, ${item.key.fingerprint}): ${item.secret}`);
  }
}

console.log("\nNext steps:");
console.log("  1. Send each app owner its gateway base URL and one-time bearer token.");
console.log("  2. Follow docs/runbooks/dev-api-app-swap.md for the cutover.");
console.log("  3. Re-run with --rotate only when issuing fresh overlap-window keys.");

function uniqueLabel(baseLabel, keys) {
  const activeLabels = new Set(keys.filter((key) => key.status === "active").map((key) => key.label));
  if (!activeLabels.has(baseLabel)) {
    return baseLabel;
  }
  let suffix = 2;
  while (activeLabels.has(`${baseLabel}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseLabel}-${suffix}`;
}

function listExistingImportClientsReadOnly(storePath) {
  if (!fs.existsSync(storePath)) {
    return [];
  }
  const Database = require("better-sqlite3");
  const db = new Database(storePath, { readonly: true, fileMustExist: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gateway_api_clients'")
      .get();
    if (table === undefined) {
      return [];
    }
    return db
      .prepare("SELECT id, owner, status FROM gateway_api_clients WHERE owner LIKE 'dev-api:%'")
      .all();
  } finally {
    db.close();
  }
}
