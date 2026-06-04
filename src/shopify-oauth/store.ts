import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  ShopifyCredentialStatus,
  ShopifyOAuthCredential,
  ShopifyOAuthState
} from "./types.js";

export interface SaveOAuthStateInput {
  state: string;
  shop: string;
  scopes: string[];
  expiresAt: string;
}

export interface SaveCredentialInput {
  shop: string;
  encryptedPayload: string;
  scope: string;
  status: ShopifyCredentialStatus;
}

interface ShopifyOAuthStateRow {
  state: string;
  shop: string;
  scopes_json: string;
  created_at: string;
  expires_at: string;
}

interface ShopifyCredentialRow {
  id: string;
  shop: string;
  encrypted_payload: string;
  scope: string;
  status: string;
  created_at: string;
  updated_at: string;
  error_detail: string | null;
}

function timestamp(): string {
  return new Date().toISOString();
}

function generatedId(prefix: string): string {
  return `${prefix}${new Date().toISOString().replace(/[^0-9]/g, "")}_${crypto.randomBytes(4).toString("hex")}`;
}

export class GatewayShopifyStore {
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

  saveOAuthState(input: SaveOAuthStateInput): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gateway_shopify_oauth_states (
           state, shop, scopes_json, created_at, expires_at
         )
         VALUES (
           @state, @shop, @scopesJson, @createdAt, @expiresAt
         )`
      )
      .run({
        state: input.state,
        shop: input.shop,
        scopesJson: JSON.stringify(input.scopes),
        createdAt: timestamp(),
        expiresAt: input.expiresAt
      });
  }

  getOAuthState(state: string): ShopifyOAuthState | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_shopify_oauth_states WHERE state = ?")
      .get(state) as ShopifyOAuthStateRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.oauthStateFromRow(row);
  }

  deleteOAuthState(state: string): void {
    this.db.prepare("DELETE FROM gateway_shopify_oauth_states WHERE state = ?").run(state);
  }

  pruneExpiredStates(): void {
    this.db
      .prepare("DELETE FROM gateway_shopify_oauth_states WHERE expires_at < @now")
      .run({ now: timestamp() });
  }

  // ── Credentials ─────────────────────────────────────────────────────────────

  saveCredential(input: SaveCredentialInput): string {
    const now = timestamp();
    const id = generatedId("shopify_cred_");
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gateway_shopify_credentials (
           id, shop, encrypted_payload, scope, status, created_at, updated_at
         )
         VALUES (
           @id, @shop, @encryptedPayload, @scope, @status, @createdAt, @updatedAt
         )`
      )
      .run({
        id,
        shop: input.shop,
        encryptedPayload: input.encryptedPayload,
        scope: input.scope,
        status: input.status,
        createdAt: now,
        updatedAt: now
      });
    return id;
  }

  getCredential(id: string): (ShopifyOAuthCredential & { encryptedPayload: string }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_shopify_credentials WHERE id = ?")
      .get(id) as ShopifyCredentialRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.credentialFromRow(row);
  }

  getCredentialByShop(shop: string): (ShopifyOAuthCredential & { encryptedPayload: string }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_shopify_credentials WHERE shop = ?")
      .get(shop) as ShopifyCredentialRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.credentialFromRow(row);
  }

  listCredentials(): Array<ShopifyOAuthCredential & { encryptedPayload: string }> {
    const rows = this.db
      .prepare("SELECT * FROM gateway_shopify_credentials ORDER BY created_at ASC, id ASC")
      .all() as ShopifyCredentialRow[];
    return rows.map((row) => this.credentialFromRow(row));
  }

  updateCredentialStatus(idOrShop: string, status: ShopifyCredentialStatus, errorDetail?: string): void {
    const now = timestamp();
    const byId = this.db
      .prepare(
        `UPDATE gateway_shopify_credentials
         SET status = @status, error_detail = @errorDetail, updated_at = @updatedAt
         WHERE id = @idOrShop`
      )
      .run({
        idOrShop,
        status,
        errorDetail: errorDetail ?? null,
        updatedAt: now
      });
    if (byId.changes === 0) {
      this.db
        .prepare(
          `UPDATE gateway_shopify_credentials
           SET status = @status, error_detail = @errorDetail, updated_at = @updatedAt
           WHERE shop = @idOrShop`
        )
        .run({
          idOrShop,
          status,
          errorDetail: errorDetail ?? null,
          updatedAt: now
        });
    }
  }

  deleteCredential(id: string): void {
    this.db.prepare("DELETE FROM gateway_shopify_credentials WHERE id = ?").run(id);
  }

  deleteCredentialByShop(shop: string): void {
    this.db.prepare("DELETE FROM gateway_shopify_credentials WHERE shop = ?").run(shop);
  }

  // ── Migrations ───────────────────────────────────────────────────────────────

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_shopify_oauth_states (
        state TEXT PRIMARY KEY NOT NULL,
        shop TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gateway_shopify_credentials (
        id TEXT PRIMARY KEY NOT NULL,
        shop TEXT NOT NULL UNIQUE,
        encrypted_payload TEXT NOT NULL,
        scope TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_detail TEXT
      );
    `);
  }

  // ── Row mappers ──────────────────────────────────────────────────────────────

  private oauthStateFromRow(row: ShopifyOAuthStateRow): ShopifyOAuthState {
    const parsed = JSON.parse(row.scopes_json) as unknown;
    if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string")) {
      throw new Error("Expected stored JSON string array for scopes");
    }
    return {
      state: row.state,
      shop: row.shop,
      scopes: parsed as string[],
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  }

  private credentialFromRow(row: ShopifyCredentialRow): ShopifyOAuthCredential & { encryptedPayload: string } {
    const cred: ShopifyOAuthCredential & { encryptedPayload: string } = {
      id: row.id,
      shop: row.shop,
      encryptedPayload: row.encrypted_payload,
      scope: row.scope,
      status: row.status as ShopifyCredentialStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    if (row.error_detail !== null) {
      cred.errorDetail = row.error_detail;
    }
    return cred;
  }
}
