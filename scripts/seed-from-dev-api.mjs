/**
 * One-time import: pulls live brands/regions/connections from Haverford Dev API
 * and writes them into the gateway's SQLite overlay store.
 *
 * After running, switch ADMIN_DATA_SOURCE=fixture-overlay so the gateway
 * serves its own copy of the data with no Dev API dependency.
 *
 * Usage:
 *   node scripts/seed-from-dev-api.mjs
 *
 * Reads from: HAVERFORD_DEV_API_BASE_URL, HAVERFORD_DEV_API_CLIENT_ID,
 *             HAVERFORD_DEV_API_CLIENT_SECRET, GATEWAY_STORE_PATH
 * (loaded from .env via dotenv if present)
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env
try {
  const { config } = await import("dotenv");
  config({ path: path.join(__dirname, "../.env") });
} catch {}

const BASE_URL = process.env.HAVERFORD_DEV_API_BASE_URL;
const CLIENT_ID = process.env.HAVERFORD_DEV_API_CLIENT_ID;
const CLIENT_SECRET = process.env.HAVERFORD_DEV_API_CLIENT_SECRET;
const STORE_PATH = process.env.GATEWAY_STORE_PATH ?? "./data/gateway.sqlite";
const ACTOR = "seed-from-dev-api";

if (!BASE_URL || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("ERROR: set HAVERFORD_DEV_API_BASE_URL, HAVERFORD_DEV_API_CLIENT_ID, HAVERFORD_DEV_API_CLIENT_SECRET");
  process.exit(1);
}

// --- Fetch Dev API ---
console.log(`Fetching brands from ${BASE_URL}/api/internal/brands ...`);
const res = await fetch(`${BASE_URL}/api/internal/brands`, {
  headers: {
    "x-internal-client-id": CLIENT_ID,
    "x-internal-client-secret": CLIENT_SECRET,
  },
});
if (!res.ok) {
  console.error(`ERROR: Dev API returned ${res.status} ${await res.text()}`);
  process.exit(1);
}
const data = await res.json();
console.log(`  Got ${data.brands?.length ?? 0} brands`);

// --- Map via existing mapper ---
// Import compiled JS from dist (run `npm run build` first if needed)
let mapFn;
try {
  const mod = await import("../dist/admin/dev-api-mapper.js");
  mapFn = mod.mapDevApiBrandsToGatewayState;
} catch {
  console.error("ERROR: run `npm run build` first — dist/admin/dev-api-mapper.js not found");
  process.exit(1);
}

const state = mapFn(data);
console.log(`  Mapped: ${state.brands.length} brands, ${state.regions.length} regions, ${state.connections.length} connections`);

// --- Write to overlay store ---
const Database = require("better-sqlite3");
const fs = require("node:fs");

const storeDir = path.dirname(STORE_PATH);
if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir, { recursive: true });

const db = new Database(STORE_PATH);
db.pragma("foreign_keys = ON");

// Create tables (mirrors overlay-store.ts DDL)
db.exec(`
  CREATE TABLE IF NOT EXISTS gateway_brands (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gateway_regions (
    id TEXT PRIMARY KEY NOT NULL,
    brand_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    domain TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gateway_connections (
    id TEXT PRIMARY KEY NOT NULL,
    brand_id TEXT NOT NULL,
    region_id TEXT NOT NULL,
    connector_id TEXT NOT NULL,
    backend_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'needs_config',
    config_summary_json TEXT NOT NULL DEFAULT '{}',
    last_tested_at TEXT,
    last_used_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gateway_entity_overrides (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    source TEXT NOT NULL,
    patch_json TEXT NOT NULL DEFAULT '{}',
    source_fingerprint TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS gateway_audit_events (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    detail TEXT NOT NULL,
    actor TEXT NOT NULL,
    metadata_json TEXT,
    timestamp TEXT NOT NULL
  );
`);

const now = new Date().toISOString();

// Upsert brands
const upsertBrand = db.prepare(`
  INSERT INTO gateway_brands (id, name, slug, status, created_at, updated_at, updated_by)
  VALUES (@id, @name, @slug, @status, @createdAt, @updatedAt, @updatedBy)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, slug = excluded.slug, status = excluded.status,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by
`);

// Upsert regions
const upsertRegion = db.prepare(`
  INSERT INTO gateway_regions (id, brand_id, code, name, status, domain, created_at, updated_at, updated_by)
  VALUES (@id, @brandId, @code, @name, @status, @domain, @createdAt, @updatedAt, @updatedBy)
  ON CONFLICT(id) DO UPDATE SET
    brand_id = excluded.brand_id, code = excluded.code, name = excluded.name,
    status = excluded.status, domain = excluded.domain,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by
`);

// Upsert connections
const upsertConn = db.prepare(`
  INSERT INTO gateway_connections (id, brand_id, region_id, connector_id, backend_type, display_name, status, config_summary_json, last_tested_at, last_used_at, last_error, created_at, updated_at, updated_by)
  VALUES (@id, @brandId, @regionId, @connectorId, @backendType, @displayName, @status, @configSummaryJson, @lastTestedAt, @lastUsedAt, @lastError, @createdAt, @updatedAt, @updatedBy)
  ON CONFLICT(id) DO UPDATE SET
    brand_id = excluded.brand_id, region_id = excluded.region_id, connector_id = excluded.connector_id,
    backend_type = excluded.backend_type, display_name = excluded.display_name, status = excluded.status,
    config_summary_json = excluded.config_summary_json, last_tested_at = excluded.last_tested_at,
    last_used_at = excluded.last_used_at, last_error = excluded.last_error,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by
`);

const seedAll = db.transaction(() => {
  for (const brand of state.brands) {
    upsertBrand.run({ id: brand.id, name: brand.name, slug: brand.slug, status: brand.status, createdAt: now, updatedAt: now, updatedBy: ACTOR });
  }
  for (const region of state.regions) {
    upsertRegion.run({ id: region.id, brandId: region.brandId, code: region.code, name: region.name, status: region.status, domain: region.domain ?? null, createdAt: now, updatedAt: now, updatedBy: ACTOR });
  }
  for (const conn of state.connections) {
    upsertConn.run({
      id: conn.id, brandId: conn.brandId, regionId: conn.regionId, connectorId: conn.connectorId,
      backendType: conn.backendType, displayName: conn.displayName, status: conn.status,
      configSummaryJson: JSON.stringify(conn.configSummary ?? {}),
      lastTestedAt: conn.lastTestedAt ?? null, lastUsedAt: conn.lastUsedAt ?? null, lastError: conn.lastError ?? null,
      createdAt: now, updatedAt: now, updatedBy: ACTOR,
    });
  }
});

seedAll();
db.close();

console.log(`\nSeeded into ${STORE_PATH}:`);
console.log(`  ${state.brands.length} brands`);
console.log(`  ${state.regions.length} regions`);
console.log(`  ${state.connections.length} connections`);
console.log(`\nNext: set ADMIN_DATA_SOURCE=fixture-overlay in .env.haverford`);
console.log(`The gateway will serve this data independently of Dev API.`);
