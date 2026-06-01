import { createInitialGatewayState } from "./fixtures.js";
import type {
  ApiClient,
  ApiKey,
  AuditEvent,
  Brand,
  Connection,
  Connector,
  CreateBrandInput,
  CreateConnectionInput,
  CreateRegionInput,
  GatewayBackendType,
  GatewayConnectionBackend,
  GatewayState,
  Region
} from "./types.js";

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRegionCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requireText(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function nextNumericId(existingIds: string[]): number {
  const max = existingIds.reduce((currentMax, id) => {
    const match = id.match(/(\d+)$/);
    return match ? Math.max(currentMax, Number(match[1])) : currentMax;
  }, 0);
  return max + 1;
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
    const slug = normalizeSlug(input.slug ?? input.name);
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
      status: "active",
      createdAt: this.now()
    };
    this.state.brands.push(brand);
    this.writeAudit({
      action: "brand.created",
      entityType: "brand",
      entityId: brand.id,
      summary: `${brand.name} brand created.`,
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
      status: "active",
      createdAt: this.now()
    };
    const domain = input.domain?.trim();
    if (domain) {
      region.domain = domain;
    }

    this.state.regions.push(region);
    this.writeAudit({
      action: "region.created",
      entityType: "region",
      entityId: region.id,
      summary: `${brand.name} ${region.code} region created.`,
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
    if (!connector.backendOptions.includes(input.backend)) {
      throw new Error(`Connector ${connector.slug} does not support backend ${input.backend}`);
    }

    const connection: Connection = {
      id: this.nextConnectionId(brand, region, connector, input.backend),
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backend: input.backend,
      displayName: input.displayName?.trim() || `${brand.name} ${region.code} ${connector.name}`,
      status: "pending",
      createdAt: this.now()
    };
    if (input.configSummary) {
      connection.configSummary = cloneValue(input.configSummary);
    }

    this.state.connections.push(connection);
    this.writeAudit({
      action: "connection.saved",
      entityType: "connection",
      entityId: connection.id,
      summary: `${connection.displayName} connection saved.`,
      metadata: {
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backend: connection.backend
      }
    });
    return cloneValue(connection);
  }

  testConnection(connectionId: string): Connection {
    const connection = this.findConnection(connectionId);
    const testedAt = this.now();
    connection.status = "connected";
    connection.lastTestedAt = testedAt;
    connection.updatedAt = testedAt;
    delete connection.lastError;

    this.writeAudit({
      action: "connection.tested",
      entityType: "connection",
      entityId: connection.id,
      summary: `${connection.displayName} connection tested.`,
      metadata: { status: connection.status }
    });
    return cloneValue(connection);
  }

  rotateApiKey(clientId: string, keyId: string): ApiClient {
    const { client, key } = this.findApiKey(clientId, keyId);
    const rotatedAt = this.now();
    const token = String(this.keySequence++).padStart(4, "0");
    key.status = "active";
    key.rotatedAt = rotatedAt;
    key.preview = `gw_mock_rotated_...${token}`;
    key.fingerprint = `mock-fp-${key.id}-${token}`;
    delete key.revokedAt;
    client.updatedAt = rotatedAt;

    this.writeAudit({
      action: "api_key.rotated",
      entityType: "api_key",
      entityId: key.id,
      summary: `${client.name} API key rotated.`,
      metadata: { clientId: client.id, keyId: key.id }
    });
    return cloneValue(client);
  }

  revokeApiKey(clientId: string, keyId: string): ApiClient {
    const { client, key } = this.findApiKey(clientId, keyId);
    const revokedAt = this.now();
    key.status = "revoked";
    key.revokedAt = revokedAt;
    client.updatedAt = revokedAt;

    this.writeAudit({
      action: "api_key.revoked",
      entityType: "api_key",
      entityId: key.id,
      summary: `${client.name} API key revoked.`,
      metadata: { clientId: client.id, keyId: key.id }
    });
    return cloneValue(client);
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
    backend: GatewayBackendType
  ): string {
    const base = [
      "connection",
      brand.slug.replace(/-/g, "_"),
      region.code.toLowerCase(),
      connector.slug.replace(/-/g, "_"),
      backend
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

  private writeAudit(input: Omit<AuditEvent, "id" | "actor" | "createdAt">): void {
    const id = `audit_${String(this.auditSequence++).padStart(4, "0")}`;
    this.state.auditEvents.unshift({
      id,
      actor: "fixture-admin",
      createdAt: this.now(),
      ...input
    });
  }

  private now(): string {
    return new Date().toISOString();
  }
}
