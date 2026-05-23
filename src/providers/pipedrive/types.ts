export interface PipedriveProviderConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  /**
   * Fallback workspace subdomain (e.g. `acme` for `acme.pipedrive.com`).
   * Only consulted when the OAuth token response omits `api_domain`.
   */
  companyDomain?: string;
  allowedDomains: string[];
  tokenStorePath: string;
  tokenStoreKey?: string;
  /** Pipedrive OAuth scopes; left empty if the app uses the default scope set. */
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
}

export interface PipedriveActor {
  actorId?: string;
  actorEmail: string;
  actorName?: string;
}

export interface PipedriveTokenPayload {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  /** Pipedrive returns the workspace API base URL — store it so refresh + downstream calls can target the right host. */
  apiDomain?: string;
  expiresAt?: string;
}

export interface PipedriveBinding {
  actorId: string;
  actorEmail: string;
  actorName?: string;
  provider: "pipedrive";
  /** Email of the Pipedrive user the actor authorized as (lower-cased). */
  upstreamLogin: string;
  upstreamName?: string;
  /** Pipedrive workspace api_domain used to call the API (e.g. `https://acme.pipedrive.com`). */
  apiDomain?: string;
  scope?: string;
  scopes: string[];
  expiresAt?: string;
  tokenCiphertext: string;
  status: "connected" | "reconnect_required";
  createdAt: string;
  updatedAt: string;
}

export interface PipedriveStatus {
  provider: "pipedrive";
  status: "connected" | "reconnect_required" | "disconnected";
  actorId: string;
  actorEmail?: string;
  actorName?: string;
  upstreamLogin?: string;
  upstreamName?: string;
  apiDomain?: string;
  scopes: string[];
  expiresAt?: string;
}
