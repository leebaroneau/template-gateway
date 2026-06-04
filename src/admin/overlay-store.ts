import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AuditAction,
  AuditEvent,
  Brand,
  Connection,
  GatewayEntitySource,
  GatewayEntityType,
  Region
} from "./types.js";

export interface StoredEntity<T> {
  value: T;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface EntityOverride {
  entityType: GatewayEntityType;
  entityId: string;
  source: GatewayEntitySource;
  patch: Record<string, unknown>;
  sourceFingerprint?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CreateBrandRecordInput {
  brand: Brand;
  actor: string;
}

export interface CreateRegionRecordInput {
  region: Region;
  actor: string;
}

export interface CreateConnectionRecordInput {
  connection: Connection;
  actor: string;
}

export interface UpsertOverrideInput {
  entityType: GatewayEntityType;
  entityId: string;
  source: GatewayEntitySource;
  patch: Record<string, unknown>;
  actor: string;
  sourceFingerprint?: string;
}

export interface WriteAuditInput {
  action: AuditAction;
  targetType: AuditEvent["targetType"];
  targetId: string;
  detail: string;
  actor: string;
  metadata?: Record<string, string>;
}

interface BrandRow {
  id: string;
  name: string;
  slug: string;
  status: Brand["status"];
  created_at: string;
  updated_at: string;
  updated_by: string;
}

interface RegionRow {
  id: string;
  brand_id: string;
  code: string;
  name: string;
  status: Region["status"];
  domain: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

interface ConnectionRow {
  id: string;
  brand_id: string;
  region_id: string;
  connector_id: string;
  backend_type: Connection["backendType"];
  display_name: string;
  status: Connection["status"];
  config_summary_json: string;
  last_tested_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

interface OverrideRow {
  entity_type: GatewayEntityType;
  entity_id: string;
  source: GatewayEntitySource;
  patch_json: string;
  source_fingerprint: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

interface AuditEventRow {
  id: string;
  action: AuditAction;
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

function auditEventId(eventTimestamp: string): string {
  return `gateway_audit_${eventTimestamp.replace(/[^0-9]/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
}

function jsonObject<T extends Record<string, unknown>>(json: string): T {
  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected stored JSON object");
  }
  return parsed as T;
}

export class GatewayOverlayStore {
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

  listBrands(): Array<StoredEntity<Brand>> {
    const rows = this.db.prepare("SELECT * FROM gateway_brands ORDER BY created_at ASC, id ASC").all() as BrandRow[];
    return rows.map((row) => this.brandFromRow(row));
  }

  listRegions(): Array<StoredEntity<Region>> {
    const rows = this.db.prepare("SELECT * FROM gateway_regions ORDER BY created_at ASC, id ASC").all() as RegionRow[];
    return rows.map((row) => this.regionFromRow(row));
  }

  listConnections(): Array<StoredEntity<Connection>> {
    const rows = this.db.prepare("SELECT * FROM gateway_connections ORDER BY created_at ASC, id ASC").all() as ConnectionRow[];
    return rows.map((row) => this.connectionFromRow(row));
  }

  createBrand(input: CreateBrandRecordInput): StoredEntity<Brand> {
    const now = timestamp();
    this.db
      .prepare(
        `INSERT INTO gateway_brands (id, name, slug, status, created_at, updated_at, updated_by)
         VALUES (@id, @name, @slug, @status, @createdAt, @updatedAt, @updatedBy)`
      )
      .run({
        id: input.brand.id,
        name: input.brand.name,
        slug: input.brand.slug,
        status: input.brand.status,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.actor
      });
    return this.readBrand(input.brand.id);
  }

  updateBrand(brand: Brand, actor: string): StoredEntity<Brand> {
    const result = this.db
      .prepare(
        `UPDATE gateway_brands
         SET name = @name, slug = @slug, status = @status, updated_at = @updatedAt, updated_by = @updatedBy
         WHERE id = @id`
      )
      .run({
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        status: brand.status,
        updatedAt: timestamp(),
        updatedBy: actor
      });
    if (result.changes === 0) {
      throw new Error(`Brand not found: ${brand.id}`);
    }
    return this.readBrand(brand.id);
  }

  createRegion(input: CreateRegionRecordInput): StoredEntity<Region> {
    const now = timestamp();
    this.db
      .prepare(
        `INSERT INTO gateway_regions (id, brand_id, code, name, status, domain, created_at, updated_at, updated_by)
         VALUES (@id, @brandId, @code, @name, @status, @domain, @createdAt, @updatedAt, @updatedBy)`
      )
      .run({
        id: input.region.id,
        brandId: input.region.brandId,
        code: input.region.code,
        name: input.region.name,
        status: input.region.status,
        domain: input.region.domain ?? null,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.actor
      });
    return this.readRegion(input.region.id);
  }

  updateRegion(region: Region, actor: string): StoredEntity<Region> {
    const result = this.db
      .prepare(
        `UPDATE gateway_regions
         SET brand_id = @brandId, code = @code, name = @name, status = @status, domain = @domain,
             updated_at = @updatedAt, updated_by = @updatedBy
         WHERE id = @id`
      )
      .run({
        id: region.id,
        brandId: region.brandId,
        code: region.code,
        name: region.name,
        status: region.status,
        domain: region.domain ?? null,
        updatedAt: timestamp(),
        updatedBy: actor
      });
    if (result.changes === 0) {
      throw new Error(`Region not found: ${region.id}`);
    }
    return this.readRegion(region.id);
  }

  createConnection(input: CreateConnectionRecordInput): StoredEntity<Connection> {
    const now = timestamp();
    this.db
      .prepare(
        `INSERT INTO gateway_connections (
           id, brand_id, region_id, connector_id, backend_type, display_name, status, config_summary_json,
           last_tested_at, last_used_at, last_error, created_at, updated_at, updated_by
         )
         VALUES (
           @id, @brandId, @regionId, @connectorId, @backendType, @displayName, @status, @configSummaryJson,
           @lastTestedAt, @lastUsedAt, @lastError, @createdAt, @updatedAt, @updatedBy
         )`
      )
      .run({
        id: input.connection.id,
        brandId: input.connection.brandId,
        regionId: input.connection.regionId,
        connectorId: input.connection.connectorId,
        backendType: input.connection.backendType,
        displayName: input.connection.displayName,
        status: input.connection.status,
        configSummaryJson: JSON.stringify(input.connection.configSummary),
        lastTestedAt: input.connection.lastTestedAt ?? null,
        lastUsedAt: input.connection.lastUsedAt ?? null,
        lastError: input.connection.lastError ?? null,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.actor
      });
    return this.readConnection(input.connection.id);
  }

  updateConnection(connection: Connection, actor: string): StoredEntity<Connection> {
    const result = this.db
      .prepare(
        `UPDATE gateway_connections
         SET brand_id = @brandId, region_id = @regionId, connector_id = @connectorId, backend_type = @backendType,
             display_name = @displayName, status = @status, config_summary_json = @configSummaryJson,
             last_tested_at = @lastTestedAt, last_used_at = @lastUsedAt, last_error = @lastError,
             updated_at = @updatedAt, updated_by = @updatedBy
         WHERE id = @id`
      )
      .run({
        id: connection.id,
        brandId: connection.brandId,
        regionId: connection.regionId,
        connectorId: connection.connectorId,
        backendType: connection.backendType,
        displayName: connection.displayName,
        status: connection.status,
        configSummaryJson: JSON.stringify(connection.configSummary),
        lastTestedAt: connection.lastTestedAt ?? null,
        lastUsedAt: connection.lastUsedAt ?? null,
        lastError: connection.lastError ?? null,
        updatedAt: timestamp(),
        updatedBy: actor
      });
    if (result.changes === 0) {
      throw new Error(`Connection not found: ${connection.id}`);
    }
    return this.readConnection(connection.id);
  }

  listOverrides(): EntityOverride[] {
    const rows = this.db
      .prepare("SELECT * FROM gateway_entity_overrides ORDER BY updated_at DESC, rowid DESC")
      .all() as OverrideRow[];
    return rows.map((row) => this.overrideFromRow(row));
  }

  upsertOverride(input: UpsertOverrideInput): EntityOverride {
    const now = timestamp();
    this.db
      .prepare(
        `INSERT INTO gateway_entity_overrides (
           entity_type, entity_id, source, patch_json, source_fingerprint, created_at, updated_at, updated_by
         )
         VALUES (
           @entityType, @entityId, @source, @patchJson, @sourceFingerprint, @createdAt, @updatedAt, @updatedBy
         )
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           source = excluded.source,
           patch_json = excluded.patch_json,
           source_fingerprint = excluded.source_fingerprint,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`
      )
      .run({
        entityType: input.entityType,
        entityId: input.entityId,
        source: input.source,
        patchJson: JSON.stringify(input.patch),
        sourceFingerprint: input.sourceFingerprint ?? null,
        createdAt: now,
        updatedAt: now,
        updatedBy: input.actor
      });
    return this.readOverride(input.entityType, input.entityId);
  }

  deleteOverride(entityType: GatewayEntityType, entityId: string): void {
    this.db
      .prepare("DELETE FROM gateway_entity_overrides WHERE entity_type = @entityType AND entity_id = @entityId")
      .run({ entityType, entityId });
  }

  writeAudit(input: WriteAuditInput): AuditEvent {
    const eventTimestamp = timestamp();
    const id = auditEventId(eventTimestamp);
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
        metadataJson: input.metadata === undefined ? null : JSON.stringify(input.metadata),
        timestamp: eventTimestamp
      });
    return this.readAuditEvent(id);
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
      CREATE TABLE IF NOT EXISTS gateway_brands (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_regions (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        domain TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        UNIQUE(brand_id, code)
      );
      CREATE TABLE IF NOT EXISTS gateway_connections (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        connector_id TEXT NOT NULL,
        backend_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        config_summary_json TEXT NOT NULL,
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
        patch_json TEXT NOT NULL,
        source_fingerprint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        PRIMARY KEY(entity_type, entity_id)
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
    this.db
      .prepare("INSERT OR IGNORE INTO gateway_schema_migrations (id, applied_at) VALUES (@id, @appliedAt)")
      .run({ id: "001_gateway_overlay_store", appliedAt: timestamp() });
  }

  private readBrand(id: string): StoredEntity<Brand> {
    const row = this.db.prepare("SELECT * FROM gateway_brands WHERE id = ?").get(id) as BrandRow | undefined;
    if (!row) {
      throw new Error(`Brand not found: ${id}`);
    }
    return this.brandFromRow(row);
  }

  private readRegion(id: string): StoredEntity<Region> {
    const row = this.db.prepare("SELECT * FROM gateway_regions WHERE id = ?").get(id) as RegionRow | undefined;
    if (!row) {
      throw new Error(`Region not found: ${id}`);
    }
    return this.regionFromRow(row);
  }

  private readConnection(id: string): StoredEntity<Connection> {
    const row = this.db.prepare("SELECT * FROM gateway_connections WHERE id = ?").get(id) as ConnectionRow | undefined;
    if (!row) {
      throw new Error(`Connection not found: ${id}`);
    }
    return this.connectionFromRow(row);
  }

  private readOverride(entityType: GatewayEntityType, entityId: string): EntityOverride {
    const row = this.db
      .prepare("SELECT * FROM gateway_entity_overrides WHERE entity_type = @entityType AND entity_id = @entityId")
      .get({ entityType, entityId }) as OverrideRow | undefined;
    if (!row) {
      throw new Error(`Override not found: ${entityType}:${entityId}`);
    }
    return this.overrideFromRow(row);
  }

  private readAuditEvent(id: string): AuditEvent {
    const row = this.db.prepare("SELECT * FROM gateway_audit_events WHERE id = ?").get(id) as AuditEventRow | undefined;
    if (!row) {
      throw new Error(`Audit event not found: ${id}`);
    }
    return this.auditEventFromRow(row);
  }

  private brandFromRow(row: BrandRow): StoredEntity<Brand> {
    return {
      value: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    };
  }

  private regionFromRow(row: RegionRow): StoredEntity<Region> {
    const value: Region = {
      id: row.id,
      brandId: row.brand_id,
      code: row.code,
      name: row.name,
      status: row.status
    };
    if (row.domain !== null) {
      value.domain = row.domain;
    }
    return {
      value,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    };
  }

  private connectionFromRow(row: ConnectionRow): StoredEntity<Connection> {
    const value: Connection = {
      id: row.id,
      brandId: row.brand_id,
      regionId: row.region_id,
      connectorId: row.connector_id,
      backendType: row.backend_type,
      displayName: row.display_name,
      status: row.status,
      configSummary: jsonObject<Record<string, string>>(row.config_summary_json)
    };
    if (row.last_tested_at !== null) {
      value.lastTestedAt = row.last_tested_at;
    }
    if (row.last_used_at !== null) {
      value.lastUsedAt = row.last_used_at;
    }
    if (row.last_error !== null) {
      value.lastError = row.last_error;
    }
    return {
      value,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    };
  }

  private overrideFromRow(row: OverrideRow): EntityOverride {
    const override: EntityOverride = {
      entityType: row.entity_type,
      entityId: row.entity_id,
      source: row.source,
      patch: jsonObject<Record<string, unknown>>(row.patch_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    };
    if (row.source_fingerprint !== null) {
      override.sourceFingerprint = row.source_fingerprint;
    }
    return override;
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
