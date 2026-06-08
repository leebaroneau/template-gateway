export type OAuthService = "google" | "shopify";
export const oauthServices: OAuthService[] = ["google", "shopify"];

export type OAuthAccountStatus = "connected" | "needs_reconnect" | "error";

export interface OAuthAccountTokenPayload {
  service: OAuthService;
  refreshToken?: string;
  accessToken?: string;
  scope?: string;
  externalAccountId: string;
}

export interface OAuthAccount {
  id: string;
  service: OAuthService;
  externalAccountId: string;
  displayName?: string;
  scope?: string;
  status: OAuthAccountStatus;
  tokenExpiryAt?: string;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
  errorDetail?: string;
}

export interface OAuthAccountLink {
  id: string;
  accountId: string;
  brandId: string;
  regionId: string;
  connectorSlug: string;
  connectionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAccountInput {
  service: OAuthService;
  externalAccountId: string;
  displayName?: string;
  encryptedPayload: string;
  scope?: string;
  status: OAuthAccountStatus;
  tokenExpiryAt?: string;
}

export interface LinkAccountInput {
  accountId: string;
  brandId: string;
  regionId: string;
  connectorSlug: string;
  connectionId?: string;
}

export interface AccountScopeQuery {
  service: OAuthService;
  brandId: string;
  regionId: string;
  connectorSlug: string;
}
