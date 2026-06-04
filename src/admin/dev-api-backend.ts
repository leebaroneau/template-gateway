import { AdminBackendError } from "./backend-error.js";
import { mapDevApiBrandsToGatewayState } from "./dev-api-mapper.js";
import type { DevApiBrandsResponse } from "./dev-api-types.js";
import type {
  ApiKey,
  Brand,
  Connection,
  CreateBrandInput,
  CreateConnectionInput,
  CreateRegionInput,
  GatewayConnectionBackend,
  GatewayState,
  ResetEntityInput,
  UpdateBrandInput,
  UpdateConnectionInput,
  UpdateRegionInput,
  Region
} from "./types.js";

export interface DevApiBrandsSource {
  fetchBrands(): Promise<DevApiBrandsResponse>;
}

export class DevApiGatewayBackend implements GatewayConnectionBackend {
  constructor(private readonly client: DevApiBrandsSource) {}

  async snapshot(): Promise<GatewayState> {
    return mapDevApiBrandsToGatewayState(await this.client.fetchBrands());
  }

  createBrand(_input: CreateBrandInput): Promise<Brand> {
    return Promise.reject(readOnlyError("create brand"));
  }

  createRegion(_input: CreateRegionInput): Promise<Region> {
    return Promise.reject(readOnlyError("create region"));
  }

  createConnection(_input: CreateConnectionInput): Promise<Connection> {
    return Promise.reject(readOnlyError("create connection"));
  }

  updateBrand(_brandId: string, _input: UpdateBrandInput): Promise<Brand> {
    return Promise.reject(readOnlyError("update brand"));
  }

  updateRegion(_regionId: string, _input: UpdateRegionInput): Promise<Region> {
    return Promise.reject(readOnlyError("update region"));
  }

  updateConnection(_connectionId: string, _input: UpdateConnectionInput): Promise<Connection> {
    return Promise.reject(readOnlyError("update connection"));
  }

  resetEntity(_input: ResetEntityInput): Promise<GatewayState> {
    return Promise.reject(readOnlyError("reset entity"));
  }

  testConnection(_connectionId: string): Promise<Connection> {
    return Promise.reject(readOnlyError("test connection"));
  }

  rotateApiKey(_clientId: string, _keyId: string): Promise<ApiKey> {
    return Promise.reject(readOnlyError("rotate API key"));
  }

  revokeApiKey(_clientId: string, _keyId: string): Promise<ApiKey> {
    return Promise.reject(readOnlyError("revoke API key"));
  }
}

function readOnlyError(action: string): AdminBackendError {
  return new AdminBackendError(409, `Dev API read-through mode is read-only in Phase 1; cannot ${action}.`);
}
