export type GatewayBackendType = "nango" | "composio" | "native" | "internal";
export type EntityStatus = "active" | "disabled";
export type ConnectionStatus = "needs_config" | "pending" | "connected" | "needs_reconnect" | "error";
export type AuthMode = "oauth" | "api_key" | "service_account" | "none";
export type ConnectorCategory = "commerce" | "analytics" | "marketing" | "crm" | "productivity" | "internal";

export interface Brand {
  id: string;
  name: string;
  slug: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface Region {
  id: string;
  brandId: string;
  code: string;
  name: string;
  status: EntityStatus;
  domain?: string;
  createdAt: string;
  updatedAt?: string;
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
  fields: ConnectorField[];
  description?: string;
}

export interface Connection {
  id: string;
  brandId: string;
  regionId: string;
  connectorId: string;
  backend: GatewayBackendType;
  displayName: string;
  status: ConnectionStatus;
  configSummary?: Record<string, string>;
  lastTestedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  preview: string;
  fingerprint: string;
  status: EntityStatus | "revoked";
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
}

export interface ApiClient {
  id: string;
  name: string;
  brandId?: string;
  regionId?: string;
  status: EntityStatus;
  keys: ApiKey[];
  createdAt: string;
  updatedAt?: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: "brand" | "region" | "connection" | "api_key" | "api_client";
  entityId: string;
  summary: string;
  actor: string;
  createdAt: string;
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
  backend: GatewayBackendType;
  displayName?: string;
  configSummary?: Record<string, string>;
}

export interface GatewayConnectionBackend {
  snapshot(): GatewayState;
  createBrand(input: CreateBrandInput): Brand;
  createRegion(input: CreateRegionInput): Region;
  createConnection(input: CreateConnectionInput): Connection;
  testConnection(connectionId: string): Connection;
  rotateApiKey(clientId: string, keyId: string): ApiClient;
  revokeApiKey(clientId: string, keyId: string): ApiClient;
}
