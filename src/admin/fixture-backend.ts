import { createInitialGatewayState } from "./fixtures.js";
import {
  normalizeRegionCode,
  normalizeSlug,
  optionalText,
  requireText,
  sanitizeConnectionConfig,
  sanitizePartialConfigSummary
} from "./input-validation.js";
import type {
  ApiClient,
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
  GatewayState,
  ResetEntityInput,
  UpdateBrandInput,
  UpdateConnectionInput,
  UpdateRegionInput,
  Region
} from "./types.js";

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextNumericId(existingIds: string[]): number {
  const max = existingIds.reduce((currentMax, id) => {
    const match = id.match(/(\d+)$/);
    return match ? Math.max(currentMax, Number(match[1])) : currentMax;
  }, 0);
  return max + 1;
}

const entityStatuses: EntityStatus[] = ["active", "disabled"];
const connectionStatuses: ConnectionStatus[] = ["needs_config", "pending", "connected", "needs_reconnect", "error"];

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

export class FixtureGatewayBackend implements GatewayConnectionBackend {
  private readonly state: GatewayState;
  private auditSequence: number;
  private keySequence: number;

  constructor(initial: GatewayState = createInitialGatewayState()) {
    this.state = cloneValue(initial);
    this.auditSequence = nextNumericId(this.state.auditEvents.map((event) => event.id));
    this.keySequence = this.auditSequence;
  }

  snapshot(): GatewayState {
    return cloneValue(this.state);
  }

  createBrand(input: CreateBrandInput): Brand {
    const name = requireText(input.name, "Brand name");
    const slug = normalizeSlug(
      input.slug === undefined ? input.name : input.slug,
      input.slug === undefined ? "Brand name" : "Brand slug"
    );
    if (!slug) {
      throw new Error("Brand slug is required");
    }
    if (this.state.brands.some((brand) => brand.slug === slug)) {
      throw new Error(`Duplicate brand slug: ${slug}`);
    }

    const brand: Brand = {
      id: `brand_${slug.replace(/-/g, "_")}`,
      name,
      slug,
      status: "active"
    };
    this.state.brands.push(brand);
    this.writeAudit({
      action: "brand.created",
      targetType: "brand",
      targetId: brand.id,
      detail: `${brand.name} brand created.`,
      metadata: { slug: brand.slug }
    });
    return cloneValue(brand);
  }

  createRegion(input: CreateRegionInput): Region {
    const brand = this.findBrand(input.brandId);
    const name = requireText(input.name, "Region name");
    const code = normalizeRegionCode(input.code);
    if (!code) {
      throw new Error("Region code is required");
    }
    if (this.state.regions.some((region) => region.brandId === brand.id && region.code === code)) {
      throw new Error(`Duplicate region code for ${brand.slug}: ${code}`);
    }

    const region: Region = {
      id: `region_${brand.slug.replace(/-/g, "_")}_${code.toLowerCase()}`,
      brandId: brand.id,
      code,
      name,
      status: "active"
    };
    const domain = optionalText(input.domain, "Region domain");
    if (domain) {
      region.domain = domain;
    }

    this.state.regions.push(region);
    this.writeAudit({
      action: "region.created",
      targetType: "region",
      targetId: region.id,
      detail: `${brand.name} ${region.code} region created.`,
      metadata: { brandId: brand.id, code: region.code }
    });
    return cloneValue(region);
  }

  createConnection(input: CreateConnectionInput): Connection {
    const brand = this.findBrand(input.brandId);
    const region = this.findRegion(input.regionId);
    if (region.brandId !== brand.id) {
      throw new Error(`Region ${region.id} does not belong to brand ${brand.id}`);
    }

    const connector = this.findConnector(input.connectorId);
    if (!connector.backendOptions.includes(input.backendType)) {
      throw new Error(`Connector ${connector.slug} does not support backend ${input.backendType}`);
    }

    const displayName = requireText(input.displayName, "Connection display name");
    const configSummary = sanitizeConnectionConfig(connector, input.configSummary);
    const connection: Connection = {
      id: this.nextConnectionId(brand, region, connector, input.backendType),
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: input.backendType,
      displayName,
      status: "pending",
      configSummary
    };

    this.state.connections.push(connection);
    this.writeAudit({
      action: "connection.saved",
      targetType: "connection",
      targetId: connection.id,
      detail: `${connection.displayName} connection saved.`,
      metadata: {
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backendType: connection.backendType
      }
    });
    return cloneValue(connection);
  }

