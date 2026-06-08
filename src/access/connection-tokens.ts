export interface GatewayConnectionContext {
  connectionId: string;
  brandId: string;
  regionId: string;
  connectorSlug: string;
}

export interface ConnectionTokenRecord extends GatewayConnectionContext {
  id: string;
  apiKeyId: string;
  clientId: string;
  label: string;
  preview: string;
  fingerprint: string;
  status: "active" | "revoked";
  createdAt: string;
  createdBy: string;
  rotatedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  lastUsedAt?: string;
}

export interface CreateConnectionTokenInput {
  connectionId: string;
  context: GatewayConnectionContext;
  label: string;
  actor: string;
  mcpConnectionBaseUrl?: string;
}

export interface MintedConnectionToken {
  token: ConnectionTokenRecord;
  secret: string;
  mcpUrl: string;
}
