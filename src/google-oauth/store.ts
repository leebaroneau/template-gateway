import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  GoogleConnectionBinding,
  GoogleCredentialStatus,
  GoogleOAuthCredential,
  GoogleOAuthState,
  GoogleProduct
} from "./types.js";

export interface SaveCredentialInput {
  brandId: string;
  regionId: string;
  googleAccountEmail: string;
  encryptedPayload: string;
  tokenExpiryAt?: string;
  products: GoogleProduct[];
  status: GoogleCredentialStatus;
}

export interface UpsertCredentialInput {
  brandId: string;
  regionId: string;
  connectorSlug: string;
  accountId: string;
  googleAccountEmail: string;
  encryptedPayload: string;
  tokenExpiryAt?: string;
  products: GoogleProduct[];
  status: GoogleCredentialStatus;
}

export interface SaveBindingInput {
  credentialId: string;
  connectionId: string;
  product: GoogleProduct;
  resourceId: string;
  resourceName?: string;
}

interface GoogleOAuthStateRow {
  state: string;
  brand_id: string;
  region_id: string;
  products_json: string;
  bindings_json: string;
  created_at: string;
  expires_at: string;
}

interface GoogleCredentialRow {
  id: string;
  brand_id: string;
  region_id: string;
  google_account_email: string;
  encrypted_payload: string;
  token_expiry_at: string | null;
  products_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_refreshed_at: string | null;
  error_detail: string | null;
  account_id: string | null;
  connector_slug: string | null;
}

interface GoogleBindingRow {
  id: string;
  credential_id: string;
  connection_id: string;
  product: string;
  resource_id: string;
  resource_name: string | null;
  created_at: string;
}

// Inverse map from GoogleProduct to connector slug, used for migration backfill.
const PRODUCT_TO_SLUG: Record<string, string> = {
  ga4: "google-analytics-4",
  gsc: "google-search-console",
  google_ads: "google-ads",
  merchant_center: "merchant-center"
};

function timestamp(): string {
  return new Date().toISOString();
}

function generatedId(prefix: string): string {
  return `${prefix}${new Date().toISOString().replace(/[^0-9]/g, "")}_${crypto.randomBytes(4).toString("hex")}`;
}

function stringArrayFromJson(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("Expected stored JSON string array");
  }
  return parsed;
}

