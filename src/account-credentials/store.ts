import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AccountScopeQuery,
  LinkAccountInput,
  OAuthAccount,
  OAuthAccountLink,
  OAuthAccountStatus,
  OAuthService,
  UpsertAccountInput
} from "./types.js";

interface OAuthAccountRow {
  id: string;
  service: string;
  external_account_id: string;
  display_name: string | null;
  encrypted_payload: string;
  scope: string | null;
  status: string;
  token_expiry_at: string | null;
  last_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
  error_detail: string | null;
}

interface OAuthAccountLinkRow {
  id: string;
  account_id: string;
  brand_id: string;
  region_id: string;
  connector_slug: string;
  connection_id: string | null;
  created_at: string;
  updated_at: string;
}

function timestamp(): string {
  return new Date().toISOString();
}

function generatedId(prefix: string): string {
  return `${prefix}${new Date().toISOString().replace(/[^0-9]/g, "")}_${crypto.randomBytes(4).toString("hex")}`;
}

export class GatewayAccountStore {
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

  // ── Accounts ─────────────────────────────────────────────────────────────────

  upsertAccount(input: UpsertAccountInput): string {
    const now = timestamp();
    const newId = generatedId("oauth_acct_");
    const row = this.db
      .prepare(
        `INSERT INTO gateway_oauth_accounts (
           id, service, external_account_id, display_name, encrypted_payload,
           scope, status, token_expiry_at, last_refreshed_at, created_at, updated_at, error_detail
         )
         VALUES (
           @id, @service, @externalAccountId, @displayName, @encryptedPayload,
           @scope, @status, @tokenExpiryAt, NULL, @now, @now, NULL
         )
         ON CONFLICT(service, external_account_id) DO UPDATE SET
           display_name      = excluded.display_name,
           encrypted_payload = excluded.encrypted_payload,
           scope             = excluded.scope,
           status            = excluded.status,
           token_expiry_at   = excluded.token_expiry_at,
           updated_at        = excluded.updated_at,
           error_detail      = NULL
         RETURNING id`
      )
      .get({
        id: newId,
        service: input.service,
        externalAccountId: input.externalAccountId,
        displayName: input.displayName ?? null,
        encryptedPayload: input.encryptedPayload,
        scope: input.scope ?? null,
        status: input.status,
        tokenExpiryAt: input.tokenExpiryAt ?? null,
        now
      }) as { id: string };
    return row.id;
  }

  getAccount(id: string): (OAuthAccount & { encryptedPayload: string }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_oauth_accounts WHERE id = ?")
      .get(id) as OAuthAccountRow | undefined;
    if (!row) return undefined;
    return this.accountFromRow(row);
  }

