import { AdminBackendError } from "./backend-error.js";
import {
  isForbiddenRawSecretKey,
  normalizeRegionCode,
  normalizeSlug,
  optionalText,
  requireText,
  sanitizeConnectionConfig,
} from "./input-validation.js";
import type { EntityOverride, GatewayOverlayStore, StoredEntity } from "./overlay-store.js";
import type {
  ApiKey,
  AuditEvent,
  Brand,
  Connection,
  ConnectionStatus,
  Connector,
  CreateBrandInput,
  CreateConnectionInput,
  CreateRegionInput,
  EntityStatus,
  GatewayBackendType,
  GatewayConnectionBackend,
  GatewayEntityMeta,
  GatewayEntitySource,
  GatewayEntityType,
  GatewayState,
  Region,
  ResetEntityInput,
  UpdateBrandInput,
  UpdateConnectionInput,
  UpdateRegionInput
} from "./types.js";

export interface OverlayGatewayBackendOptions {
  source: GatewayConnectionBackend;
  store: GatewayOverlayStore;
  sourceLabel: string;
  sourceType: GatewayEntitySource;
  actor?: string;
}

type SnapshotParts = {
  state: GatewayState;
  source: GatewayState;
  gatewayBrands: Array<StoredEntity<Brand>>;
  gatewayRegions: Array<StoredEntity<Region>>;
  gatewayConnections: Array<StoredEntity<Connection>>;
  overrides: EntityOverride[];
  sourceBrandIds: Set<string>;
  sourceRegionIds: Set<string>;
  sourceConnectionIds: Set<string>;
};

const gatewaySourceLabel = "Gateway overlay";
const entityStatuses: EntityStatus[] = ["active", "disabled"];
const connectionStatuses: ConnectionStatus[] = ["needs_config", "pending", "connected", "needs_reconnect", "error"];

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asAdminError(error: unknown, statusCode = 400): AdminBackendError {
  if (error instanceof AdminBackendError) {
    return error;
  }
  return new AdminBackendError(statusCode, error instanceof Error ? error.message : String(error));
}

function optionalEntityStatus(value: unknown): EntityStatus | undefined {
  if (value === undefined) return undefined;
  if (entityStatuses.includes(value as EntityStatus)) return value as EntityStatus;
  throw new Error(`Invalid entity status: ${String(value)}`);
}

function optionalConnectionStatus(value: unknown): ConnectionStatus | undefined {
  if (value === undefined) return undefined;
  if (connectionStatuses.includes(value as ConnectionStatus)) return value as ConnectionStatus;
  throw new Error(`Invalid connection status: ${String(value)}`);
}

function sortAuditEvents(events: AuditEvent[]): AuditEvent[] {
  return [...events].sort((left, right) => {
    if (left.timestamp === right.timestamp) {
      return right.id.localeCompare(left.id);
    }
    return right.timestamp.localeCompare(left.timestamp);
  });
}

function ensureConnectorBackend(connector: Connector, backendType: GatewayBackendType): void {
  if (!connector.backendOptions.includes(backendType)) {
    throw new AdminBackendError(400, `Connector ${connector.slug} does not support backend ${backendType}`);
  }
}

function safeReferenceKeysFor(fieldKey: string): string[] {
  return [`${fieldKey}_ref`, "credential_ref"].filter(
    (key, index, keys) => key !== fieldKey && keys.indexOf(key) === index
  );
}

function connectorSecretFieldForKey(connector: Connector, key: string): string | undefined {
  for (const field of connector.requiredFields) {
    if (!field.secret) {
      continue;
    }
    if (key === field.key || safeReferenceKeysFor(field.key).includes(key)) {
      return field.key;
    }
  }
  return undefined;
}