export class GatewayGoogleStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.runMigrations();
  }

  close(): void {
    this.db.close();
  }

  // ── OAuth states ────────────────────────────────────────────────────────────

  saveOAuthState(oauthState: GoogleOAuthState): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gateway_google_oauth_states (
           state, brand_id, region_id, products_json, bindings_json, created_at, expires_at
         )
         VALUES (
           @state, @brandId, @regionId, @productsJson, @bindingsJson, @createdAt, @expiresAt
         )`
      )
      .run({
        state: oauthState.state,
        brandId: oauthState.brandId,
        regionId: oauthState.regionId,
        productsJson: JSON.stringify(oauthState.products),
        bindingsJson: JSON.stringify(oauthState.bindings),
        createdAt: oauthState.createdAt,
        expiresAt: oauthState.expiresAt
      });
  }

  getOAuthState(state: string): GoogleOAuthState | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_google_oauth_states WHERE state = ?")
      .get(state) as GoogleOAuthStateRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.oauthStateFromRow(row);
  }

  deleteOAuthState(state: string): void {
    this.db.prepare("DELETE FROM gateway_google_oauth_states WHERE state = ?").run(state);
  }

  pruneExpiredStates(): void {
    this.db
      .prepare("DELETE FROM gateway_google_oauth_states WHERE expires_at < @now")
      .run({ now: timestamp() });
  }

  // ── Credentials ─────────────────────────────────────────────────────────────

  saveCredential(input: SaveCredentialInput): string {
    const now = timestamp();
    const id = generatedId("google_cred_");
    this.db
      .prepare(
        `INSERT INTO gateway_google_credentials (
           id, brand_id, region_id, google_account_email, encrypted_payload,
           token_expiry_at, products_json, status, created_at, updated_at,
           last_refreshed_at, error_detail
         )
         VALUES (
           @id, @brandId, @regionId, @googleAccountEmail, @encryptedPayload,
           @tokenExpiryAt, @productsJson, @status, @createdAt, @updatedAt,
           NULL, NULL
         )`
      )
      .run({
        id,
        brandId: input.brandId,
        regionId: input.regionId,
        googleAccountEmail: input.googleAccountEmail,
        encryptedPayload: input.encryptedPayload,
        tokenExpiryAt: input.tokenExpiryAt ?? null,
        productsJson: JSON.stringify(input.products),
        status: input.status,
        createdAt: now,
        updatedAt: now
      });
    return id;
  }

  // Idempotent upsert for account-linked credentials. Uses ON CONFLICT on the
  // partial unique index (brand_id, region_id, connector_slug WHERE connector_slug IS NOT NULL).
  // Returns the RETURNING id (existing row's id on conflict).
  upsertCredential(input: UpsertCredentialInput): string {
    const now = timestamp();
    const newId = generatedId("google_cred_");
    const row = this.db
      .prepare(
        `INSERT INTO gateway_google_credentials (
           id, brand_id, region_id, connector_slug, account_id, google_account_email,
           encrypted_payload, token_expiry_at, products_json, status,
           created_at, updated_at, last_refreshed_at, error_detail
         )
         VALUES (
           @id, @brandId, @regionId, @connectorSlug, @accountId, @googleAccountEmail,
           @encryptedPayload, @tokenExpiryAt, @productsJson, @status,
           @now, @now, NULL, NULL
         )
         ON CONFLICT(brand_id, region_id, connector_slug) DO UPDATE SET
           account_id        = excluded.account_id,
           google_account_email = excluded.google_account_email,
           encrypted_payload = excluded.encrypted_payload,
           token_expiry_at   = excluded.token_expiry_at,
           products_json     = excluded.products_json,
           status            = excluded.status,
           error_detail      = NULL,
           last_refreshed_at = @now,
           updated_at        = @now
         RETURNING id`
      )
      .get({
        id: newId,
        brandId: input.brandId,
        regionId: input.regionId,
        connectorSlug: input.connectorSlug,
        accountId: input.accountId,
        googleAccountEmail: input.googleAccountEmail,
        encryptedPayload: input.encryptedPayload,
        tokenExpiryAt: input.tokenExpiryAt ?? null,
        productsJson: JSON.stringify(input.products),
        status: input.status,
        now
      }) as { id: string };
    return row.id;
  }

  getCredential(id: string): (GoogleOAuthCredential & { encryptedPayload: string; accountId?: string; connectorSlug?: string }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_google_credentials WHERE id = ?")
      .get(id) as GoogleCredentialRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.credentialFromRow(row);
  }

  getCredentialByScope(
    brandId: string,
    regionId: string,
    connectorSlug: string
  ): (GoogleOAuthCredential & { encryptedPayload: string; accountId?: string; connectorSlug?: string }) | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM gateway_google_credentials WHERE brand_id = @brandId AND region_id = @regionId AND connector_slug = @connectorSlug"
      )
      .get({ brandId, regionId, connectorSlug }) as GoogleCredentialRow | undefined;
    if (!row) return undefined;
    return this.credentialFromRow(row);
  }

  listCredentials(): Array<GoogleOAuthCredential & { encryptedPayload: string; accountId?: string; connectorSlug?: string }> {
    const rows = this.db
      .prepare("SELECT * FROM gateway_google_credentials ORDER BY created_at ASC, id ASC")
      .all() as GoogleCredentialRow[];
    return rows.map((row) => this.credentialFromRow(row));
  }

  listCredentialsForAccount(accountId: string): Array<GoogleOAuthCredential & { encryptedPayload: string; accountId?: string; connectorSlug?: string }> {
    const rows = this.db
      .prepare("SELECT * FROM gateway_google_credentials WHERE account_id = ? ORDER BY created_at ASC, id ASC")
      .all(accountId) as GoogleCredentialRow[];
    return rows.map((row) => this.credentialFromRow(row));
  }

  updateCredentialStatus(id: string, status: GoogleCredentialStatus, errorDetail?: string): void {
    this.db
      .prepare(
        `UPDATE gateway_google_credentials
         SET status = @status, error_detail = @errorDetail, updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        status,
        errorDetail: errorDetail ?? null,
        updatedAt: timestamp()
      });
  }

  updateCredentialPayload(id: string, encryptedPayload: string, tokenExpiryAt: string): void {
    const now = timestamp();
    this.db
      .prepare(
        `UPDATE gateway_google_credentials
         SET encrypted_payload = @encryptedPayload,
             token_expiry_at = @tokenExpiryAt,
             status = 'connected',
             error_detail = NULL,
             last_refreshed_at = @lastRefreshedAt,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        encryptedPayload,
        tokenExpiryAt,
        lastRefreshedAt: now,
        updatedAt: now
      });
  }

  deleteCredential(id: string): void {
    const del = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM gateway_google_connection_bindings WHERE credential_id = ?")
        .run(id);
      this.db
        .prepare("DELETE FROM gateway_google_credentials WHERE id = ?")
        .run(id);
    });
    del();
  }

  // ── Bindings ─────────────────────────────────────────────────────────────────

  saveBinding(input: SaveBindingInput): string {
    const now = timestamp();
    const id = generatedId("google_bind_");
    this.db
      .prepare(
        `INSERT INTO gateway_google_connection_bindings (
           id, credential_id, connection_id, product, resource_id, resource_name, created_at
         )
         VALUES (
           @id, @credentialId, @connectionId, @product, @resourceId, @resourceName, @createdAt
         )`
      )
      .run({
        id,
        credentialId: input.credentialId,
        connectionId: input.connectionId,
        product: input.product,
        resourceId: input.resourceId,
        resourceName: input.resourceName ?? null,
        createdAt: now
      });
    return id;
  }

  listBindingsForCredential(credentialId: string): GoogleConnectionBinding[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM gateway_google_connection_bindings WHERE credential_id = @credentialId ORDER BY created_at ASC, id ASC"
      )
      .all({ credentialId }) as GoogleBindingRow[];
    return rows.map((row) => this.bindingFromRow(row));
  }

  // ── Migrations ───────────────────────────────────────────────────────────────

  private runMigrations(): void {
    // Phase 4 base tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_google_oauth_states (
        state TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        products_json TEXT NOT NULL,
        bindings_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_google_credentials (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        google_account_email TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        token_expiry_at TEXT,
        products_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_refreshed_at TEXT,
        error_detail TEXT
      );
      CREATE TABLE IF NOT EXISTS gateway_google_connection_bindings (
        id TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        product TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        resource_name TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(credential_id) REFERENCES gateway_google_credentials(id)
      );
    `);

    // Additive migration: account_id + connector_slug columns + dedup + unique index
    const existingColumns = (
      this.db.pragma("table_info(gateway_google_credentials)") as Array<{ name: string }>
    ).map((c) => c.name);

    if (!existingColumns.includes("account_id")) {
      this.db.exec("ALTER TABLE gateway_google_credentials ADD COLUMN account_id TEXT");
    }
    if (!existingColumns.includes("connector_slug")) {
      this.db.exec("ALTER TABLE gateway_google_credentials ADD COLUMN connector_slug TEXT");
    }

    // Step 1: Dedup single-product rows that will share the same derived
    // connector_slug BEFORE backfill, using products_json[0] as the key.
    // Keeps the row with the highest rowid (latest insert).
    const preDedup = this.db.transaction(() => {
      const preGroups = this.db
        .prepare(
          `SELECT brand_id, region_id,
                  json_extract(products_json, '$[0]') AS product,
                  MAX(rowid) AS keep_rowid
           FROM gateway_google_credentials
           WHERE connector_slug IS NULL AND json_array_length(products_json) = 1
           GROUP BY brand_id, region_id, json_extract(products_json, '$[0]')
           HAVING COUNT(*) > 1`
        )
        .all() as Array<{
          brand_id: string;
          region_id: string;
          product: string;
          keep_rowid: number;
        }>;
      for (const g of preGroups) {
        const stale = this.db
          .prepare(
            `SELECT id FROM gateway_google_credentials
             WHERE brand_id = @brand_id AND region_id = @region_id
               AND connector_slug IS NULL AND json_array_length(products_json) = 1
               AND json_extract(products_json, '$[0]') = @product
               AND rowid != @keep_rowid`
          )
          .all(g) as Array<{ id: string }>;
        for (const { id } of stale) {
          this.db
            .prepare("DELETE FROM gateway_google_connection_bindings WHERE credential_id = ?")
            .run(id);
          this.db.prepare("DELETE FROM gateway_google_credentials WHERE id = ?").run(id);
        }
      }
    });
    preDedup();

    // Step 2: Backfill connector_slug for surviving single-product rows.
    const singleProductRows = this.db
      .prepare(
        `SELECT id, products_json FROM gateway_google_credentials
         WHERE connector_slug IS NULL AND json_array_length(products_json) = 1`
      )
      .all() as Array<{ id: string; products_json: string }>;
    for (const row of singleProductRows) {
      const product = (JSON.parse(row.products_json) as string[])[0];
      const slug = PRODUCT_TO_SLUG[product];
      if (slug) {
        this.db
          .prepare("UPDATE gateway_google_credentials SET connector_slug = ? WHERE id = ?")
          .run(slug, row.id);
      }
    }

    // Step 3: Dedup any remaining connector_slug conflicts (rows that had
    // connector_slug pre-set from a prior migration with duplicate data).
    const postGroups = this.db
      .prepare(
        `SELECT brand_id, region_id, connector_slug, MAX(rowid) AS keep_rowid
         FROM gateway_google_credentials
         WHERE connector_slug IS NOT NULL
         GROUP BY brand_id, region_id, connector_slug
         HAVING COUNT(*) > 1`
      )
      .all() as Array<{
        brand_id: string;
        region_id: string;
        connector_slug: string;
        keep_rowid: number;
      }>;
    const postDedup = this.db.transaction(() => {
      for (const g of postGroups) {
        const stale = this.db
          .prepare(
            `SELECT id FROM gateway_google_credentials
             WHERE brand_id = @brand_id AND region_id = @region_id
               AND connector_slug = @connector_slug AND rowid != @keep_rowid`
          )
          .all(g) as Array<{ id: string }>;
        for (const { id } of stale) {
          this.db
            .prepare("DELETE FROM gateway_google_connection_bindings WHERE credential_id = ?")
            .run(id);
          this.db.prepare("DELETE FROM gateway_google_credentials WHERE id = ?").run(id);
        }
      }
    });
    postDedup();

    // Step 4: Create indexes. Using a full (non-partial) unique index so that
    // ON CONFLICT(brand_id, region_id, connector_slug) in upsertCredential can
    // reference it directly. SQLite treats NULL as distinct, so multiple rows
    // with NULL connector_slug are allowed (legacy Phase-4 rows are safe).
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_google_cred_account
        ON gateway_google_credentials(account_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_google_cred_scope
        ON gateway_google_credentials(brand_id, region_id, connector_slug);
    `);
  }

  // ── Row mappers ──────────────────────────────────────────────────────────────

  private oauthStateFromRow(row: GoogleOAuthStateRow): GoogleOAuthState {
    return {
      state: row.state,
      brandId: row.brand_id,
      regionId: row.region_id,
      products: stringArrayFromJson(row.products_json) as GoogleProduct[],
      bindings: JSON.parse(row.bindings_json) as GoogleOAuthState["bindings"],
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  }

  private credentialFromRow(
    row: GoogleCredentialRow
  ): GoogleOAuthCredential & { encryptedPayload: string; accountId?: string; connectorSlug?: string } {
    const cred: GoogleOAuthCredential & { encryptedPayload: string; accountId?: string; connectorSlug?: string } = {
      id: row.id,
      brandId: row.brand_id,
      regionId: row.region_id,
      googleAccountEmail: row.google_account_email,
      encryptedPayload: row.encrypted_payload,
      products: stringArrayFromJson(row.products_json) as GoogleProduct[],
      status: row.status as GoogleCredentialStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    if (row.token_expiry_at !== null) cred.tokenExpiryAt = row.token_expiry_at;
    if (row.last_refreshed_at !== null) cred.lastRefreshedAt = row.last_refreshed_at;
    if (row.error_detail !== null) cred.errorDetail = row.error_detail;
    if (row.account_id !== null) cred.accountId = row.account_id;
    if (row.connector_slug !== null) cred.connectorSlug = row.connector_slug;
    return cred;
  }

  private bindingFromRow(row: GoogleBindingRow): GoogleConnectionBinding {
    const binding: GoogleConnectionBinding = {
      id: row.id,
      credentialId: row.credential_id,
      connectionId: row.connection_id,
      product: row.product as GoogleProduct,
      resourceId: row.resource_id,
      createdAt: row.created_at
    };
    if (row.resource_name !== null) {
      binding.resourceName = row.resource_name;
    }
    return binding;
  }
}
