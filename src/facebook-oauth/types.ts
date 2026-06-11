export type FacebookProduct = "facebook_page" | "meta_ads" | "instagram_account" | "meta_leads";

export interface FacebookConnectorBindingEntry {
  product: FacebookProduct;
  configKey: string;
}

export const facebookConnectorBinding: Record<string, FacebookConnectorBindingEntry> = {
  "facebook-page":      { product: "facebook_page",      configKey: "page_id" },
  "meta-ads":           { product: "meta_ads",            configKey: "ad_account_id" },
  "instagram-account":  { product: "instagram_account",   configKey: "instagram_account_id" },
  "meta-leads":         { product: "meta_leads",          configKey: "page_id" }
};

// All scopes requested in a single consent — one auth covers all products
export const ALL_FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "ads_read",
  "business_management",
  "instagram_basic",
  "instagram_manage_insights",
  "leads_retrieval"
];

export interface FacebookTokenPayload {
  service: "facebook";
  accessToken: string;
  externalAccountId: string;
  scope?: string;
}