  getAccountByExternalId(
    service: OAuthService,
    externalAccountId: string
  ): (OAuthAccount & { encryptedPayload: string }) | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_oauth_accounts WHERE service = @service AND external_account_id = @externalAccountId")
      .get({ service, externalAccountId }) as OAuthAccountRow | undefined;
    if (!row) return undefined;
    return this.accountFromRow(row);
  }

  listAccounts(service?: OAuthService): Array<OAuthAccount & { encryptedPayload: string }> {
    const rows = service
      ? (this.db
          .prepare("SELECT * FROM gateway_oauth_accounts WHERE service = ? ORDER BY created_at ASC, id ASC")
          .all(service) as OAuthAccountRow[])
      : (this.db
          .prepare("SELECT * FROM gateway_oauth_accounts ORDER BY created_at ASC, id ASC")
          .all() as OAuthAccountRow[]);
    return rows.map((row) => this.accountFromRow(row));
  }

  updateAccountPayload(id: string, encryptedPayload: string, tokenExpiryAt?: string): void {
    const now = timestamp();
    this.db
      .prepare(
        `UPDATE gateway_oauth_accounts
         SET encrypted_payload = @encryptedPayload,
             token_expiry_at   = @tokenExpiryAt,
             status            = 'connected',
             error_detail      = NULL,
             last_refreshed_at = @now,
             updated_at        = @now
         WHERE id = @id`
      )
      .run({ id, encryptedPayload, tokenExpiryAt: tokenExpiryAt ?? null, now });
  }

  updateAccountStatus(id: string, status: OAuthAccountStatus, errorDetail?: string): void {
    this.db
      .prepare(
        `UPDATE gateway_oauth_accounts
         SET status = @status, error_detail = @errorDetail, updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({ id, status, errorDetail: errorDetail ?? null, updatedAt: timestamp() });
  }

  deleteAccount(id: string): void {
    const del = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM gateway_oauth_account_links WHERE account_id = ?")
        .run(id);
      this.db
        .prepare("DELETE FROM gateway_oauth_accounts WHERE id = ?")
        .run(id);
    });
    del();
  }

  // ── Links ─────────────────────────────────────────────────────────────────────

  linkAccount(input: LinkAccountInput): string {
    const now = timestamp();
    const newId = generatedId("oauth_link_");
    const row = this.db
      .prepare(
        `INSERT INTO gateway_oauth_account_links (
           id, account_id, brand_id, region_id, connector_slug, connection_id, created_at, updated_at
         )
         VALUES (
           @id, @accountId, @brandId, @regionId, @connectorSlug, @connectionId, @now, @now
         )
         ON CONFLICT(account_id, brand_id, region_id, connector_slug) DO UPDATE SET
           connection_id = COALESCE(excluded.connection_id, connection_id),
           updated_at    = excluded.updated_at
         RETURNING id`
      )
      .get({
        id: newId,
        accountId: input.accountId,
        brandId: input.brandId,
        regionId: input.regionId,
        connectorSlug: input.connectorSlug,
        connectionId: input.connectionId ?? null,
        now
      }) as { id: string };
    return row.id;
  }

  listLinksForAccount(accountId: string): OAuthAccountLink[] {
    const rows = this.db
      .prepare("SELECT * FROM gateway_oauth_account_links WHERE account_id = ? ORDER BY created_at ASC, id ASC")
      .all(accountId) as OAuthAccountLinkRow[];
    return rows.map((row) => this.linkFromRow(row));
  }

  getLinkForScope(query: AccountScopeQuery): OAuthAccountLink | undefined {
    const row = this.db
      .prepare(
        `SELECT l.* FROM gateway_oauth_account_links l
         JOIN gateway_oauth_accounts a ON l.account_id = a.id
         WHERE a.service = @service
           AND l.brand_id = @brandId
           AND l.region_id = @regionId
           AND l.connector_slug = @connectorSlug`
      )
      .get({
        service: query.service,
        brandId: query.brandId,
        regionId: query.regionId,
        connectorSlug: query.connectorSlug
      }) as OAuthAccountLinkRow | undefined;
    if (!row) return undefined;
    return this.linkFromRow(row);
  }

  setLinkConnectionId(linkId: string, connectionId: string): void {
    this.db
      .prepare(
        `UPDATE gateway_oauth_account_links
         SET connection_id = @connectionId, updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({ id: linkId, connectionId, updatedAt: timestamp() });
  }

  removeLink(linkId: string): void {
    this.db.prepare("DELETE FROM gateway_oauth_account_links WHERE id = ?").run(linkId);
  }

  // ── Migrations ────────────────────────────────────────────────────────────────

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_oauth_accounts (
        id                  TEXT PRIMARY KEY NOT NULL,
        service             TEXT NOT NULL,
        external_account_id TEXT NOT NULL,
        display_name        TEXT,
        encrypted_payload   TEXT NOT NULL,
        scope               TEXT,
        status              TEXT NOT NULL,
        token_expiry_at     TEXT,
        last_refreshed_at   TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        error_detail        TEXT,
        UNIQUE(service, external_account_id)
      );
      CREATE TABLE IF NOT EXISTS gateway_oauth_account_links (
        id              TEXT PRIMARY KEY NOT NULL,
        account_id      TEXT NOT NULL,
        brand_id        TEXT NOT NULL,
        region_id       TEXT NOT NULL,
        connector_slug  TEXT NOT NULL,
        connection_id   TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE(account_id, brand_id, region_id, connector_slug),
        FOREIGN KEY(account_id) REFERENCES gateway_oauth_accounts(id)
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_links_account ON gateway_oauth_account_links(account_id);
      CREATE INDEX IF NOT EXISTS idx_oauth_links_scope
        ON gateway_oauth_account_links(brand_id, region_id, connector_slug);
    `);
  }

  // ── Row mappers ───────────────────────────────────────────────────────────────

  private accountFromRow(row: OAuthAccountRow): OAuthAccount & { encryptedPayload: string } {
    const account: OAuthAccount & { encryptedPayload: string } = {
      id: row.id,
      service: row.service as OAuthService,
      externalAccountId: row.external_account_id,
      encryptedPayload: row.encrypted_payload,
      status: row.status as OAuthAccountStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    if (row.display_name !== null) account.displayName = row.display_name;
    if (row.scope !== null) account.scope = row.scope;
    if (row.token_expiry_at !== null) account.tokenExpiryAt = row.token_expiry_at;
    if (row.last_refreshed_at !== null) account.lastRefreshedAt = row.last_refreshed_at;
    if (row.error_detail !== null) account.errorDetail = row.error_detail;
    return account;
  }

  private linkFromRow(row: OAuthAccountLinkRow): OAuthAccountLink {
    const link: OAuthAccountLink = {
      id: row.id,
      accountId: row.account_id,
      brandId: row.brand_id,
      regionId: row.region_id,
      connectorSlug: row.connector_slug,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    if (row.connection_id !== null) link.connectionId = row.connection_id;
    return link;
  }
}
