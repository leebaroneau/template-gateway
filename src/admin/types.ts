export type GatewayBackendType = "nango" | "composio" | "native" | "internal";
export type GatewayEntitySource = "dev_api" | "gateway" | "fixture";
export type GatewayEntityType = "brand" | "region" | "connection";
export type EntityStatus = "active" | "disabled";
export type ConnectionStatus = "needs_config" | "pending" | "connected" | "needs_reconnect" | "error";
export type AuthMode = "oauth" | "api_key" | "service_account" | "none";
export type ConnectorCategory = "commerce" | "analytics" | "marketing" | "crm" | "productivity" | "internal";
export type MaybePromise<T> = T | Promise<T>;
export type AuditAction =
  | "brand.created"
  | "brand.updated"
  | "region.created"
  | "region.updated"
  | "connection.saved"
  | "connection.updated"
  | "connection.tested"
  | "entity.reset"
  | "api_client.created"
  | "api_client.updated"
  | "api_client.revoked"
  | "api_key.created"
  | "api_key.rotated"
  | "api_key.revoked"
  | "api_auth.succeeded"
  | "api_auth.failed"
  | "api_scope.denied"
  | "api_read.succeeded"
  | "api_read.failed"
  | "mcp_auth.succeeded"
  | "mcp_auth.failed"
  | "mcp_tool.listed"
  | "mcp_tool.called"
  | "mcp_tool.failed";

export interface Brand {
  id: string;
  name: string;
  slug: string;
  status: EntityStatus;
}

export interface Region {
  id: string;
  brandId: string;
  code: string;
  name: string;
  status: EntityStatus;
  domain?: string;
}

export interface ConnectorField {
  key: string;
  label: string;
  secret?: boolean;
  example?: string;
}

export interface Connector {
  id: string;
  slug: string;
  name: string;
  category: ConnectorCategory;
  authMode: AuthMode;
  backendOptions: GatewayBackendType[];
  requiredFields: ConnectorField[];
  scopes: string[];
  description: string;
}

export interface Connection {
  id: string;
  brandId: string;
  regionId: string;
  connectorId: string;
  backendType: GatewayBackendType;
  displayName: string;
  status: ConnectionStatus;
  configSummary: Record<string, string>;
  lastTestedAt?: string;
  lastUsedAt?: string;
  lastError?: string;
}

export interface ApiKey {
  id: string;
  label: string;
  preview: string;
  fingerprint: string;
  status: "active" | "revoked";
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export interface ApiClient {
  id: string;
  name: string;
  type: "service" | "agent" | "worker";
  status: "active" | "revoked";
  scopes: string[];
  owner: string;
  lastUsedAt?: string;
  requestCount24h: number;
  errorRate24h: number;
  keys: ApiKey[];
}

export interface AuditEvent {
  id: string;
  action: AuditAction;
  targetType: "brand" | "region" | "connection" | "api_key" | "api_client";
  targetId: string;
  detail: string;
  timestamp: string;
  actor: string;
  metadata?: Record<string, string>;
}

export interface GatewayEntityMeta {
  entityType: GatewayEntityType;
  entityId: string;
  source: GatewayEntitySource;
  hasOverride: boolean;
  overrideFields: string[];
  sourceLabel: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface GatewayState {
  brands: Brand[];
  regions: Region[];
  connectors: Connector[];
  connections: Connection[];
  apiClients: ApiClient[];
  auditEvents: AuditEvent[];
  entityMeta?: GatewayEntityMeta[];
}

export interface CreateBrandInput {
  name: string;
  slug?: string;
}

export interface CreateRegionInput {
  brandId: string;
  code: string;
  name: string;
  domain?: string;
}

export interface CreateConnectionInput {
  brandId: string;
  regionId: string;
  connectorId: string;
  backendType: GatewayBackendType;
  displayName: string;
  configSummary?: Record<string, unknown>;
}

export interface UpdateBrandInput {
  name?: string;
  slug?: string;
  status?: EntityStatus;
}

export interface UpdateRegionInput {
  code?: string;
  name?: string;
  domain?: string;
  status?: EntityStatus;
}

export interface UpdateConnectionInput {
  backendType?: GatewayBackendType;
  displayName?: string;
  status?: ConnectionStatus;
  configSummary?: Record<string, unknown>;
  lastError?: string | null;
}

export interface ResetEntityInput {
  entityType: GatewayEntityType;
  entityId: string;
}

export interface GatewayConnectionBackend {
  snapshot(): MaybePromise<GatewayState>;
  createBrand(input: CreateBrandInput): MaybePromise<Brand>;
  createRegion(input: CreateRegionInput): MaybePromise<Region>;
  createConnection(input: CreateConnectionInput): MaybePromise<Connection>;
  updateBrand(brandId: string, input: UpdateBrandInput): MaybePromise<Brand>;
  updateRegion(regionId: string, input: UpdateRegionInput): MaybePromise<Region>;
  updateConnection(connectionId: string, input: UpdateConnectionInput): MaybePromise<Connection>;
  resetEntity(input: ResetEntityInput): MaybePromise<GatewayState>;
  testConnection(connectionId: string): MaybePromise<Connection>;
  rotateApiKey(clientId: string, keyId: string): MaybePromise<ApiKey>;
  revokeApiKey(clientId: string, keyId: string): MaybePromise<ApiKey>;
}
