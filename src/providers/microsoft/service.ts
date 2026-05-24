import type { MicrosoftOAuthStateStore } from "./state-store.js";
import type { MicrosoftTokenStore } from "./token-store.js";
import type { MicrosoftActor, MicrosoftProviderConfig, MicrosoftStatus } from "./types.js";

interface MicrosoftProviderServiceOptions {
  config: MicrosoftProviderConfig;
  stateStore: MicrosoftOAuthStateStore;
  tokenStore: MicrosoftTokenStore;
  fetch?: typeof fetch;
}

interface ConnectUrlResult {
  provider: "microsoft";
  authorizeUrl: string;
  actor: MicrosoftActor;
  expiresAt: string;
}

interface CallbackInput {
  state: string;
  code: string;
}

interface CallbackResult {
  provider: "microsoft";
  status: "connected";
  actor: MicrosoftActor;
  upstreamLogin: string;
  tenantId: string;
  scopes: string[];
  expiresAt?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface ValidAccessToken {
  accessToken: string;
  scopes: string[];
  upstreamLogin: string;
  tenantId: string;
}

interface MicrosoftProfileResponse {
  id?: string;
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

export class MicrosoftProviderService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MicrosoftProviderServiceOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async createConnectUrl(actor: MicrosoftActor): Promise<ConnectUrlResult> {
    this.assertConfigured();
    const normalizedActor = normalizeActor(actor);
    assertAllowedEmailDomain(normalizedActor.actorEmail, this.options.config.allowedDomains, "Microsoft actor email");
    const state = await this.options.stateStore.create(normalizedActor);
    return {
      provider: "microsoft",
      authorizeUrl: this.authorizationUrl(state.state),
      actor: normalizedActor,
      expiresAt: state.expiresAt
    };
  }

  async completeCallback(input: CallbackInput): Promise<CallbackResult> {
    this.assertConfigured();
    const state = await this.options.stateStore.consume(input.state);
    if (!state) {
      throw new Error("Unknown or expired Microsoft OAuth state.");
    }

    const token = await this.exchangeCode(input.code);
    if (!token.access_token) {
      throw new Error("Microsoft token response did not include an access token.");
    }

    const profile = await this.fetchProfile(token.access_token);
    const upstreamLogin = normalizeLogin(profile.mail || profile.userPrincipalName);
    if (!upstreamLogin) {
      throw new Error("Microsoft profile did not include mail or userPrincipalName.");
    }
    assertAllowedEmailDomain(upstreamLogin, this.options.config.allowedDomains, "Microsoft login");

    const scope = token.scope || this.options.config.scopes.join(" ");
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : undefined;
    const status = await this.options.tokenStore.saveConnectedBinding({
      actorId: state.actorId ?? state.actorEmail,
      actorEmail: state.actorEmail,
      actorName: state.actorName,
      upstreamLogin,
      tenantId: this.options.config.tenantId!,
      scope,
      expiresAt,
      payload: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenType: token.token_type || "Bearer",
        scope,
        expiresAt,
        accountId: profile.id
      }
    });

    return {
      provider: "microsoft",
      status: "connected",
      actor: {
        actorId: status.actorId,
        actorEmail: status.actorEmail!,
        actorName: status.actorName
      },
      upstreamLogin: status.upstreamLogin!,
      tenantId: status.tenantId!,
      scopes: status.scopes,
      expiresAt: status.expiresAt
    };
  }

  async status(actorIdOrEmail: string): Promise<MicrosoftStatus> {
    return this.options.tokenStore.status(actorIdOrEmail);
  }

  listTools(): Array<{ name: string; requiredScope: string; readOnly: boolean }> {
    return [
      { name: "outlook_list_messages", requiredScope: "Mail.Read", readOnly: true },
      { name: "calendar_list_events", requiredScope: "Calendars.Read", readOnly: true },
      { name: "graph_request", requiredScope: "User.Read", readOnly: true }
    ];
  }

  async listMessages(
    actorIdOrEmail: string,
    options: { top?: number; query?: string; skip?: number }
  ): Promise<{ messages: unknown[]; nextLink?: string | null }> {
    const token = await this.requireValidAccessToken(actorIdOrEmail, "Mail.Read");
    const params: string[] = [];
    if (options.top !== undefined) params.push(`$top=${encodeURIComponent(String(options.top))}`);
    if (options.skip !== undefined) params.push(`$skip=${encodeURIComponent(String(options.skip))}`);
    if (options.query) params.push(`$search=${encodeURIComponent(`"${options.query}"`)}`);
    const queryString = params.length > 0 ? `?${params.join("&")}` : "";
    const requestUrl = `https://graph.microsoft.com/v1.0/me/messages${queryString}`;
    const response = await this.fetchImpl(requestUrl, {
      headers: { Authorization: `Bearer ${token.accessToken}` }
    });
    const payload = await response.json() as { value?: unknown[]; "@odata.nextLink"?: string };
    if (!response.ok) {
      throw new Error(`Graph listMessages failed: ${response.status} ${JSON.stringify(payload).slice(0, 200)}`);
    }
    return {
      messages: payload.value ?? [],
      nextLink: payload["@odata.nextLink"] ?? null
    };
  }

