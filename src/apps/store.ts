import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  CreateAppInstallInput,
  GatewayAppInstall,
  GatewayAppInstallStatus
} from "./types.js";

interface GatewayAppInstallRow {
  id: string;
  app_slug: string;
  brand_id: string;
  region_id: string;
  connection_id: string | null;
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

export class GatewayAppInstallStore {
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

  // ── Installs ─────────────────────────────────────────────────────────────────

  createInstall(input: CreateAppInstallInput): GatewayAppInstall {
    const now = timestamp();
    const id = generatedId("appinstall_");
    const status: GatewayAppInstallStatus = input.status ?? "pending";
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gateway_app_installs (
           id, app_slug, brand_id, region_id, connection_id, status, created_at, updated_at, error_detail
         )
         VALUES (
           @id, @appSlug, @brandId, @regionId, @connectionId, @status, @createdAt, @updatedAt, NULL
         )`
      )
      .run({
        id,
        appSlug: input.appSlug,
        brandId: input.brandId,
        regionId: input.regionId,
        connectionId: input.connectionId ?? null,
        status,
        createdAt: now,
        updatedAt: now
      });
    const row = this.db
      .prepare("SELECT * FROM gateway_app_installs WHERE id = ?")
      .get(id) as GatewayAppInstallRow;
    return this.installFromRow(row);
  }

  getInstall(id: string): GatewayAppInstall | undefined {
    const row = this.db
      .prepare("SELECT * FROM gateway_app_installs WHERE id = ?")
      .get(id) as GatewayAppInstallRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.installFromRow(row);
  }

  getInstallByKey(
    appSlug: string,
    brandId: string,
    regionId: string
  ): GatewayAppInstall | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM gateway_app_installs
         WHERE app_slug = @appSlug AND brand_id = @brandId AND region_id = @regionId`
      )
      .get({ appSlug, brandId, regionId }) as GatewayAppInstallRow | undefined;
    if (!row) {
      return undefined;
    }
    return this.installFromRow(row);
  }

  listInstalls(filter?: {
    appSlug?: string;
    brandId?: string;
    regionId?: string;
    status?: GatewayAppInstallStatus;
  }): GatewayAppInstall[] {
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    if (filter?.appSlug !== undefined) {
      conditions.push("app_slug = @appSlug");
      params.appSlug = filter.appSlug;
    }
    if (filter?.brandId !== undefined) {
      conditions.push("brand_id = @brandId");
      params.brandId = filter.brandId;
    }
    if (filter?.regionId !== undefined) {
      conditions.push("region_id = @regionId");
      params.regionId = filter.regionId;
    }
    if (filter?.status !== undefined) {
      conditions.push("status = @status");
      params.status = filter.status;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM gateway_app_installs ${where} ORDER BY created_at ASC, id ASC`;
    const rows = this.db.prepare(sql).all(params) as GatewayAppInstallRow[];
    return rows.map((row) => this.installFromRow(row));
  }

  updateInstallStatus(
    id: string,
    status: GatewayAppInstallStatus,
    errorDetail?: string
  ): void {
    this.db
      .prepare(
        `UPDATE gateway_app_installs
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

  deleteInstall(id: string): void {
    this.db.prepare("DELETE FROM gateway_app_installs WHERE id = ?").run(id);
  }

  // ── Migrations ───────────────────────────────────────────────────────────────

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_app_installs (
        id TEXT PRIMARY KEY NOT NULL,
        app_slug TEXT NOT NULL,
        brand_id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        connection_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_detail TEXT,
        UNIQUE(app_slug, brand_id, region_id)
      );
    `);
  }

  // ── Row mappers ──────────────────────────────────────────────────────────────

  private installFromRow(row: GatewayAppInstallRow): GatewayAppInstall {
    const install: GatewayAppInstall = {
      id: row.id,
      appSlug: row.app_slug,
      brandId: row.brand_id,
      regionId: row.region_id,
      status: row.status as GatewayAppInstallStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    if (row.connection_id !== null) {
      install.connectionId = row.connection_id;
    }
    if (row.error_detail !== null) {
      install.errorDetail = row.error_detail;
    }
    return install;
  }
}
