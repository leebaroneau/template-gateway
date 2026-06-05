import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ApiClient, ApiKey, AuditEvent } from "../admin/types.js";
import {
  createApiKeySecret,
  fingerprintApiKeySecret,
  hashApiKeySecret,
  previewApiKeySecret,
  verifyApiKeySecret
} from "./secret.js";
import type {
  AccessAuditInput,
  ApiKeyWithSecret,
  AuthenticatedGatewayApiClient,
  CreateApiClientInput,
  CreateApiKeyInput,
  RecordApiUsageInput,
  UpdateApiClientInput
} from "./types.js";
import { validateGatewayApiScopes } from "./types.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const API_CLIENT_TYPES = ["service", "agent", "worker"] as const;
const API_CLIENT_STATUSES = ["active", "revoked"] as const;
const API_KEY_STATUSES = ["active", "revoked"] as const;
const UNSAFE_METADATA_KEYS = [
  "authorization",
  "api_key",
  "access_token",
  "token",
  "secret",
  "password",
  "private_key",
  "bearer",
  "service_account_token"
] as const;
const UNSAFE_METADATA_VALUE_PATTERNS = [
  "gw_live_",
  "Bearer ",
  "ya29",
  "shpat_",
  "xox",
  "sk_",
  "-----BEGIN",
  "-----END",
  "PRIVATE KEY",
  "BEGIN PRIVATE"
] as const;
const REDACTED_METADATA_VALUE = "[redacted]";

interface ApiClientRow {
  id: string;
  name: string;
  type: string;
  status: string;
  owner: string;
  scopes_json: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

interface ApiKeyRow {
  id: string;
  client_id: string;
  label: string;
  secret_hash: string;
  preview: string;
  fingerprint: string;
  status: string;
  created_at: string;
  created_by: string;
  rotated_at: string | null;
  rotated_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  last_used_at: string | null;
}

interface AuditEventRow {
  id: string;
  action: AuditEvent["action"];
  target_type: AuditEvent["targetType"];
  target_id: string;
  detail: string;
  actor: string;
  metadata_json: string | null;
  timestamp: string;
}

function timestamp(): string {
  return new Date().toISOString();
}

function generatedId(prefix: string): string {
  return `${prefix}${new Date().toISOString().replace(/[^0-9]/g, "")}_${crypto.randomBytes(4).toString("hex")}`;
}

function sortedScopes(scopes: unknown): string[] {
  return validateGatewayApiScopes(scopes).sort((left, right) => left.localeCompare(right));
}

function validateApiClientType(value: unknown): ApiClient["type"] {
  if (typeof value === "string" && (API_CLIENT_TYPES as readonly string[]).includes(value)) {
    return value as ApiClient["type"];
  }
  throw new AccessStoreError(400, `Invalid API client type: ${String(value)}`);
}

function validateApiClientStatus(value: unknown): ApiClient["status"] {
  if (typeof value === "string" && (API_CLIENT_STATUSES as readonly string[]).includes(value)) {
    return value as ApiClient["status"];
  }
  throw new AccessStoreError(400, `Invalid API client status: ${String(value)}`);
}

function validateApiKeyStatus(value: unknown): ApiKey["status"] {
  if (typeof value === "string" && (API_KEY_STATUSES as readonly string[]).includes(value)) {
    return value as ApiKey["status"];
  }
  throw new AccessStoreError(400, `Invalid API key status: ${String(value)}`);
}

function stringArrayFromJson(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("Expected stored JSON string array");
  }
  return parsed;
}

function jsonObject<T extends Record<string, string>>(json: string): T {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected stored JSON object");
  }
  return parsed as T;
}

function sanitizeAuditMetadata(metadata: Record<string, string> | undefined): Record<string, string> | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  const sanitized = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      isUnsafeAuditMetadataEntry(key, value) ? REDACTED_METADATA_VALUE : value
    ])
  );

  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function isUnsafeAuditMetadataEntry(key: string, value: string): boolean {
  const normalizedKey = key.toLowerCase();
  return (
    UNSAFE_METADATA_KEYS.some((unsafeKey) => normalizedKey.includes(unsafeKey)) ||
    UNSAFE_METADATA_VALUE_PATTERNS.some((unsafePattern) => value.includes(unsafePattern))
  );
}

