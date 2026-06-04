import crypto from "node:crypto";
import { normalizeShopDomain, verifyCallbackHmac } from "./hmac.js";
import { encryptCredential, decryptCredential } from "./crypto.js";
import type { GatewayShopifyStore } from "./store.js";
import type {
  ShopifyOAuthCredential,
  ShopifyOAuthState,
  StartFlowInput,
  StartFlowResult,
  CompleteFlowInput,
  CompleteFlowResult,
} from "./types.js";

export interface ShopifyOAuthConfig {
  apiKey: string;
  apiSecret: string;
  redirectUri: string;
  encryptionKey: string;
  scopes: string[];
}

const STATE_TTL_MINUTES = 10;

interface TokenResponse {
  access_token: string;
  scope?: string;
}

export class ShopifyOAuthAdapter {
  constructor(
    private readonly config: ShopifyOAuthConfig,
    private readonly store: GatewayShopifyStore
  ) {}

  startFlow(input: StartFlowInput): StartFlowResult {
    const shop = normalizeShopDomain(input.shop);
    if (!shop) throw new Error(`Invalid shop domain: ${input.shop}`);

    const state = crypto.randomBytes(24).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STATE_TTL_MINUTES * 60 * 1000).toISOString();

    const scopes = input.scopes ?? this.config.scopes;
    this.store.saveOAuthState({
      state,
      shop,
      scopes,
      expiresAt,
    });

    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.searchParams.set("client_id", this.config.apiKey);
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("state", state);
    // No grant_options[] — offline token

    return { redirectUrl: url.toString(), state };
  }

  async completeFlow(
    input: CompleteFlowInput,
    fetchFn: typeof fetch = fetch
  ): Promise<CompleteFlowResult> {
    // 1. Verify callback HMAC (proves Shopify origin) — before trusting anything
    if (!verifyCallbackHmac(input.queryParams, this.config.apiSecret)) {
      throw new Error("Invalid HMAC");
    }

    // 2. Prune expired states
    this.store.pruneExpiredStates();

    // 3. Look up + consume state (single-use)
    const oauthState = this.store.getOAuthState(input.state);
    if (!oauthState) throw new Error("Invalid or expired OAuth state");
    this.store.deleteOAuthState(input.state);

    // 4. Validate expiry + shop match
    if (new Date(oauthState.expiresAt) < new Date()) {
      throw new Error("Invalid or expired OAuth state");
    }
    if (oauthState.shop !== input.shop) {
      throw new Error("Invalid or expired OAuth state");
    }

    // 5. Exchange code for token
    const tokenResponse = await this.exchangeCode(input.shop, input.code, fetchFn);

    // 6. Verify required scopes present in returned scope
    const returnedScopes = (tokenResponse.scope ?? "").split(",").map((s) => s.trim());
    for (const requiredScope of oauthState.scopes) {
      if (!returnedScopes.includes(requiredScope)) {
        throw new Error(`Missing required scope: ${requiredScope}`);
      }
    }

    // 7. Encrypt and store
    const payload = {
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope ?? "",
      shop: input.shop,
    };
    const encryptedPayload = encryptCredential(payload, this.config.encryptionKey);
    const id = this.store.saveCredential({
      shop: input.shop,
      encryptedPayload,
      scope: tokenResponse.scope ?? "",
      status: "connected",
    });

    // 8. Return stripped credential
    const stored = this.store.getCredential(id);
    if (!stored) throw new Error("Failed to retrieve stored credential");
    const { encryptedPayload: _ep, ...credential } = stored;
    return { credential };
  }

  async getCredentialStatus(
    id: string
  ): Promise<ShopifyOAuthCredential> {
    const stored = this.store.getCredential(id);
    if (!stored) throw new Error(`Credential not found: ${id}`);
    const { encryptedPayload: _ep, ...credential } = stored;
    return credential;
  }

  handleUninstall(shop: string): void {
    this.store.updateCredentialStatus(shop, "needs_reconnect");
  }

  handleShopRedact(shop: string): void {
    this.store.deleteCredentialByShop(shop);
  }

  private async exchangeCode(
    shop: string,
    code: string,
    fetchFn: typeof fetch
  ): Promise<TokenResponse> {
    const response = await fetchFn(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: this.config.apiKey,
        client_secret: this.config.apiSecret,
        code,
      }).toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Token exchange failed: ${response.status} ${text.slice(0, 512)}`);
    }

    return response.json() as Promise<TokenResponse>;
  }
}