  async requireValidAccessToken(actorIdOrEmail: string, requiredScope: string): Promise<ValidAccessToken> {
    const loaded = await this.options.tokenStore.loadBinding(actorIdOrEmail);
    if (!loaded) {
      throw new Error(`Microsoft provider not connected for actor: ${actorIdOrEmail}`);
    }
    const { binding, payload } = loaded;
    if (binding.status !== "connected") {
      throw new Error(`Microsoft binding is ${binding.status}; reconnect_required.`);
    }
    if (!binding.scopes.includes(requiredScope)) {
      throw new Error(`Required scope not bound: ${requiredScope}. Bound scopes: ${binding.scope}`);
    }
    if (this.tokenExpired(binding.expiresAt)) {
      const refreshed = await this.refreshAccessToken(actorIdOrEmail, payload.refreshToken);
      return { accessToken: refreshed.accessToken, scopes: refreshed.scopes, upstreamLogin: binding.upstreamLogin, tenantId: binding.tenantId };
    }
    return { accessToken: payload.accessToken, scopes: binding.scopes, upstreamLogin: binding.upstreamLogin, tenantId: binding.tenantId };
  }

  private tokenExpired(expiresAt: string | undefined): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() <= Date.now() + 30_000;
  }

  private async refreshAccessToken(
    actorIdOrEmail: string,
    refreshToken: string | undefined
  ): Promise<{ accessToken: string; scopes: string[]; scope: string; expiresAt?: string }> {
    if (!refreshToken) {
      await this.options.tokenStore.markReconnectRequired(actorIdOrEmail);
      throw new Error("Microsoft refresh token absent; binding marked reconnect_required.");
    }
    const body = new URLSearchParams({
      client_id: this.options.config.clientId!,
      client_secret: this.options.config.clientSecret!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: this.options.config.redirectUri,
      scope: this.options.config.scopes.join(" ")
    });
    const response = await this.fetchImpl(`${tenantBaseUrl(this.options.config.tenantId!)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const tokenPayload = await response.json() as TokenResponse;
    if (!response.ok) {
      if (tokenPayload.error === "invalid_grant") {
        await this.options.tokenStore.markReconnectRequired(actorIdOrEmail);
        throw new Error(`Microsoft refresh returned invalid_grant; binding marked reconnect_required: ${tokenPayload.error_description || ""}`);
      }
      throw new Error(tokenPayload.error_description || tokenPayload.error || "Microsoft token refresh failed.");
    }
    if (!tokenPayload.access_token) throw new Error("Microsoft refresh response did not include an access token.");
    const scope = tokenPayload.scope || this.options.config.scopes.join(" ");
    const expiresAt = tokenPayload.expires_in ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString() : undefined;
    await this.options.tokenStore.updateTokenPayload(
      actorIdOrEmail,
      {
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token ?? refreshToken,
        tokenType: tokenPayload.token_type || "Bearer",
        scope,
        expiresAt
      },
      scope,
      expiresAt
    );
    return { accessToken: tokenPayload.access_token, scopes: scope.split(" ").filter(Boolean), scope, expiresAt };
  }

  private authorizationUrl(state: string): string {
    const url = new URL(`${tenantBaseUrl(this.options.config.tenantId!)}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", this.options.config.clientId!);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", this.options.config.redirectUri);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", this.options.config.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.options.config.clientId!,
      client_secret: this.options.config.clientSecret!,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.options.config.redirectUri,
      scope: this.options.config.scopes.join(" ")
    });
    const response = await this.fetchImpl(`${tenantBaseUrl(this.options.config.tenantId!)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const payload = await response.json() as TokenResponse;
    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || "Microsoft token exchange failed.");
    }
    return payload;
  }

  private async fetchProfile(accessToken: string): Promise<MicrosoftProfileResponse> {
    const response = await this.fetchImpl(
      "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const payload = await response.json() as MicrosoftProfileResponse & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(payload.error?.message || "Microsoft profile lookup failed.");
    }
    return payload;
  }

  private assertConfigured(): void {
    const missing = [
      ["MICROSOFT_CLIENT_ID", this.options.config.clientId],
      ["MICROSOFT_CLIENT_SECRET", this.options.config.clientSecret],
      ["MICROSOFT_TENANT_ID", this.options.config.tenantId],
      ["MICROSOFT_TOKEN_STORE_KEY", this.options.config.tokenStoreKey]
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(`Microsoft provider is not configured. Missing: ${missing.join(", ")}`);
    }
  }
}

function tenantBaseUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`;
}

function normalizeActor(actor: MicrosoftActor): MicrosoftActor {
  return {
    actorId: actor.actorId?.trim() || actor.actorEmail.trim().toLowerCase(),
    actorEmail: actor.actorEmail.trim().toLowerCase(),
    actorName: actor.actorName?.trim() || undefined
  };
}

function normalizeLogin(login: string | undefined): string | undefined {
  const normalized = login?.trim().toLowerCase();
  return normalized || undefined;
}

function assertAllowedEmailDomain(email: string, domains: string[], label: string): void {
  const normalized = email.trim().toLowerCase();
  const allowed = domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  if (!allowed.some((domain) => normalized.endsWith(`@${domain}`))) {
    throw new Error(`${label} domain is not allowed: ${normalized}`);
  }
}