export class AccessStoreError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AccessStoreError";
    this.statusCode = statusCode;
  }
}

export class GatewayAccessStore {
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

  listApiClients(): ApiClient[] {
    const rows = this.db
      .prepare("SELECT * FROM gateway_api_clients ORDER BY created_at ASC, id ASC")
      .all() as ApiClientRow[];
    return rows.map((row) => this.clientFromRow(row));
  }

  createClient(input: CreateApiClientInput, actor: string): ApiClient {
    const scopes = sortedScopes(input.scopes);
    const type = validateApiClientType(input.type);
    const create = this.db.transaction(() => {
      const now = timestamp();
      const id = generatedId("api_client_");
      this.db
        .prepare(
          `INSERT INTO gateway_api_clients (
             id, name, type, status, owner, scopes_json, created_at, updated_at, revoked_at, revoked_by
           )
           VALUES (
             @id, @name, @type, 'active', @owner, @scopesJson, @createdAt, @updatedAt, NULL, NULL
           )`
        )
        .run({
          id,
          name: input.name,
          type,
          owner: input.owner,
          scopesJson: JSON.stringify(scopes),
          createdAt: now,
          updatedAt: now
        });
      this.insertAudit({
        action: "api_client.created",
        targetType: "api_client",
        targetId: id,
        detail: `API client created: ${input.name}`,
        actor,
        metadata: { owner: input.owner, type }
      });
      return this.readClient(id);
    });

    return create();
  }

  updateClient(clientId: string, input: UpdateApiClientInput, actor: string): ApiClient {
    const scopes = input.scopes === undefined ? undefined : sortedScopes(input.scopes);
    const update = this.db.transaction(() => {
      const existing = this.readClientRow(clientId);
      const existingType = validateApiClientType(existing.type);
      const existingStatus = validateApiClientStatus(existing.status);
      const nextType = input.type === undefined ? existingType : validateApiClientType(input.type);
      const nextStatus = input.status === undefined ? existingStatus : validateApiClientStatus(input.status);
      if (existingStatus === "revoked" && nextStatus === "active") {
        throw new AccessStoreError(409, `API client is revoked: ${clientId}`);
      }
      const now = timestamp();
      const result = this.db
        .prepare(
          `UPDATE gateway_api_clients
           SET name = @name,
               type = @type,
               status = @status,
               owner = @owner,
               scopes_json = @scopesJson,
               updated_at = @updatedAt,
               revoked_at = @revokedAt,
               revoked_by = @revokedBy
           WHERE id = @id`
        )
        .run({
          id: clientId,
          name: input.name ?? existing.name,
          type: nextType,
          status: nextStatus,
          owner: input.owner ?? existing.owner,
          scopesJson: scopes === undefined ? existing.scopes_json : JSON.stringify(scopes),
          updatedAt: now,
          revokedAt: nextStatus === "revoked" ? existing.revoked_at ?? now : null,
          revokedBy: nextStatus === "revoked" ? existing.revoked_by ?? actor : null
        });
      if (result.changes === 0) {
        throw new AccessStoreError(404, `API client not found: ${clientId}`);
      }
      this.insertAudit({
        action: nextStatus === "revoked" ? "api_client.revoked" : "api_client.updated",
        targetType: "api_client",
        targetId: clientId,
        detail: nextStatus === "revoked" ? `API client revoked: ${clientId}` : `API client updated: ${clientId}`,
        actor
      });
      return this.readClient(clientId);
    });

    return update();
  }

