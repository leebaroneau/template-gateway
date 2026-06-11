import type { GatewayAccountStore } from "../account-credentials/store.js";
import type { GatewayGoogleStore } from "./store.js";
import type { GoogleOAuthAdapter } from "./adapter.js";
import type { GoogleProduct } from "./types.js";

export interface PropertyEntry {
  id: string;
  displayName: string;
  url?: string;
  alreadyClaimed: boolean;
  claimedByConnectionId?: string;
}

export class GooglePropertyEnumerator {
  constructor(
    private readonly adapter: GoogleOAuthAdapter,
    private readonly accountStore: GatewayAccountStore,
    private readonly googleStore: GatewayGoogleStore,
    private readonly googleAdsDevToken?: string
  ) {}

  async listProperties(
    accountId: string,
    product: GoogleProduct,
    claimedResourceIds: Map<string, string> = new Map(),
    fetchFn: typeof fetch = fetch
  ): Promise<PropertyEntry[]> {
    const accessToken = await this.adapter.getAccountAccessToken(accountId, this.accountStore, fetchFn);

    switch (product) {
      case "ga4":             return this.listGA4(accessToken, claimedResourceIds, fetchFn);
      case "gsc":             return this.listGSC(accessToken, claimedResourceIds, fetchFn);
      case "google_ads":      return this.listAds(accessToken, claimedResourceIds, fetchFn);
      case "merchant_center": return this.listMerchant(accessToken, claimedResourceIds, fetchFn);
      case "google_business": return this.listGBP(accessToken, claimedResourceIds, fetchFn);
      default:                return [];
    }
  }

  private mark(id: string, claimedResourceIds: Map<string, string>): Pick<PropertyEntry, "alreadyClaimed" | "claimedByConnectionId"> {
    const claimedBy = claimedResourceIds.get(id);
    return claimedBy
      ? { alreadyClaimed: true, claimedByConnectionId: claimedBy }
      : { alreadyClaimed: false };
  }

  private authHeader(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
  }

