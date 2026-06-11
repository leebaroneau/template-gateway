import type { GatewayAccountStore } from "../account-credentials/store.js";
import type { FacebookOAuthAdapter } from "./adapter.js";
import type { FacebookProduct } from "./types.js";

export interface FacebookPropertyEntry {
  id: string;
  displayName: string;
  url?: string;
  category?: string;
  alreadyClaimed: boolean;
  claimedByConnectionId?: string;
}

const FB_GRAPH = "https://graph.facebook.com/v21.0";

export class FacebookPropertyEnumerator {
  constructor(
    private readonly adapter: FacebookOAuthAdapter,
    private readonly accountStore: GatewayAccountStore
  ) {}

  async listProperties(
    accountId: string,
    product: FacebookProduct,
    claimedResourceIds: Map<string, string> = new Map(),
    fetchFn: typeof fetch = fetch
  ): Promise<FacebookPropertyEntry[]> {
    const accessToken = await this.adapter.getAccountAccessToken(accountId, this.accountStore, fetchFn);
    switch (product) {
      case "facebook_page": return this.listPages(accessToken, claimedResourceIds, fetchFn);
      case "meta_leads":    return this.listPages(accessToken, claimedResourceIds, fetchFn);
      case "meta_ads":      return this.listAdAccounts(accessToken, claimedResourceIds, fetchFn);
      case "instagram_account": return this.listInstagramAccounts(accessToken, claimedResourceIds, fetchFn);
      default: return [];
    }
  }

  private mark(id: string, claimed: Map<string, string>): Pick<FacebookPropertyEntry, "alreadyClaimed" | "claimedByConnectionId"> {
    const by = claimed.get(id);
    return by ? { alreadyClaimed: true, claimedByConnectionId: by } : { alreadyClaimed: false };
  }

  private async getJson(url: string, fetchFn: typeof fetch): Promise<any> {
    const res = await fetchFn(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Facebook API error ${res.status}: ${text.slice(0, 512)}`);
    }
    return res.json();
  }

  private async listPages(
    accessToken: string,
    claimed: Map<string, string>,
    fetchFn: typeof fetch
  ): Promise<FacebookPropertyEntry[]> {
    const url = `${FB_GRAPH}/me/accounts?fields=id,name,link,category&limit=200&access_token=${encodeURIComponent(accessToken)}`;
    const data = await this.getJson(url, fetchFn);
    return ((data.data ?? []) as any[]).map((p) => ({
      id: String(p.id),
      displayName: String(p.name ?? p.id),
      url: p.link ? String(p.link) : undefined,
      category: p.category ? String(p.category) : undefined,
      ...this.mark(String(p.id), claimed)
    }));
  }

  private async listAdAccounts(
    accessToken: string,
    claimed: Map<string, string>,
    fetchFn: typeof fetch
  ): Promise<FacebookPropertyEntry[]> {
    const url = `${FB_GRAPH}/me/adaccounts?fields=id,name,account_id,account_status&limit=200&access_token=${encodeURIComponent(accessToken)}`;
    const data = await this.getJson(url, fetchFn);
    return ((data.data ?? []) as any[]).map((a) => {
      const id = String(a.account_id ?? a.id).replace(/^act_/, "");
      return {
        id,
        displayName: String(a.name ?? id),
        ...this.mark(id, claimed)
      };
    });
  }

  private async listInstagramAccounts(
    accessToken: string,
    claimed: Map<string, string>,
    fetchFn: typeof fetch
  ): Promise<FacebookPropertyEntry[]> {
    const url = `${FB_GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,name,username}&limit=200&access_token=${encodeURIComponent(accessToken)}`;
    const data = await this.getJson(url, fetchFn);
    const entries: FacebookPropertyEntry[] = [];
    for (const page of (data.data ?? []) as any[]) {
      const ig = page.instagram_business_account;
      if (!ig?.id) continue;
      const id = String(ig.id);
      entries.push({
        id,
        displayName: ig.name ? String(ig.name) : ig.username ? `@${String(ig.username)}` : id,
        ...this.mark(id, claimed)
      });
    }
    return entries;
  }
}