  createKey(clientId: string, input: CreateApiKeyInput, actor: string): ApiKeyWithSecret {
    const create = this.db.transaction(() => {
      const client = this.readClientRow(clientId);
      validateApiClientType(client.type);
      if (validateApiClientStatus(client.status) === "revoked") {
        throw new AccessStoreError(409, `API client is revoked: ${clientId}`);
      }
      this.assertActiveLabelAvailable(clientId, input.label);
      const now = timestamp();
      const secret = createApiKeySecret();
      const id = generatedId("api_key_");
      this.db
        .prepare(
          `INSERT INTO gateway_api_keys (
             id, client_id, label, secret_hash, preview, fingerprint, status, created_at, created_by,
             rotated_at, rotated_by, revoked_at, revoked_by, last_used_at
           )
           VALUES (
             @id, @clientId, @label, @secretHash, @preview, @fingerprint, 'active', @createdAt, @createdBy,
             NULL, NULL, NULL, NULL, NULL
           )`
        )
        .run({
          id,
          clientId,
          label: input.label,
          secretHash: hashApiKeySecret(secret),
          preview: previewApiKeySecret(secret),
          fingerprint: fingerprintApiKeySecret(secret),
          createdAt: now,
          createdBy: actor
        });
      this.insertAudit({
        action: "api_key.created",
        targetType: "api_key",
        targetId: id,
        detail: `API key created: ${input.label}`,
        actor,
        metadata: { clientId, label: input.label }
      });
      return { key: this.readKey(clientId, id), secret };
    });

    return create();
  }

  rotateKey(clientId: string, keyId: string, actor: string): ApiKeyWithSecret {
    const rotate = this.db.transaction(() => {
      const client = this.readClientRow(clientId);
      validateApiClientType(client.type);
      if (validateApiClientStatus(client.status) === "revoked") {
        throw new AccessStoreError(409, `API client is revoked: ${clientId}`);
      }
      const existing = this.readKeyRow(clientId, keyId);
      if (validateApiKeyStatus(existing.status) === "revoked") {
        throw new AccessStoreError(409, `Cannot rotate revoked API key: ${keyId}`);
      }

      const secret = createApiKeySecret();
      this.db
        .prepare(
          `UPDATE gateway_api_keys
           SET secret_hash = @secretHash,
               preview = @preview,
               fingerprint = @fingerprint,
               status = 'active',
               rotated_at = @rotatedAt,
               rotated_by = @rotatedBy,
               revoked_at = NULL,
               revoked_by = NULL
           WHERE client_id = @clientId AND id = @keyId`
        )
        .run({
          clientId,
          keyId,
          secretHash: hashApiKeySecret(secret),
          preview: previewApiKeySecret(secret),
          fingerprint: fingerprintApiKeySecret(secret),
          rotatedAt: timestamp(),
          rotatedBy: actor
        });
      this.insertAudit({
        action: "api_key.rotated",
        targetType: "api_key",
        targetId: keyId,
        detail: `API key rotated: ${existing.label}`,
        actor,
        metadata: { clientId, label: existing.label }
      });
      return { key: this.readKey(clientId, keyId), secret };
    });

    return rotate();
  }

  revokeKey(clientId: string, keyId: string, actor: string): ApiKey {
    const revoke = this.db.transaction(() => {
      const client = this.readClientRow(clientId);
      validateApiClientType(client.type);
      validateApiClientStatus(client.status);
      const existing = this.readKeyRow(clientId, keyId);
      if (validateApiKeyStatus(existing.status) === "revoked") {
        throw new AccessStoreError(409, `Cannot revoke revoked API key: ${keyId}`);
      }

      this.db
        .prepare(
          `UPDATE gateway_api_keys
           SET status = 'revoked', revoked_at = @revokedAt, revoked_by = @revokedBy
           WHERE client_id = @clientId AND id = @keyId`
        )
        .run({ clientId, keyId, revokedAt: timestamp(), revokedBy: actor });
      this.insertAudit({
        action: "api_key.revoked",
        targetType: "api_key",
        targetId: keyId,
        detail: `API key revoked: ${existing.label}`,
        actor,
        metadata: { clientId, label: existing.label }
      });
      return this.readKey(clientId, keyId);
    });

    return revoke();
  }