function sanitizeConnectionConfigUpdate(
  connector: Connector,
  configSummary: Record<string, unknown> | undefined
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(configSummary ?? {})) {
    if (typeof value !== "string") {
      throw new Error(`Config field ${key} must be a string`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const secretFieldKey = connectorSecretFieldForKey(connector, key);
    if (secretFieldKey) {
      sanitized[`${secretFieldKey}_ref`] = `fixture-redacted:${secretFieldKey}`;
      continue;
    }
    if (isForbiddenRawSecretKey(key)) {
      throw new Error(`Unsafe config field: ${key}`);
    }
    sanitized[key] = trimmed;
  }
  return sanitized;
}

function hasPatchValues(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length > 0;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stringRecordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function storedMeta(
  entityType: GatewayEntityType,
  record: StoredEntity<Brand | Region | Connection>
): GatewayEntityMeta {
  return {
    entityType,
    entityId: record.value.id,
    source: "gateway",
    sourceLabel: gatewaySourceLabel,
    hasOverride: false,
    overrideFields: [],
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy
  };
}

export class OverlayGatewayBackend implements GatewayConnectionBackend {
  private readonly source: GatewayConnectionBackend;
  private readonly store: GatewayOverlayStore;
  private readonly sourceLabel: string;
  private readonly sourceType: GatewayEntitySource;
  private readonly actor: string;

  constructor(options: OverlayGatewayBackendOptions) {
    this.source = options.source;
    this.store = options.store;
    this.sourceLabel = options.sourceLabel;
    this.sourceType = options.sourceType;
    this.actor = options.actor ?? "gateway-admin";
  }

  close(): void {
    this.store.close();
  }

  async snapshot(): Promise<GatewayState> {
    return (await this.readMergedSnapshot()).state;
  }

  async createBrand(input: CreateBrandInput): Promise<Brand> {
    try {
      const snapshot = await this.readMergedSnapshot();
      const name = requireText(input.name, "Brand name");
      const slug = normalizeSlug(
        input.slug === undefined ? input.name : input.slug,
        input.slug === undefined ? "Brand name" : "Brand slug"
      );
      if (!slug) {
        throw new Error("Brand slug is required");
      }
      this.assertUniqueBrandSlug(snapshot.state.brands, slug);

      const brand: Brand = {
        id: this.nextId("gateway_brand", slug, snapshot.state.brands.map((candidate) => candidate.id)),
        name,
        slug,
        status: "active"
      };
      this.store.createBrand({ brand, actor: this.actor });
      this.store.writeAudit({
        action: "brand.created",
        targetType: "brand",
        targetId: brand.id,
        detail: `${brand.name} brand created.`,
        actor: this.actor,
        metadata: { slug: brand.slug, source: "gateway" }
      });
      return cloneValue(brand);
    } catch (error) {
      throw asAdminError(error, this.statusForValidationError(error));
    }
  }

  async createRegion(input: CreateRegionInput): Promise<Region> {
    try {
      const snapshot = await this.readMergedSnapshot();
      const brand = this.findBrand(snapshot.state, input.brandId);
      const name = requireText(input.name, "Region name");
      const code = normalizeRegionCode(input.code);
      if (!code) {
        throw new Error("Region code is required");
      }
      this.assertUniqueRegionCode(snapshot.state.regions, brand, code);

      const region: Region = {
        id: this.nextId(
          "gateway_region",
          `${brand.slug}_${code.toLowerCase()}`,
          snapshot.state.regions.map((candidate) => candidate.id)
        ),
        brandId: brand.id,
        code,
        name,
        status: "active"
      };
      const domain = optionalText(input.domain, "Region domain");
      if (domain) {
        region.domain = domain;
      }
      this.store.createRegion({ region, actor: this.actor });
      this.store.writeAudit({
        action: "region.created",
        targetType: "region",
        targetId: region.id,
        detail: `${brand.name} ${region.code} region created.`,
        actor: this.actor,
        metadata: { brandId: brand.id, code: region.code, source: "gateway" }
      });
      return cloneValue(region);
    } catch (error) {
      throw asAdminError(error, this.statusForValidationError(error));
    }
  }

  async createConnection(input: CreateConnectionInput): Promise<Connection> {
    try {
      const snapshot = await this.readMergedSnapshot();
      const brand = this.findBrand(snapshot.state, input.brandId);
      const region = this.findRegion(snapshot.state, input.regionId);
      if (region.brandId !== brand.id) {
        throw new AdminBackendError(400, `Region ${region.id} does not belong to brand ${brand.id}`);
      }
      const connector = this.findConnector(snapshot.state, input.connectorId);
      ensureConnectorBackend(connector, input.backendType);
      const displayName = requireText(input.displayName, "Connection display name");
      const configSummary = sanitizeConnectionConfig(connector, input.configSummary);

      const connection: Connection = {
        id: this.nextId(
          "gateway_connection",
          `${brand.slug}_${region.code.toLowerCase()}_${connector.slug}_${input.backendType}`,
          snapshot.state.connections.map((candidate) => candidate.id)
        ),
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backendType: input.backendType,
        displayName,
        status: "pending",
        configSummary
      };
      this.store.createConnection({ connection, actor: this.actor });
      this.store.writeAudit({
        action: "connection.saved",
        targetType: "connection",
        targetId: connection.id,
        detail: `${connection.displayName} connection saved.`,
        actor: this.actor,
        metadata: {
          brandId: brand.id,
          regionId: region.id,
          connectorId: connector.id,
          backendType: connection.backendType,
          source: "gateway"
        }
      });
      return cloneValue(connection);
    } catch (error) {
      throw asAdminError(error, this.statusForValidationError(error));
    }
  }

  async updateBrand(brandId: string, input: UpdateBrandInput): Promise<Brand> {
    try {
      const snapshot = await this.readMergedSnapshot();
      const brand = this.findBrand(snapshot.state, brandId);
      if (snapshot.sourceBrandIds.has(brandId)) {
        if (input.slug !== undefined) {
          throw new AdminBackendError(409, "Cannot edit source-owned brand identity fields.");
        }
        const patch = this.changedBrandPatch(brand, this.brandPatch(input));
        if (!hasPatchValues(patch)) {
          return cloneValue(brand);
        }
        const updated = this.applyBrandPatch(brand, patch);
        this.validateBrandSlugAfterUpdate(snapshot.state.brands, updated);
        this.upsertSourceOverride(snapshot, "brand", brandId, patch);
        this.auditUpdated("brand", brandId, `${updated.name} brand updated.`, { source: this.sourceType });
        return cloneValue(updated);
      }

      const record = snapshot.gatewayBrands.find((candidate) => candidate.value.id === brandId);
      if (!record) {
        throw new AdminBackendError(404, `Unknown brand: ${brandId}`);
      }
      const patch = this.changedBrandPatch(record.value, this.brandPatch(input));
      if (!hasPatchValues(patch)) {
        return cloneValue(record.value);
      }
      const updated = this.applyBrandPatch(record.value, patch);
      this.validateBrandSlugAfterUpdate(snapshot.state.brands, updated);
      const stored = this.store.updateBrand(updated, this.actor).value;
      this.auditUpdated("brand", brandId, `${stored.name} brand updated.`, { source: "gateway" });
      return cloneValue(stored);
    } catch (error) {
      throw asAdminError(error, this.statusForValidationError(error));
    }
  }

  async updateRegion(regionId: string, input: UpdateRegionInput): Promise<Region> {
    try {
      const snapshot = await this.readMergedSnapshot();
      const region = this.findRegion(snapshot.state, regionId);
      if (snapshot.sourceRegionIds.has(regionId)) {
        if (input.code !== undefined) {
          throw new AdminBackendError(409, "Cannot edit source-owned region identity fields.");
        }
        const patch = this.changedRegionPatch(region, this.regionPatch(input));
        if (!hasPatchValues(patch)) {
          return cloneValue(region);
        }
        const updated = this.applyRegionPatch(region, patch);
        this.validateRegionCodeAfterUpdate(snapshot.state.regions, updated);
        this.upsertSourceOverride(snapshot, "region", regionId, patch);
        this.auditUpdated("region", regionId, `${updated.code} region updated.`, { brandId: updated.brandId, source: this.sourceType });
        return cloneValue(updated);
      }

      const record = snapshot.gatewayRegions.find((candidate) => candidate.value.id === regionId);
      if (!record) {
        throw new AdminBackendError(404, `Unknown region: ${regionId}`);
      }
      const patch = this.changedRegionPatch(record.value, this.regionPatch(input));
      if (!hasPatchValues(patch)) {
        return cloneValue(record.value);
      }
      const updated = this.applyRegionPatch(record.value, patch);
      this.findBrand(snapshot.state, updated.brandId);
      this.validateRegionCodeAfterUpdate(snapshot.state.regions, updated);
      const stored = this.store.updateRegion(updated, this.actor).value;
      this.auditUpdated("region", regionId, `${stored.code} region updated.`, { brandId: stored.brandId, source: "gateway" });
      return cloneValue(stored);
    } catch (error) {
      throw asAdminError(error, this.statusForValidationError(error));
    }
  }

  async updateConnection(connectionId: string, input: UpdateConnectionInput): Promise<Connection> {
    try {
      const snapshot = await this.readMergedSnapshot();
      const connection = this.findConnection(snapshot.state, connectionId);
      const patch = this.changedConnectionPatch(connection, this.connectionPatch(snapshot.state, connection, input));
      if (!hasPatchValues(patch)) {
        return cloneValue(connection);
      }
      const updated = this.applyConnectionPatch(connection, patch);
      this.validateConnectionReferences(snapshot.state, updated);

      if (snapshot.sourceConnectionIds.has(connectionId)) {
        this.upsertSourceOverride(snapshot, "connection", connectionId, patch);
        this.auditUpdated("connection", connectionId, `${updated.displayName} connection updated.`, {
          connectorId: updated.connectorId,
          source: this.sourceType
        });
        return cloneValue(updated);
      }

      const record = snapshot.gatewayConnections.find((candidate) => candidate.value.id === connectionId);
      if (!record) {
        throw new AdminBackendError(404, `Unknown connection: ${connectionId}`);
      }
      const stored = this.store.updateConnection(updated, this.actor).value;
      this.auditUpdated("connection", connectionId, `${stored.displayName} connection updated.`, {
        connectorId: stored.connectorId,
        source: "gateway"
      });
      return cloneValue(stored);
    } catch (error) {
      throw asAdminError(error, this.statusForValidationError(error));
    }
  }

  async resetEntity(input: ResetEntityInput): Promise<GatewayState> {
    try {
      const snapshot = await this.readMergedSnapshot();
      this.assertKnownEntityType(input.entityType);
      if (!this.sourceIdSet(snapshot, input.entityType).has(input.entityId)) {
        if (this.gatewayRecordExists(snapshot, input.entityType, input.entityId)) {
          throw new AdminBackendError(409, "Gateway-owned entities do not have source overrides to reset.");
        }
        throw new AdminBackendError(404, `Unknown ${input.entityType}: ${input.entityId}`);
      }
      const override = snapshot.overrides.find(
        (candidate) => candidate.entityType === input.entityType && candidate.entityId === input.entityId
      );
      if (!override) {
        throw new AdminBackendError(404, `No overlay override exists for ${input.entityType}: ${input.entityId}`);
      }
      this.store.deleteOverride(input.entityType, input.entityId);
      this.store.writeAudit({
        action: "entity.reset",
        targetType: input.entityType,
        targetId: input.entityId,
        detail: `${input.entityType} overlay reset.`,
        actor: this.actor,
        metadata: { source: override.source }
      });
      return this.snapshot();
    } catch (error) {
      throw asAdminError(error, this.statusForValidationError(error));
    }
  }

  async testConnection(connectionId: string): Promise<Connection> {
    try {
      const snapshot = await this.readMergedSnapshot();
      const connection = this.findConnection(snapshot.state, connectionId);
      const patch: Partial<Connection> = {
        status: "connected",
        lastTestedAt: new Date().toISOString(),
        lastError: null as unknown as string
      };
      const updated = this.applyConnectionPatch(connection, patch);

      if (snapshot.sourceConnectionIds.has(connectionId)) {
        this.upsertSourceOverride(snapshot, "connection", connectionId, patch);
      } else {
        const record = snapshot.gatewayConnections.find((candidate) => candidate.value.id === connectionId);
        if (!record) {
          throw new AdminBackendError(404, `Unknown connection: ${connectionId}`);
        }
        this.store.updateConnection(updated, this.actor);
      }
      this.store.writeAudit({
        action: "connection.tested",
        targetType: "connection",
        targetId: connectionId,
        detail: `${updated.displayName} connection tested.`,
        actor: this.actor,
        metadata: { status: updated.status }
      });
      return cloneValue(updated);
    } catch (error) {
      throw asAdminError(error, this.statusForValidationError(error));
    }
  }

  async rotateApiKey(clientId: string, keyId: string): Promise<ApiKey> {
    return await this.source.rotateApiKey(clientId, keyId);
  }

  async revokeApiKey(clientId: string, keyId: string): Promise<ApiKey> {
    return await this.source.revokeApiKey(clientId, keyId);
  }

  private async readMergedSnapshot(): Promise<SnapshotParts> {
    const source = cloneValue(await this.source.snapshot());
    const gatewayBrands = this.store.listBrands();
    const gatewayRegions = this.store.listRegions();
    const gatewayConnections = this.store.listConnections();
    const overrides = this.store.listOverrides();
    const overrideByKey = new Map(overrides.map((override) => [this.overrideKey(override.entityType, override.entityId), override]));

    const sourceBrandIds = new Set(source.brands.map((brand) => brand.id));
    const sourceRegionIds = new Set(source.regions.map((region) => region.id));
    const sourceConnectionIds = new Set(source.connections.map((connection) => connection.id));
    const entityMeta: GatewayEntityMeta[] = [];

    const sourceBrands = source.brands.map((brand) => {
      const override = overrideByKey.get(this.overrideKey("brand", brand.id));
      const value = override ? this.applyBrandPatch(brand, override.patch) : brand;
      entityMeta.push(this.sourceMeta("brand", value.id, override));
      return value;
    });
    this.assertNoDuplicateBrandSlugs(sourceBrands);

    const brands = [...sourceBrands];
    for (const record of gatewayBrands) {
      brands.push(cloneValue(record.value));
      entityMeta.push(storedMeta("brand", record));
    }
    this.assertNoDuplicateBrandSlugs(brands);

    const brandIds = new Set(brands.map((brand) => brand.id));
    const sourceRegions = source.regions
      .map((region) => {
        const override = overrideByKey.get(this.overrideKey("region", region.id));
        const value = override ? this.applyRegionPatch(region, override.patch) : region;
        return { value, override };
      })
      .filter(({ value }) => brandIds.has(value.brandId));
    const regions = sourceRegions.map(({ value, override }) => {
      entityMeta.push(this.sourceMeta("region", value.id, override));
      return value;
    });
    for (const record of gatewayRegions) {
      if (!brandIds.has(record.value.brandId)) {
        continue;
      }
      regions.push(cloneValue(record.value));
      entityMeta.push(storedMeta("region", record));
    }
    this.assertNoDuplicateRegionCodes(regions);

    const regionById = new Map(regions.map((region) => [region.id, region]));
    const connectorIds = new Set(source.connectors.map((connector) => connector.id));
    const sourceConnections = source.connections
      .map((connection) => {
        const override = overrideByKey.get(this.overrideKey("connection", connection.id));
        const value = override ? this.applyConnectionPatch(connection, override.patch) : connection;
        return { value, override };
      })
      .filter(({ value }) => this.isCoherentConnection(value, brandIds, regionById, connectorIds));
    const connections = sourceConnections.map(({ value, override }) => {
      entityMeta.push(this.sourceMeta("connection", value.id, override));
      return value;
    });
    for (const record of gatewayConnections) {
      if (!this.isCoherentConnection(record.value, brandIds, regionById, connectorIds)) {
        continue;
      }
      connections.push(cloneValue(record.value));
      entityMeta.push(storedMeta("connection", record));
    }
    this.validateConnections({ ...source, brands, regions, connections });

    return {
      state: {
        brands,
        regions,
        connectors: cloneValue(source.connectors),
        connections,
        apiClients: cloneValue(source.apiClients),
        auditEvents: sortAuditEvents([...cloneValue(source.auditEvents), ...this.store.listAuditEvents()]),
        entityMeta
      },
      source,
      gatewayBrands,
      gatewayRegions,
      gatewayConnections,
      overrides,
      sourceBrandIds,
      sourceRegionIds,
      sourceConnectionIds
    };
  }

  private sourceMeta(entityType: GatewayEntityType, entityId: string, override: EntityOverride | undefined): GatewayEntityMeta {
    return {
      entityType,
      entityId,
      source: this.sourceType,
      sourceLabel: this.sourceLabel,
      hasOverride: override !== undefined,
      overrideFields: override ? Object.keys(override.patch).sort() : [],
      updatedAt: override?.updatedAt,
      updatedBy: override?.updatedBy
    };
  }

  private brandPatch(input: UpdateBrandInput): Partial<Brand> {
    const patch: Partial<Brand> = {};
    const name = optionalText(input.name, "Brand name");
    const status = optionalEntityStatus(input.status);
    if (input.slug !== undefined) {
      const slug = normalizeSlug(input.slug, "Brand slug");
      if (!slug) {
        throw new Error("Brand slug is required");
      }
      patch.slug = slug;
    }
    if (name) patch.name = name;
    if (status) patch.status = status;
    return patch;
  }

  private regionPatch(input: UpdateRegionInput): Partial<Region> {
    const patch: Partial<Region> = {};
    if (input.code !== undefined) {
      const code = normalizeRegionCode(input.code);
      if (!code) {
        throw new Error("Region code is required");
      }
      patch.code = code;
    }
    const name = optionalText(input.name, "Region name");
    const domain = optionalText(input.domain, "Region domain");
    const status = optionalEntityStatus(input.status);
    if (name) patch.name = name;
    if (input.domain !== undefined) patch.domain = domain ?? null as unknown as string;
    if (status) patch.status = status;
    return patch;
  }

  private connectionPatch(state: GatewayState, connection: Connection, input: UpdateConnectionInput): Partial<Connection> {
    const patch: Partial<Connection> = {};
    const displayName = optionalText(input.displayName, "Connection display name");
    const status = optionalConnectionStatus(input.status);
    const connector = this.findConnector(state, connection.connectorId);
    if (input.backendType !== undefined) {
      ensureConnectorBackend(connector, input.backendType);
      patch.backendType = input.backendType;
    }
    if (displayName) patch.displayName = displayName;
    if (status) patch.status = status;
    if (input.configSummary !== undefined) {
      patch.configSummary = sanitizeConnectionConfigUpdate(connector, input.configSummary);
    }
    if (input.lastError === null) {
      patch.lastError = null as unknown as string;
    } else if (input.lastError !== undefined) {
      patch.lastError = requireText(input.lastError, "Connection error note");
    }
    return patch;
  }

  private changedBrandPatch(current: Brand, patch: Partial<Brand>): Partial<Brand> {
    const changed: Partial<Brand> = {};
    if (patch.name !== undefined && patch.name !== current.name) changed.name = patch.name;
    if (patch.slug !== undefined && patch.slug !== current.slug) changed.slug = patch.slug;
    if (patch.status !== undefined && patch.status !== current.status) changed.status = patch.status;
    return changed;
  }

  private changedRegionPatch(current: Region, patch: Partial<Region>): Partial<Region> {
    const changed: Partial<Region> = {};
    if (patch.code !== undefined && patch.code !== current.code) changed.code = patch.code;
    if (patch.name !== undefined && patch.name !== current.name) changed.name = patch.name;
    if (patch.status !== undefined && patch.status !== current.status) changed.status = patch.status;
    if (hasOwn(patch as Record<string, unknown>, "domain")) {
      const nextDomain = patch.domain === null ? undefined : patch.domain;
      if (nextDomain !== current.domain) {
        changed.domain = nextDomain ?? (null as unknown as string);
      }
    }
    return changed;
  }

  private changedConnectionPatch(current: Connection, patch: Partial<Connection>): Partial<Connection> {
    const changed: Partial<Connection> = {};
    if (patch.backendType !== undefined && patch.backendType !== current.backendType) changed.backendType = patch.backendType;
    if (patch.displayName !== undefined && patch.displayName !== current.displayName) changed.displayName = patch.displayName;
    if (patch.status !== undefined && patch.status !== current.status) changed.status = patch.status;
    if (this.isConfigSummary(patch.configSummary) && !stringRecordsEqual(patch.configSummary, current.configSummary)) {
      changed.configSummary = patch.configSummary;
    }
    if (patch.lastTestedAt !== undefined && patch.lastTestedAt !== current.lastTestedAt) changed.lastTestedAt = patch.lastTestedAt;
    if (patch.lastUsedAt !== undefined && patch.lastUsedAt !== current.lastUsedAt) changed.lastUsedAt = patch.lastUsedAt;
    if (hasOwn(patch as Record<string, unknown>, "lastError")) {
      const nextLastError = patch.lastError === null ? undefined : patch.lastError;
      if (nextLastError !== current.lastError) {
        changed.lastError = nextLastError ?? (null as unknown as string);
      }
    }
    return changed;
  }

  private applyBrandPatch(brand: Brand, patch: Record<string, unknown>): Brand {
    return {
      ...cloneValue(brand),
      ...(typeof patch.name === "string" ? { name: patch.name } : {}),
      ...(typeof patch.slug === "string" ? { slug: patch.slug } : {}),
      ...(typeof patch.status === "string" ? { status: patch.status as EntityStatus } : {})
    };
  }

  private applyRegionPatch(region: Region, patch: Record<string, unknown>): Region {
    const updated = {
      ...cloneValue(region),
      ...(typeof patch.code === "string" ? { code: patch.code } : {}),
      ...(typeof patch.name === "string" ? { name: patch.name } : {}),
      ...(typeof patch.status === "string" ? { status: patch.status as EntityStatus } : {})
    };
    if (patch.domain === null) {
      delete updated.domain;
    } else if (typeof patch.domain === "string") {
      updated.domain = patch.domain;
    }
    return updated;
  }

  private applyConnectionPatch(connection: Connection, patch: Record<string, unknown>): Connection {
    const updated = {
      ...cloneValue(connection),
      ...(typeof patch.backendType === "string" ? { backendType: patch.backendType as GatewayBackendType } : {}),
      ...(typeof patch.displayName === "string" ? { displayName: patch.displayName } : {}),
      ...(typeof patch.status === "string" ? { status: patch.status as ConnectionStatus } : {}),
      ...(this.isConfigSummary(patch.configSummary) ? { configSummary: patch.configSummary } : {}),
      ...(typeof patch.lastTestedAt === "string" ? { lastTestedAt: patch.lastTestedAt } : {}),
      ...(typeof patch.lastUsedAt === "string" ? { lastUsedAt: patch.lastUsedAt } : {})
    };
    if (patch.lastError === null) {
      delete updated.lastError;
    } else if (typeof patch.lastError === "string") {
      updated.lastError = patch.lastError;
    }
    return updated;
  }

  private upsertSourceOverride(
    snapshot: SnapshotParts,
    entityType: GatewayEntityType,
    entityId: string,
    patch: Record<string, unknown>
  ): void {
    const existing = snapshot.overrides.find(
      (candidate) => candidate.entityType === entityType && candidate.entityId === entityId
    );
    this.store.upsertOverride({
      entityType,
      entityId,
      source: this.sourceType,
      patch: { ...(existing?.patch ?? {}), ...patch },
      actor: this.actor
    });
  }

  private auditUpdated(
    targetType: Extract<AuditEvent["targetType"], "brand" | "region" | "connection">,
    targetId: string,
    detail: string,
    metadata: Record<string, string>
  ): void {
    const actionByType = {
      brand: "brand.updated",
      region: "region.updated",
      connection: "connection.updated"
    } as const;
    this.store.writeAudit({
      action: actionByType[targetType],
      targetType,
      targetId,
      detail,
      actor: this.actor,
      metadata
    });
  }

  private findBrand(state: GatewayState, brandId: string): Brand {
    const brand = state.brands.find((candidate) => candidate.id === brandId);
    if (!brand) {
      throw new AdminBackendError(404, `Unknown brand: ${brandId}`);
    }
    return brand;
  }

  private findRegion(state: GatewayState, regionId: string): Region {
    const region = state.regions.find((candidate) => candidate.id === regionId);
    if (!region) {
      throw new AdminBackendError(404, `Unknown region: ${regionId}`);
    }
    return region;
  }

  private findConnector(state: GatewayState, connectorId: string): Connector {
    const connector = state.connectors.find((candidate) => candidate.id === connectorId);
    if (!connector) {
      throw new AdminBackendError(404, `Unknown connector: ${connectorId}`);
    }
    return connector;
  }

  private findConnection(state: GatewayState, connectionId: string): Connection {
    const connection = state.connections.find((candidate) => candidate.id === connectionId);
    if (!connection) {
      throw new AdminBackendError(404, `Unknown connection: ${connectionId}`);
    }
    return connection;
  }

  private assertUniqueBrandSlug(brands: Brand[], slug: string): void {
    if (brands.some((brand) => brand.slug === slug)) {
      throw new AdminBackendError(409, `Duplicate brand slug: ${slug}`);
    }
  }

  private validateBrandSlugAfterUpdate(brands: Brand[], updated: Brand): void {
    if (brands.some((brand) => brand.id !== updated.id && brand.slug === updated.slug)) {
      throw new AdminBackendError(409, `Duplicate brand slug: ${updated.slug}`);
    }
  }

  private assertNoDuplicateBrandSlugs(brands: Brand[]): void {
    const seen = new Set<string>();
    for (const brand of brands) {
      if (seen.has(brand.slug)) {
        throw new AdminBackendError(409, `Duplicate brand slug: ${brand.slug}`);
      }
      seen.add(brand.slug);
    }
  }

  private assertUniqueRegionCode(regions: Region[], brand: Brand, code: string): void {
    if (regions.some((region) => region.brandId === brand.id && region.code === code)) {
      throw new AdminBackendError(409, `Duplicate region code for ${brand.slug}: ${code}`);
    }
  }

  private validateRegionCodeAfterUpdate(regions: Region[], updated: Region): void {
    if (regions.some((region) => region.id !== updated.id && region.brandId === updated.brandId && region.code === updated.code)) {
      throw new AdminBackendError(409, `Duplicate region code for ${updated.brandId}: ${updated.code}`);
    }
  }

  private assertNoDuplicateRegionCodes(regions: Region[]): void {
    const seen = new Set<string>();
    for (const region of regions) {
      const key = `${region.brandId}:${region.code}`;
      if (seen.has(key)) {
        throw new AdminBackendError(409, `Duplicate region code for ${region.brandId}: ${region.code}`);
      }
      seen.add(key);
    }
  }

  private validateConnections(state: GatewayState): void {
    const brandIds = new Set(state.brands.map((brand) => brand.id));
    const regionById = new Map(state.regions.map((region) => [region.id, region]));
    const connectorIds = new Set(state.connectors.map((connector) => connector.id));
    for (const connection of state.connections) {
      if (!this.isCoherentConnection(connection, brandIds, regionById, connectorIds)) {
        throw new AdminBackendError(400, `Connection ${connection.id} has invalid parent references.`);
      }
      this.validateConnectionReferences(state, connection);
    }
  }

  private validateConnectionReferences(state: GatewayState, connection: Connection): void {
    const brand = this.findBrand(state, connection.brandId);
    const region = this.findRegion(state, connection.regionId);
    if (region.brandId !== brand.id) {
      throw new AdminBackendError(400, `Region ${region.id} does not belong to brand ${brand.id}`);
    }
    const connector = this.findConnector(state, connection.connectorId);
    ensureConnectorBackend(connector, connection.backendType);
  }

  private isCoherentConnection(
    connection: Connection,
    brandIds: Set<string>,
    regionById: Map<string, Region>,
    connectorIds: Set<string>
  ): boolean {
    const region = regionById.get(connection.regionId);
    return (
      brandIds.has(connection.brandId) &&
      region !== undefined &&
      region.brandId === connection.brandId &&
      connectorIds.has(connection.connectorId)
    );
  }

  private sourceIdSet(snapshot: SnapshotParts, entityType: GatewayEntityType): Set<string> {
    if (entityType === "brand") return snapshot.sourceBrandIds;
    if (entityType === "region") return snapshot.sourceRegionIds;
    return snapshot.sourceConnectionIds;
  }

  private gatewayRecordExists(snapshot: SnapshotParts, entityType: GatewayEntityType, entityId: string): boolean {
    if (entityType === "brand") return snapshot.gatewayBrands.some((record) => record.value.id === entityId);
    if (entityType === "region") return snapshot.gatewayRegions.some((record) => record.value.id === entityId);
    return snapshot.gatewayConnections.some((record) => record.value.id === entityId);
  }

  private assertKnownEntityType(entityType: GatewayEntityType): void {
    if (!["brand", "region", "connection"].includes(entityType)) {
      throw new AdminBackendError(400, `Unknown entity type: ${String(entityType)}`);
    }
  }

  private overrideKey(entityType: GatewayEntityType, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private nextId(prefix: string, slug: string, existingIds: string[]): string {
    const base = `${prefix}_${slug.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}`;
    if (!existingIds.includes(base)) {
      return base;
    }
    let suffix = 2;
    while (existingIds.includes(`${base}_${suffix}`)) {
      suffix += 1;
    }
    return `${base}_${suffix}`;
  }

  private isConfigSummary(value: unknown): value is Record<string, string> {
    return (
      value !== undefined &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every((entry) => typeof entry === "string")
    );
  }

  private statusForValidationError(error: unknown): number {
    if (error instanceof AdminBackendError) {
      return error.statusCode;
    }
    if (error instanceof Error && error.message.startsWith("Duplicate ")) {
      return 409;
    }
    return 400;
  }
}
