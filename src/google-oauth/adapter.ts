import crypto from "node:crypto";
import { decryptCredential, encryptCredential } from "./crypto.js";
import type { GatewayGoogleStore } from "./store.js";
import type {
  CompleteFlowInput,
  CompleteFlowResult,
  GoogleConnectionBinding,
  GoogleOAuthCredential,
  GoogleOAuthState,
  GoogleProduct,
  GoogleTokenPayload,
  StartFlowInput,
  StartFlowResult
} from "./types.js";
import { googleProductScopes } from "./types.js";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
}

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const REFRESH_THRESHOLD_SECONDS = 5 * 60;
const STATE_TTL_MINUTES = 10;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope: string;
}

interface UserInfoResponse {
  email: string;
  sub: string;
}

export class GoogleOAuthAdapter {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly store: GatewayGoogleStore
  ) {}

  startFlow(input: StartFlowInput): StartFlowResult {
    const state = crypto.randomBytes(24).toString("base64url");
    const now = Date.now();
    const oauthState: GoogleOAuthState = {
      state,
      brandId: input.brandId,
      regionId: input.regionId,
      products: input.products,
      bindings: input.bindings,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + STATE_TTL_MINUTES * 60 * 1000).toISOString()
    };
    this.store.saveOAuthState(oauthState);

    const scopes = [
      "openid",
      "email",
      "profile",
      ...input.products.map((p) => googleProductScopes[p])
    ];

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: scopes.join(" "),
      state
    });

    const redirectUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
    return { redirectUrl, state };
  }

  async completeFlow(
    input: CompleteFlowInput,
    fetchFn: typeof fetch = fetch
  ): Promise<CompleteFlowResult> {
    this.store.pruneExpiredStates();

    const oauthState = this.store.getOAuthState(input.state);
    if (!oauthState) {
      throw new Error("Invalid or expired OAuth state");
    }

    if (new Date(oauthState.expiresAt).getTime() < Date.now()) {
      this.store.deleteOAuthState(input.state);
      throw new Error("Invalid or expired OAuth state");
    }

    this.store.deleteOAuthState(input.state);

    const tokenResponse = await this.exchangeCode(input.code, fetchFn);
    const userInfo = await this.fetchUserInfo(tokenResponse.access_token, fetchFn);

    const tokenExpiryAt = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : undefined;

    const tokenPayload: GoogleTokenPayload = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenExpiryAt,
      scope: tokenResponse.scope,
      googleAccountEmail: userInfo.email
    };

    const encryptedPayload = encryptCredential(tokenPayload, this.config.encryptionKey);

    const credId = this.store.saveCredential({
      brandId: oauthState.brandId,
      regionId: oauthState.regionId,
      googleAccountEmail: userInfo.email,
      encryptedPayload,
      tokenExpiryAt,
      products: oauthState.products,
      status: "connected"
    });

    const bindings: GoogleConnectionBinding[] = [];
    for (const binding of oauthState.bindings) {
      const connectionId = `google_${binding.product}_${oauthState.brandId}_${oauthState.regionId}_${credId.slice(-8)}`;
      const bindingId = this.store.saveBinding({
        credentialId: credId,
        connectionId,
        product: binding.product,
        resourceId: binding.resourceId,
        resourceName: binding.resourceName
      });
      bindings.push({
        id: bindingId,
        credentialId: credId,
        connectionId,
        product: binding.product,
        resourceId: binding.resourceId,
        resourceName: binding.resourceName,
        createdAt: new Date().toISOString()
      });
    }

    const credential = this.store.getCredential(credId);
    if (!credential) {
      throw new Error("Failed to retrieve saved credential");
    }

    const { encryptedPayload: _omit, ...credentialWithoutPayload } = credential;

    return {
      credential: credentialWithoutPayload as GoogleOAuthCredential,
      bindings
    };
  }

  async refreshTokenIfNeeded(
    credentialId: string,
    fetchFn: typeof fetch = fetch
  ): Promise<boolean> {
    const credential = this.store.getCredential(credentialId);
    if (!credential) {
      throw new Error(`Credential not found: ${credentialId}`);
    }

    if (!credential.tokenExpiryAt) {
      return false;
    }

    const expiryMs = new Date(credential.tokenExpiryAt).getTime();
    const nowMs = Date.now();

    if (expiryMs - nowMs > REFRESH_THRESHOLD_SECONDS * 1000) {
      return false;
    }

    let tokenPayload: GoogleTokenPayload;
    try {
      tokenPayload = decryptCredential(credential.encryptedPayload, this.config.encryptionKey);
    } catch {
      this.store.updateCredentialStatus(
        credentialId,
        "error",
        "Failed to decrypt credential for refresh"
      );
      return false;
    }

    if (!tokenPayload.refreshToken) {
      this.store.updateCredentialStatus(
        credentialId,
        "needs_reconnect",
        "No refresh token available"
      );
      return false;
    }

    try {
      const params = new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: tokenPayload.refreshToken,
        grant_type: "refresh_token"
      });

      const response = await fetchFn(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });

      if (!response.ok) {
        const text = await response.text();
        this.store.updateCredentialStatus(
          credentialId,
          "needs_reconnect",
          `Token refresh failed: ${response.status} ${text.slice(0, 512)}`
        );
        return false;
      }

      const data = (await response.json()) as TokenResponse;
      const newExpiryAt = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : credential.tokenExpiryAt;

      const newPayload: GoogleTokenPayload = {
        accessToken: data.access_token,
        refreshToken: tokenPayload.refreshToken,
        tokenExpiryAt: newExpiryAt,
        scope: data.scope ?? tokenPayload.scope,
        googleAccountEmail: tokenPayload.googleAccountEmail
      };

      const newEncrypted = encryptCredential(newPayload, this.config.encryptionKey);
      this.store.updateCredentialPayload(credentialId, newEncrypted, newExpiryAt);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.updateCredentialStatus(credentialId, "needs_reconnect", message);
      return false;
    }
  }

  async getCredentialStatus(
    credentialId: string,
    fetchFn: typeof fetch = fetch
  ): Promise<GoogleOAuthCredential> {
    await this.refreshTokenIfNeeded(credentialId, fetchFn);
    const credential = this.store.getCredential(credentialId);
    if (!credential) {
      throw new Error(`Credential not found: ${credentialId}`);
    }
    const { encryptedPayload: _omit, ...credentialWithoutPayload } = credential;
    return credentialWithoutPayload as GoogleOAuthCredential;
  }

  private async exchangeCode(
    code: string,
    fetchFn: typeof fetch
  ): Promise<TokenResponse> {
    const params = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code"
    });

    const response = await fetchFn(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${text.slice(0, 512)}`);
    }

    return (await response.json()) as TokenResponse;
  }

  private async fetchUserInfo(
    accessToken: string,
    fetchFn: typeof fetch
  ): Promise<UserInfoResponse> {
    const response = await fetchFn(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`UserInfo fetch failed: ${response.status} ${text.slice(0, 512)}`);
    }

    return (await response.json()) as UserInfoResponse;
  }
}