  updateBrand(brandId: string, input: UpdateBrandInput): Brand {
    const brand = this.findBrand(brandId);
    const name = optionalText(input.name, "Brand name");
    const status = optionalEntityStatus(input.status);
    if (input.slug !== undefined) {
      const slug = normalizeSlug(input.slug, "Brand slug");
      if (!slug) {
        throw new Error("Brand slug is required");
      }
      if (this.state.brands.some((candidate) => candidate.id !== brand.id && candidate.slug === slug)) {
        throw new Error(`Duplicate brand slug: ${slug}`);
      }
      brand.slug = slug;
    }
    if (name) brand.name = name;
    if (status) brand.status = status;
    this.writeAudit({
      action: "brand.updated",
      targetType: "brand",
      targetId: brand.id,
      detail: `${brand.name} brand updated.`,
      metadata: { slug: brand.slug }
    });
    return cloneValue(brand);
  }

  updateRegion(regionId: string, input: UpdateRegionInput): Region {
    const region = this.findRegion(regionId);
    const code = input.code === undefined ? undefined : normalizeRegionCode(input.code);
    const name = optionalText(input.name, "Region name");
    const domain = optionalText(input.domain, "Region domain");
    const status = optionalEntityStatus(input.status);
    if (code) {
      if (this.state.regions.some((candidate) => candidate.id !== region.id && candidate.brandId === region.brandId && candidate.code === code)) {
        throw new Error(`Duplicate region code for ${region.brandId}: ${code}`);
      }
      region.code = code;
    }
    if (name) region.name = name;
    if (input.domain !== undefined) {
      if (domain) region.domain = domain;
      else delete region.domain;
    }
    if (status) region.status = status;
    this.writeAudit({
      action: "region.updated",
      targetType: "region",
      targetId: region.id,
      detail: `${region.code} region updated.`,
      metadata: { brandId: region.brandId }
    });
    return cloneValue(region);
  }

  updateConnection(connectionId: string, input: UpdateConnectionInput): Connection {
    const connection = this.findConnection(connectionId);
    const displayName = optionalText(input.displayName, "Connection display name");
    const status = optionalConnectionStatus(input.status);
    if (input.backendType !== undefined) {
      const connector = this.findConnector(connection.connectorId);
      if (!connector.backendOptions.includes(input.backendType)) {
        throw new Error(`Connector ${connector.slug} does not support backend ${input.backendType}`);
      }
      connection.backendType = input.backendType;
    }
    if (displayName) connection.displayName = displayName;
    if (status) connection.status = status;
    if (input.configSummary !== undefined) {
      connection.configSummary = sanitizePartialConfigSummary(input.configSummary);
    }
    if (input.lastError === null) delete connection.lastError;
    else if (input.lastError !== undefined) connection.lastError = requireText(input.lastError, "Connection error note");
    this.writeAudit({
      action: "connection.updated",
      targetType: "connection",
      targetId: connection.id,
      detail: `${connection.displayName} connection updated.`,
      metadata: { connectorId: connection.connectorId }
    });
    return cloneValue(connection);
  }

  resetEntity(_input: ResetEntityInput): GatewayState {
    throw new Error("Fixture backend has no source override to reset.");
  }

  testConnection(connectionId: string): Connection {
    const connection = this.findConnection(connectionId);
    connection.status = "connected";
    connection.lastTestedAt = this.now();
    delete connection.lastError;

    this.writeAudit({
      action: "connection.tested",
      targetType: "connection",
      targetId: connection.id,
      detail: `${connection.displayName} connection tested.`,
      metadata: { status: connection.status }
    });
    return cloneValue(connection);
  }

