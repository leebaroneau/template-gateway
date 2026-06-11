import crypto from "node:crypto";
import {
  decryptCredential,
  encryptCredential
} from "../shared/token-crypto.js";
import type { GatewayAccountStore } from "../account-credentials/store.js";
import { ALL_FACEBOOK_SCOPES } from "./types.js";
import type { FacebookTokenPayload } from "./types.js";

export interface FacebookOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  encryptionKey: string;
}

const FB_AUTH_URL = "https://www.facebook.com/v21.0/dialog/oauth";
const FB_TOKEN_URL = "https://graph.facebook.com/v21.0/oauth/access_token";
const FB_ME_URL = "https://graph.facebook.com/v21.0/me?fields=id,name";
const REFRESH_THRESHOLD_DAYS = 7;
const STATE_TTL_MS = 10 * 60 * 1000;

// TTL-based in-memory state store (same pattern as Google uses its DB store)
const pendingStates = new Map<string, number>();

export class FacebookOAuthAdapter {
  constructor(private readonly config: FacebookOAuthConfig) {}

  startAccountFlow(): { redirectUrl: string; state: string } {
    // Prune expired states
    const now = Date.now();
    for (const [s, exp] of pendingStates) {
      if (now > exp) pendingStates.delete(s);
    }

    const state = `fb_acct_${crypto.randomBytes(24).toString("base64url")}`;
    pendingStates.set(state, now + STATE_TTL_MS);

    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      state,
      response_type: "code",
      scope: ALL_FACEBOOK_SCOPES.join(",")
    });

    return { redirectUrl: `${FB_AUTH_URL}?${params}`, state };
  }

  private validateState(state: string): boolean {
    const exp = pendingStates.get(state);
    if (!exp || Date.now() > exp) return false;
    pendingStates.delete(state);
    return true;
  }

  private async exchangeCode(code: string, fetchFn: typeof fetch): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: this.config.redirectUri,
      code
    });
    const res = await fetchFn(`${FB_TOKEN_URL}?${params}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Facebook code exchange failed ${res.status}: ${text.slice(0, 256)}`);
    }
    const data = await res.json() as { access_token: string };
    return data.access_token;
  }

  async exchangeForLongLived(
    shortToken: string,
    fetchFn: typeof fetch = fetch
  ): Promise<{ accessToken: string; expiresAt: string }> {
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: shortToken
    });
    const res = await fetchFn(`${FB_TOKEN_URL}?${params}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Facebook long-lived token exchange failed ${res.status}: ${text.slice(0, 256)}`);
    }
    const data = await res.json() as { access_token: string; expires_in?: number };
    const expiresInSec = data.expires_in ?? 60 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
    return { accessToken: data.access_token, expiresAt };
  }

  private async getUserInfo(
    accessToken: string,
    fetchFn: typeof fetch
  ): Promise<{ id: string; name: string }> {
    const res = await fetchFn(`${FB_ME_URL}&access_token=${encodeURIComponent(accessToken)}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Facebook user info failed ${res.status}: ${text.slice(0, 256)}`);
    }
    return res.json() as Promise<{ id: string; name: string }>;
  }

  encryptPayload(payload: FacebookTokenPayload): string {
    return encryptCredential(payload, this.config.encryptionKey);
  }

  decryptPayload(encrypted: string): FacebookTokenPayload {
    return decryptCredential<FacebookTokenPayload>(encrypted, this.config.encryptionKey);
  }

  async completeAccountFlow(
    input: { code: string; state: string },
    accountStore: GatewayAccountStore,
    fetchFn: typeof fetch = fetch
  ): Promise<{ account: ReturnType<GatewayAccountStore["getAccount"]> }> {
    if (!this.validateState(input.state)) {
      throw new Error("Invalid or expired OAuth state");
    }

    const shortToken = await this.exchangeCode(input.code, fetchFn);
    const { accessToken, expiresAt } = await this.exchangeForLongLived(shortToken, fetchFn);
    const userInfo = await this.getUserInfo(accessToken, fetchFn);

    const payload: FacebookTokenPayload = {
      service: "facebook",
      accessToken,
      externalAccountId: userInfo.id,
      scope: ALL_FACEBOOK_SCOPES.join(",")
    };

    const encryptedPayload = this.encryptPayload(payload);

    const accountId = accountStore.upsertAccount({
      service: "facebook",
      externalAccountId: userInfo.id,
      displayName: userInfo.name,
      encryptedPayload,
      scope: ALL_FACEBOOK_SCOPES.join(","),
      status: "connected",
      tokenExpiryAt: expiresAt
    });

    return { account: accountStore.getAccount(accountId) };
  }

  async getAccountAccessToken(
    accountId: string,
    accountStore: GatewayAccountStore,
    fetchFn: typeof fetch = fetch
  ): Promise<string> {
    const account = accountStore.getAccount(accountId);
    if (!account) throw new Error(`Facebook account not found: ${accountId}`);

    const payload = this.decryptPayload(account.encryptedPayload);

    // Proactively extend if within threshold of expiry
    if (account.tokenExpiryAt) {
      const expiryMs = new Date(account.tokenExpiryAt).getTime();
      const thresholdMs = REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
      if (Date.now() > expiryMs - thresholdMs) {
        try {
          const refreshed = await this.exchangeForLongLived(payload.accessToken, fetchFn);
          const newPayload: FacebookTokenPayload = { ...payload, accessToken: refreshed.accessToken };
          accountStore.updateAccountPayload(accountId, this.encryptPayload(newPayload), refreshed.expiresAt);
          return refreshed.accessToken;
        } catch {
          // Fall through and use existing token
        }
      }
    }

    return payload.accessToken;
  }
}
