export interface MicrosoftProviderConfig {
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  redirectUri: string;
  allowedTenants: string[];
  allowedDomains: string[];
  tokenStorePath: string;
  tokenStoreKey?: string;
  scopes: string[];
  graphRequestPathAllowlist: string[];
  sendEmailEnabled: boolean;
}

export interface MicrosoftActor {
  actorId?: string;
  actorEmail: string;
  actorName?: string;
}

export interface MicrosoftTokenPayload {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope: string;
  expiresAt?: string;
  accountId?: string;
}

export interface MicrosoftBinding {
  actorId: string;
  actorEmail: string;
  actorName?: string;
  provider: "microsoft";
  upstreamLogin: string;
  tenantId: string;
  scope: string;
  scopes: string[];
  expiresAt?: string;
  tokenCiphertext: string;
  status: "connected" | "reconnect_required";
  createdAt: string;
  updatedAt: string;
}

export interface MicrosoftStatus {
  provider: "microsoft";
  status: "connected" | "reconnect_required" | "disconnected";
  actorId: string;
  actorEmail?: string;
  actorName?: string;
  upstreamLogin?: string;
  tenantId?: string;
  scopes: string[];
  expiresAt?: string;
}
