export type GatewayBackendType = "nango" | "composio" | "native" | "internal";
export type EntityStatus = "active" | "disabled";
export type ConnectionStatus = "needs_config" | "pending" | "connected" | "needs_reconnect" | "error";
export type AuthMode = "oauth" | "api_key" | "service_account" | "none";
export type ConnectorCategory = "commerce" | "analytics" | "marketing" | "crm" | "productivity" | "internal";
export type AuditAction =
  | "brand.created"
  | "region.created"
  | "connection.saved"
  | "connection.tested"
  | "api_key.rotated"
  | "api_key.revoked";

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

export interface GatewayState {
  brands: Brand[];
  regions: Region[];
  connectors: Connector[];
  connections: Connection[];
  apiClients: ApiClient[];
  auditEvents: AuditEvent[];
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

export interface GatewayConnectionBackend {
  snapshot(): GatewayState;
  createBrand(input: CreateBrandInput): Brand;
  createRegion(input: CreateRegionInput): Region;
  createConnection(input: CreateConnectionInput): Connection;
  testConnection(connectionId: string): Connection;
  rotateApiKey(clientId: string, keyId: string): ApiKey;
  revokeApiKey(clientId: string, keyId: string): ApiKey;
}