  private async getJson(url: string, headers: Record<string, string>, fetchFn: typeof fetch): Promise<any> {
    const response = await fetchFn(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google API error ${response.status}: ${text.slice(0, 512)}`);
    }
    return response.json();
  }

  private async listGA4(
    accessToken: string,
    claimedResourceIds: Map<string, string>,
    fetchFn: typeof fetch
  ): Promise<PropertyEntry[]> {
    const headers = this.authHeader(accessToken);
    const accountsData = await this.getJson(
      "https://analyticsadmin.googleapis.com/v1beta/accounts?pageSize=200",
      headers,
      fetchFn
    );
    const accounts: any[] = accountsData.accounts ?? [];
    const results = await Promise.all(
      accounts.map(async (account) => {
        const accountId = String(account.name ?? "").replace("accounts/", "");
        if (!accountId) return [];
        try {
          const data = await this.getJson(
            `https://analyticsadmin.googleapis.com/v1beta/properties?filter=parent:accounts/${accountId}&pageSize=200`,
            headers,
            fetchFn
          );
          return ((data.properties ?? []) as any[]).map((p) => ({
            id: String(p.name),
            displayName: String(p.displayName ?? p.name),
            url: p.websiteUri ? String(p.websiteUri) : undefined,
            ...this.mark(String(p.name), claimedResourceIds)
          }));
        } catch { return []; }
      })
    );
    return results.flat();
  }

  private async listGSC(
    accessToken: string,
    claimedResourceIds: Map<string, string>,
    fetchFn: typeof fetch
  ): Promise<PropertyEntry[]> {
    const data = await this.getJson(
      "https://www.googleapis.com/webmasters/v3/sites",
      this.authHeader(accessToken),
      fetchFn
    );
    return ((data.siteEntry ?? []) as any[]).map((s) => ({
      id: String(s.siteUrl),
      displayName: String(s.siteUrl),
      url: String(s.siteUrl),
      ...this.mark(String(s.siteUrl), claimedResourceIds)
    }));
  }

  private async listAds(
    accessToken: string,
    claimedResourceIds: Map<string, string>,
    fetchFn: typeof fetch
  ): Promise<PropertyEntry[]> {
    if (!this.googleAdsDevToken) return [];

    const headers: Record<string, string> = {
      ...this.authHeader(accessToken),
      "developer-token": this.googleAdsDevToken
    };

    const listData = await this.getJson(
      "https://googleads.googleapis.com/v19/customers:listAccessibleCustomers",
      headers,
      fetchFn
    );

    const resourceNames: string[] = listData.resourceNames ?? [];
    const entries: PropertyEntry[] = [];

    for (const resourceName of resourceNames) {
      const customerId = resourceName.split("/")[1];
      if (!customerId) continue;
      try {
        const detail = await this.getJson(
          `https://googleads.googleapis.com/v19/customers/${customerId}/googleAds:search`,
          {
            ...headers,
            "Content-Type": "application/json"
          },
          (url, init) => fetchFn(url, {
            ...init,
            method: "POST",
            body: JSON.stringify({ query: "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1" })
          })
        );
        const row = detail.results?.[0]?.customer;
        entries.push({
          id: String(customerId),
          displayName: row?.descriptiveName ? String(row.descriptiveName) : `Customer ${customerId}`,
          ...this.mark(customerId, claimedResourceIds)
        });
      } catch {
        entries.push({
          id: String(customerId),
          displayName: `Customer ${customerId}`,
          ...this.mark(customerId, claimedResourceIds)
        });
      }
    }

    return entries;
  }

  private async listMerchant(
    accessToken: string,
    claimedResourceIds: Map<string, string>,
    fetchFn: typeof fetch
  ): Promise<PropertyEntry[]> {
    const authData = await this.getJson(
      "https://shoppingcontent.googleapis.com/content/v2.1/accounts/authinfo",
      this.authHeader(accessToken),
      fetchFn
    );
    const merchantIds: string[] = ((authData.accountIdentifiers ?? []) as any[])
      .map((a) => String(a.merchantId))
      .filter(Boolean);

    const entries: PropertyEntry[] = [];
    for (const merchantId of merchantIds) {
      try {
        const detail = await this.getJson(
          `https://shoppingcontent.googleapis.com/content/v2.1/${merchantId}/accounts/${merchantId}`,
          this.authHeader(accessToken),
          fetchFn
        );
        entries.push({
          id: merchantId,
          displayName: String(detail.name ?? merchantId),
          url: detail.websiteUrl ? String(detail.websiteUrl) : undefined,
          ...this.mark(merchantId, claimedResourceIds)
        });
      } catch {
        entries.push({ id: merchantId, displayName: `Merchant ${merchantId}`, ...this.mark(merchantId, claimedResourceIds) });
      }
    }
    return entries;
  }

  private async listGBP(
    accessToken: string,
    claimedResourceIds: Map<string, string>,
    fetchFn: typeof fetch
  ): Promise<PropertyEntry[]> {
    const accountsData = await this.getJson(
      "https://mybusinessbusinessinformation.googleapis.com/v1/accounts",
      this.authHeader(accessToken),
      fetchFn
    );
    const accounts: any[] = accountsData.accounts ?? [];
    const entries: PropertyEntry[] = [];

    for (const account of accounts) {
      const accountName = String(account.name);
      try {
        const locData = await this.getJson(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,websiteUri`,
          this.authHeader(accessToken),
          fetchFn
        );
        for (const loc of locData.locations ?? []) {
          entries.push({
            id: String(loc.name),
            displayName: String(loc.title ?? loc.name),
            url: loc.websiteUri ? String(loc.websiteUri) : undefined,
            ...this.mark(String(loc.name), claimedResourceIds)
          });
        }
      } catch {
        // Skip accounts with inaccessible locations
      }
    }

    return entries;
  }
}