  rotateApiKey(clientId: string, keyId: string): ApiKey {
    const { client, key } = this.findApiKey(clientId, keyId);
    if (key.status === "revoked") {
      throw new Error(`Cannot rotate revoked API key: ${key.id}`);
    }

    const token = String(this.keySequence++).padStart(4, "0");
    key.status = "active";
    key.rotatedAt = this.now();
    key.preview = `gw_mock_rotated_...${token}`;
    key.fingerprint = `mock-fp-${key.id}-${token}`;

    this.writeAudit({
      action: "api_key.rotated",
      targetType: "api_key",
      targetId: key.id,
      detail: `${client.name} API key rotated.`,
      metadata: { clientId: client.id, keyId: key.id }
    });
    return cloneValue(key);
  }

  revokeApiKey(clientId: string, keyId: string): ApiKey {
    const { client, key } = this.findApiKey(clientId, keyId);
    if (key.status === "revoked") {
      throw new Error(`Cannot revoke revoked API key: ${key.id}`);
    }

    key.status = "revoked";
    key.revokedAt = this.now();

    this.writeAudit({
      action: "api_key.revoked",
      targetType: "api_key",
      targetId: key.id,
      detail: `${client.name} API key revoked.`,
      metadata: { clientId: client.id, keyId: key.id }
    });
    return cloneValue(key);
  }

  private findBrand(brandId: string): Brand {
    const brand = this.state.brands.find((candidate) => candidate.id === brandId);
    if (!brand) {
      throw new Error(`Unknown brand: ${brandId}`);
    }
    return brand;
  }

  private findRegion(regionId: string): Region {
    const region = this.state.regions.find((candidate) => candidate.id === regionId);
    if (!region) {
      throw new Error(`Unknown region: ${regionId}`);
    }
    return region;
  }

  private findConnector(connectorId: string): Connector {
    const connector = this.state.connectors.find((candidate) => candidate.id === connectorId);
    if (!connector) {
      throw new Error(`Unknown connector: ${connectorId}`);
    }
    return connector;
  }

  private findConnection(connectionId: string): Connection {
    const connection = this.state.connections.find((candidate) => candidate.id === connectionId);
    if (!connection) {
      throw new Error(`Unknown connection: ${connectionId}`);
    }
    return connection;
  }

  private findApiKey(clientId: string, keyId: string): { client: ApiClient; key: ApiKey } {
    const client = this.state.apiClients.find((candidate) => candidate.id === clientId);
    if (!client) {
      throw new Error(`Unknown API client: ${clientId}`);
    }
    const key = client.keys.find((candidate) => candidate.id === keyId);
    if (!key) {
      throw new Error(`Unknown API key: ${keyId}`);
    }
    return { client, key };
  }

  private nextConnectionId(
    brand: Brand,
    region: Region,
    connector: Connector,
    backendType: GatewayBackendType
  ): string {
    const base = [
      "connection",
      brand.slug.replace(/-/g, "_"),
      region.code.toLowerCase(),
      connector.slug.replace(/-/g, "_"),
      backendType
    ].join("_");
    if (!this.state.connections.some((connection) => connection.id === base)) {
      return base;
    }
    let suffix = 2;
    while (this.state.connections.some((connection) => connection.id === `${base}_${suffix}`)) {
      suffix += 1;
    }
    return `${base}_${suffix}`;
  }

  private writeAudit(input: Omit<AuditEvent, "id" | "actor" | "timestamp">): void {
    const id = `audit_${String(this.auditSequence++).padStart(4, "0")}`;
    this.state.auditEvents.unshift({
      id,
      actor: "fixture-admin",
      timestamp: this.now(),
      ...input
    });
  }

  private now(): string {
    return new Date().toISOString();
  }
}
