import type {
  Brand,
  Connection,
  Connector,
  GatewayBackendType,
  GatewayEntitySource,
  GatewayState,
  Region
} from "../admin/types.js";

export type GatewaySetupMode = "current" | "manual_ref" | "oauth_managed";
export type GatewayRuntimeStatus = "metadata_only" | "read_proxy_ready" | "oauth_ready";
export type GatewayMigrationStatus = "not_started" | "oauth_ready" | "migrated";

export interface GatewayConnectionApiResource {
  id: string;
  brandId: string;
  regionId: string;
  connectorId: string;
  backendType: GatewayBackendType;
  displayName: string;
  status: Connection["status"];
  setupMode: GatewaySetupMode;
  runtimeStatus: GatewayRuntimeStatus;
  migrationStatus: GatewayMigrationStatus;
  source: GatewayEntitySource;
  configSummary: Record<string, string>;
  credentialRef?: string;
}

export interface GatewayApiResources {
  brands: Brand[];
  regions: Region[];
  connectors: Connector[];
  connections: GatewayConnectionApiResource[];
}

const credentialRefKeys = ["credential_ref", "credentialRef", "credential_group"] as const;
const unsafeCredentialRefPattern =
  /bearer|token|secret|password|private_key|BEGIN|ya29|shpat_|xox|sk_|\{|\}/i;

export function toGatewayApiResources(state: GatewayState): GatewayApiResources {
  return {
    brands: state.brands.map((brand) => ({ ...brand })),
    regions: state.regions.map((region) => ({ ...region })),
    connectors: state.connectors.map((connector) => ({ ...connector })),
    connections: state.connections.map((connection) => toConnectionApiResource(state, connection))
  };
}

export function toConnectionApiResource(state: GatewayState, connection: Connection): GatewayConnectionApiResource {
  const source = connectionSource(state, connection.id);
  const credentialRef = credentialRefFromConfigSummary(connection.configSummary);
  const resource: GatewayConnectionApiResource = {
    id: connection.id,
    brandId: connection.brandId,
    regionId: connection.regionId,
    connectorId: connection.connectorId,
    backendType: connection.backendType,
    displayName: connection.displayName,
    status: connection.status,
    setupMode: source === "gateway" ? "manual_ref" : "current",
    runtimeStatus: "metadata_only",
    migrationStatus: "not_started",
    source,
    configSummary: safeConfigSummary(connection.configSummary)
  };

  if (credentialRef) {
    resource.credentialRef = credentialRef;
  }

  return resource;
}

function connectionSource(state: GatewayState, connectionId: string): GatewayEntitySource {
  return (
    state.entityMeta?.find((meta) => meta.entityType === "connection" && meta.entityId === connectionId)?.source ??
    "fixture"
  );
}

function credentialRefFromConfigSummary(configSummary: Record<string, string>): string | undefined {
  for (const key of credentialRefKeys) {
    const value = configSummary[key];
    if (isSafeCredentialRef(value)) {
      return value.trim();
    }
  }

  return undefined;
}

function safeConfigSummary(configSummary: Record<string, string>): Record<string, string> {
  const safeSummary: Record<string, string> = {};

  for (const [key, value] of Object.entries(configSummary)) {
    if (isCredentialRefKey(key)) {
      if (isSafeCredentialRef(value)) {
        safeSummary[key] = value;
      }
      continue;
    }

    if (!unsafeCredentialRefPattern.test(value)) {
      safeSummary[key] = value;
    }
  }

  return safeSummary;
}

function isCredentialRefKey(key: string): key is (typeof credentialRefKeys)[number] {
  return (credentialRefKeys as readonly string[]).includes(key);
}

function isSafeCredentialRef(value: string | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 160 && !unsafeCredentialRefPattern.test(trimmed);
}
