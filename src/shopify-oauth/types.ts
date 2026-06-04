// src/shopify-oauth/types.ts

export type ShopifyCredentialStatus = 'connected' | 'needs_reconnect' | 'error';

export interface ShopifyTokenPayload {
  accessToken: string;
  scope: string;
  shop: string;
}

// ShopifyOAuthCredential is the public-facing credential (no encryptedPayload)
export interface ShopifyOAuthCredential {
  id: string;
  shop: string;
  scope: string;
  status: ShopifyCredentialStatus;
  createdAt: string;
  updatedAt: string;
  errorDetail?: string;
}

export interface ShopifyOAuthState {
  state: string;
  shop: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
}

export interface StartFlowInput {
  shop: string;
  scopes?: string[];
}

export interface StartFlowResult {
  redirectUrl: string;
  state: string;
}

export interface CompleteFlowInput {
  code: string;
  state: string;
  shop: string;
  hmac: string;
  queryParams: Record<string, string>;
}

export interface CompleteFlowResult {
  credential: ShopifyOAuthCredential;
}
