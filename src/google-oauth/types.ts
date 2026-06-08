// src/google-oauth/types.ts

export type GoogleProduct = "ga4" | "gsc" | "google_ads" | "merchant_center";

export const googleProducts: GoogleProduct[] = ["ga4", "gsc", "google_ads", "merchant_center"];

export const googleProductScopes: Record<GoogleProduct, string> = {
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
  google_ads: "https://www.googleapis.com/auth/adwords",
  merchant_center: "https://www.googleapis.com/auth/content"
};

export type GoogleCredentialStatus = "connected" | "needs_reconnect" | "error";

export interface GoogleOAuthCredential {
  id: string;
  brandId: string;
  regionId: string;
  googleAccountEmail: string;
  products: GoogleProduct[];
  status: GoogleCredentialStatus;
  createdAt: string;
  updatedAt: string;
  tokenExpiryAt?: string;
  lastRefreshedAt?: string;
  errorDetail?: string;
}

export interface GoogleConnectionBinding {
  id: string;
  credentialId: string;
  connectionId: string;
  product: GoogleProduct;
  resourceId: string;
  resourceName?: string;
  createdAt: string;
}

export interface GoogleOAuthState {
  state: string;
  brandId: string;
  regionId: string;
  products: GoogleProduct[];
  bindings: Array<{ product: GoogleProduct; resourceId: string; resourceName?: string }>;
  createdAt: string;
  expiresAt: string;
}

export interface GoogleTokenPayload {
  accessToken: string;
  refreshToken?: string;
  tokenExpiryAt?: string;
  scope: string;
  googleAccountEmail: string;
}

export interface StartFlowInput {
  brandId: string;
  regionId: string;
  products: GoogleProduct[];
  bindings: Array<{ product: GoogleProduct; resourceId: string; resourceName?: string }>;
}

export interface StartFlowResult {
  redirectUrl: string;
  state: string;
}

export interface CompleteFlowInput {
  code: string;
  state: string;
}

export interface CompleteFlowResult {
  credential: GoogleOAuthCredential;
  bindings: GoogleConnectionBinding[];
}

// Maps connector slug -> Phase 4 GoogleProduct and the configSummary key
// the resourceId is read from. Single source of truth for derivation (D3).
export const googleConnectorBinding: Record<
  string,
  { product: GoogleProduct; configKey: string }
> = {
  "google-analytics-4":    { product: "ga4",             configKey: "property_id" },
  "google-search-console": { product: "gsc",             configKey: "site_url" },
  "google-ads":            { product: "google_ads",      configKey: "customer_id" },
  "merchant-center":       { product: "merchant_center", configKey: "merchant_center_id" }
};

export type GoogleLinkPlanStatus = "proposed" | "already_linked" | "unmatched";

export interface GoogleLinkPlanEntry {
  connectionId: string;
  brandId: string;
  regionId: string;
  connectorSlug: string;
  product: GoogleProduct;
  resourceId?: string;
  resourceName?: string;
  status: GoogleLinkPlanStatus;
  existingLinkId?: string;
  reason?: string;
}

export interface GoogleLinkPlan {
  accountId: string;
  googleAccountEmail: string;
  entries: GoogleLinkPlanEntry[];
  counts: { proposed: number; alreadyLinked: number; unmatched: number };
}

export interface GoogleLinkRequest {
  connectionIds?: string[];
}

export interface GoogleLinkResult {
  accountId: string;
  linked: Array<{ connectionId: string; linkId: string; credentialId: string }>;
  skipped: Array<{ connectionId: string; reason: string }>;
}
