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

  getCredential(id: string): (GoogleOAuthCredential & { encryptedPayload: string }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_google_credentials WHERE id = ?")
      .get(id) as GoogleCredentialRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.credentialFromRow(row);
  }

  listCredentials(): Array<GoogleOAuthCredential & { encryptedPayload: string }> {
    const rows = this.db
      .prepare("SELECT * FROM gateway_google_credentials ORDER BY created_at ASC, id ASC")
      .all() as GoogleCredentialRow[];
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

  private credentialFromRow(row: GoogleCredentialRow): GoogleOAuthCredential & { encryptedPayload: string } {
    const cred: GoogleOAuthCredential & { encryptedPayload: string } = {
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
    if (row.token_expiry_at !== null) {
      cred.tokenExpiryAt = row.token_expiry_at;
    }
    if (row.last_refreshed_at !== null) {
      cred.lastRefreshedAt = row.last_refreshed_at;
    }
    if (row.error_detail !== null) {
      cred.errorDetail = row.error_detail;
    }
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