  authenticate(secret: string): AuthenticatedGatewayApiClient | undefined {
    if (typeof secret !== "string" || secret.length === 0) {
      return undefined;
    }

    const fingerprint = fingerprintApiKeySecret(secret);
    const authenticate = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT
             k.id AS key_id,
             k.client_id AS key_client_id,
             k.label AS key_label,
             k.secret_hash AS key_secret_hash,
             k.preview AS key_preview,
             k.fingerprint AS key_fingerprint,
             k.status AS key_status,
             k.created_at AS key_created_at,
             k.created_by AS key_created_by,
             k.rotated_at AS key_rotated_at,
             k.rotated_by AS key_rotated_by,
             k.revoked_at AS key_revoked_at,
             k.revoked_by AS key_revoked_by,
             k.last_used_at AS key_last_used_at,
             c.id AS client_id,
             c.name AS client_name,
             c.type AS client_type,
             c.status AS client_status,
             c.owner AS client_owner,
             c.scopes_json AS client_scopes_json,
             c.created_at AS client_created_at,
             c.updated_at AS client_updated_at,
             c.revoked_at AS client_revoked_at,
             c.revoked_by AS client_revoked_by
           FROM gateway_api_keys k
           JOIN gateway_api_clients c ON c.id = k.client_id
           WHERE k.fingerprint = @fingerprint`
        )
        .all({ fingerprint }) as Array<{
        key_id: string;
        key_client_id: string;
        key_label: string;
        key_secret_hash: string;
        key_preview: string;
        key_fingerprint: string;
        key_status: string;
        key_created_at: string;
        key_created_by: string;
        key_rotated_at: string | null;
        key_rotated_by: string | null;
        key_revoked_at: string | null;
        key_revoked_by: string | null;
        key_last_used_at: string | null;
        client_id: string;
        client_name: string;
        client_type: string;
        client_status: string;
        client_owner: string;
        client_scopes_json: string;
        client_created_at: string;
        client_updated_at: string;
        client_revoked_at: string | null;
        client_revoked_by: string | null;
      }>;

      const matched = rows.find((row) => {
        const keyStatus = validateApiKeyStatus(row.key_status);
        validateApiClientType(row.client_type);
        const clientStatus = validateApiClientStatus(row.client_status);
        return keyStatus === "active" && clientStatus === "active" && verifyApiKeySecret(secret, row.key_secret_hash);
      });
      if (!matched) {
        return undefined;
      }

      const now = timestamp();
      this.db
        .prepare("UPDATE gateway_api_keys SET last_used_at = @lastUsedAt WHERE id = @keyId")
        .run({ keyId: matched.key_id, lastUsedAt: now });
      return {
        client: this.clientFromRow({
          id: matched.client_id,
          name: matched.client_name,
          type: matched.client_type,
          status: matched.client_status,
          owner: matched.client_owner,
          scopes_json: matched.client_scopes_json,
          created_at: matched.client_created_at,
          updated_at: matched.client_updated_at,
          revoked_at: matched.client_revoked_at,
          revoked_by: matched.client_revoked_by
        }),
        key: this.keyFromRow({
          id: matched.key_id,
          client_id: matched.key_client_id,
          label: matched.key_label,
          secret_hash: matched.key_secret_hash,
          preview: matched.key_preview,
          fingerprint: matched.key_fingerprint,
          status: matched.key_status,
          created_at: matched.key_created_at,
          created_by: matched.key_created_by,
          rotated_at: matched.key_rotated_at,
          rotated_by: matched.key_rotated_by,
          revoked_at: matched.key_revoked_at,
          revoked_by: matched.key_revoked_by,
          last_used_at: now
        })
      };
    });

    return authenticate();
  }

  recordUsage(input: RecordApiUsageInput): void {
    const insert = this.db.transaction(() => {
      if (input.scope !== undefined) {
        validateGatewayApiScopes([input.scope]);
      }
      this.db
        .prepare(
          `INSERT INTO gateway_api_usage (
             id, client_id, key_id, route, method, status_code, scope, occurred_at, duration_ms
           )
           VALUES (
             @id, @clientId, @keyId, @route, @method, @statusCode, @scope, @occurredAt, @durationMs
           )`
        )
        .run({
          id: generatedId("api_usage_"),
          clientId: input.clientId ?? null,
          keyId: input.keyId ?? null,
          route: input.route,
          method: input.method,
          statusCode: input.statusCode,
          scope: input.scope ?? null,
          occurredAt: timestamp(),
          durationMs: input.durationMs ?? null
        });
    });

    insert();
  }

  writeAccessAudit(input: AccessAuditInput): void {
    this.insertAudit(input);
  }

  listAuditEvents(): AuditEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM gateway_audit_events ORDER BY timestamp DESC, rowid DESC")
      .all() as AuditEventRow[];
    return rows.map((row) => this.auditEventFromRow(row));
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
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
      CREATE TABLE IF NOT EXISTS gateway_api_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        owner TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        revoked_by TEXT
      );
      CREATE TABLE IF NOT EXISTS gateway_api_keys (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        label TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        preview TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        rotated_at TEXT,
        rotated_by TEXT,
        revoked_at TEXT,
        revoked_by TEXT,
        last_used_at TEXT,
        FOREIGN KEY(client_id) REFERENCES gateway_api_clients(id)
      );
      CREATE TABLE IF NOT EXISTS gateway_api_usage (
        id TEXT PRIMARY KEY,
        client_id TEXT,
        key_id TEXT,
        route TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        scope TEXT,
        occurred_at TEXT NOT NULL,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS gateway_api_keys_fingerprint_idx ON gateway_api_keys(fingerprint);
      CREATE UNIQUE INDEX IF NOT EXISTS gateway_api_keys_active_label_unique_idx
        ON gateway_api_keys(client_id, label)
        WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS gateway_api_usage_client_occurred_idx
        ON gateway_api_usage(client_id, occurred_at);
      CREATE TABLE IF NOT EXISTS gateway_connector_settings (
        connector_id TEXT PRIMARY KEY NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        backend TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    // Idempotent column addition for existing databases that predate the backend column.
    try {
      this.db.exec("ALTER TABLE gateway_connector_settings ADD COLUMN backend TEXT");
    } catch {
      // Column already exists — safe to ignore.
    }
    this.db
      .prepare("INSERT OR IGNORE INTO gateway_schema_migrations (id, applied_at) VALUES (@id, @appliedAt)")
      .run({ id: "002_gateway_access_store", appliedAt: timestamp() });
  }

  isConnectorEnabled(connectorId: string): boolean {
    const row = this.db
      .prepare("SELECT enabled FROM gateway_connector_settings WHERE connector_id = ?")
      .get(connectorId) as { enabled: number } | undefined;
    return row === undefined ? true : row.enabled === 1; // absent = enabled by default
  }

  setConnectorEnabled(connectorId: string, enabled: boolean): void {
    this.db
      .prepare("INSERT OR REPLACE INTO gateway_connector_settings (connector_id, enabled, updated_at) VALUES (@connectorId, @enabled, @updatedAt)")
      .run({ connectorId, enabled: enabled ? 1 : 0, updatedAt: timestamp() });
  }

  listDisabledConnectors(): string[] {
    const rows = this.db
      .prepare("SELECT connector_id FROM gateway_connector_settings WHERE enabled = 0")
      .all() as { connector_id: string }[];
    return rows.map((r) => r.connector_id);
  }

  getConnectorBackendOverride(connectorId: string): string | null {
    const row = this.db
      .prepare("SELECT backend FROM gateway_connector_settings WHERE connector_id = ?")
      .get(connectorId) as { backend: string | null } | undefined;
    return row?.backend ?? null;
  }

  setConnectorBackendOverride(connectorId: string, backend: string | null): void {
    this.db
      .prepare(
        `INSERT INTO gateway_connector_settings (connector_id, enabled, backend, updated_at)
         VALUES (@connectorId, 1, @backend, @updatedAt)
         ON CONFLICT(connector_id) DO UPDATE SET backend = @backend, updated_at = @updatedAt`
      )
      .run({ connectorId, backend, updatedAt: timestamp() });
  }

  private insertAudit(input: AccessAuditInput): AuditEvent {
    const eventTimestamp = timestamp();
    const id = generatedId("gateway_audit_");
    const metadata = sanitizeAuditMetadata(input.metadata);
    this.db
      .prepare(
        `INSERT INTO gateway_audit_events (
           id, action, target_type, target_id, detail, actor, metadata_json, timestamp
         )
         VALUES (
           @id, @action, @targetType, @targetId, @detail, @actor, @metadataJson, @timestamp
         )`
      )
      .run({
        id,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: input.detail,
        actor: input.actor,
        metadataJson: metadata === undefined ? null : JSON.stringify(metadata),
        timestamp: eventTimestamp
      });
    return this.readAuditEvent(id);
  }

  private assertActiveLabelAvailable(clientId: string, label: string): void {
    const row = this.db
      .prepare("SELECT id FROM gateway_api_keys WHERE client_id = @clientId AND label = @label AND status = 'active'")
      .get({ clientId, label }) as { id: string } | undefined;
    if (row) {
      throw new AccessStoreError(409, `API key label already exists for client: ${label}`);
    }
  }

  private readClient(id: string): ApiClient {
    return this.clientFromRow(this.readClientRow(id));
  }

  private readClientRow(id: string): ApiClientRow {
    const row = this.db.prepare("SELECT * FROM gateway_api_clients WHERE id = ?").get(id) as ApiClientRow | undefined;
    if (!row) {
      throw new AccessStoreError(404, `API client not found: ${id}`);
    }
    return row;
  }

  private readKey(clientId: string, keyId: string): ApiKey {
    return this.keyFromRow(this.readKeyRow(clientId, keyId));
  }

  private readKeyRow(clientId: string, keyId: string): ApiKeyRow {
    const row = this.db
      .prepare("SELECT * FROM gateway_api_keys WHERE client_id = @clientId AND id = @keyId")
      .get({ clientId, keyId }) as ApiKeyRow | undefined;
    if (!row) {
      throw new AccessStoreError(404, `API key not found: ${keyId}`);
    }
    return row;
  }

  private readAuditEvent(id: string): AuditEvent {
    const row = this.db.prepare("SELECT * FROM gateway_audit_events WHERE id = ?").get(id) as AuditEventRow | undefined;
    if (!row) {
      throw new Error(`Audit event not found: ${id}`);
    }
    return this.auditEventFromRow(row);
  }

  private clientFromRow(row: ApiClientRow): ApiClient {
    const keys = this.keysForClient(row.id);
    const type = validateApiClientType(row.type);
    const status = validateApiClientStatus(row.status);
    const client: ApiClient = {
      id: row.id,
      name: row.name,
      type,
      status,
      scopes: stringArrayFromJson(row.scopes_json),
      owner: row.owner,
      requestCount24h: this.requestCount24h(row.id),
      errorRate24h: this.errorRate24h(row.id),
      keys
    };
    const lastUsedAt = keys
      .map((key) => key.lastUsedAt)
      .filter((value): value is string => value !== undefined)
      .sort()
      .at(-1);
    if (lastUsedAt !== undefined) {
      client.lastUsedAt = lastUsedAt;
    }
    return client;
  }

  private keysForClient(clientId: string): ApiKey[] {
    const rows = this.db
      .prepare("SELECT * FROM gateway_api_keys WHERE client_id = @clientId ORDER BY created_at ASC, id ASC")
      .all({ clientId }) as ApiKeyRow[];
    return rows.map((row) => this.keyFromRow(row));
  }

  private keyFromRow(row: ApiKeyRow): ApiKey {
    const status = validateApiKeyStatus(row.status);
    const key: ApiKey = {
      id: row.id,
      label: row.label,
      preview: row.preview,
      fingerprint: row.fingerprint,
      status,
      createdAt: row.created_at
    };
    if (row.rotated_at !== null) {
      key.rotatedAt = row.rotated_at;
    }
    if (row.revoked_at !== null) {
      key.revokedAt = row.revoked_at;
    }
    if (row.last_used_at !== null) {
      key.lastUsedAt = row.last_used_at;
    }
    return key;
  }

  private requestCount24h(clientId: string): number {
    const since = new Date(Date.now() - DAY_IN_MS).toISOString();
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM gateway_api_usage WHERE client_id = @clientId AND occurred_at >= @since")
      .get({ clientId, since }) as { count: number };
    return row.count;
  }

  private errorRate24h(clientId: string): number {
    const since = new Date(Date.now() - DAY_IN_MS).toISOString();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
         FROM gateway_api_usage
         WHERE client_id = @clientId AND occurred_at >= @since`
      )
      .get({ clientId, since }) as { count: number; errors: number | null };
    if (row.count === 0) {
      return 0;
    }
    return (row.errors ?? 0) / row.count;
  }

  private auditEventFromRow(row: AuditEventRow): AuditEvent {
    const event: AuditEvent = {
      id: row.id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      detail: row.detail,
      actor: row.actor,
      timestamp: row.timestamp
    };
    if (row.metadata_json !== null) {
      event.metadata = jsonObject<Record<string, string>>(row.metadata_json);
    }
    return event;
  }
}
