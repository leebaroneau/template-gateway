import type { GatewayConfig } from "../../config.js";
import type { ComposioBindingStore } from "./binding-store.js";
import type {
  ComposioActor,
  ComposioConnectResult,
  ComposioGatewayProvider,
  ComposioMcpUrlResult,
  ComposioSessionClient,
  ComposioStatus,
  ComposioToolkitStatus
} from "./types.js";

interface ComposioProviderServiceOptions {
  config: GatewayConfig["composio"];
  bindingStore: ComposioBindingStore;
  client: ComposioSessionClient;
}

export class ComposioProviderService {
  constructor(private readonly options: ComposioProviderServiceOptions) {}

  async createConnectUrl(provider: ComposioGatewayProvider, actor: ComposioActor): Promise<ComposioConnectResult> {
    const normalizedActor = normalizeActor(actor);
    const session = await this.createSession(provider, normalizedActor);
    const connectedAccountIds = connectedAccountsForProvider(await this.options.client.listToolkits(session.id));
    if (connectedAccountIds.length > 0) {
      return {
        ...await this.saveBinding(provider, normalizedActor, session, connectedAccountIds, "connected"),
        mcpUrl: mcpUrlWithAccount(session.mcpUrl, connectedAccountIds[0])
      };
    }

    const providerConfig = this.providerConfig(provider);
    const authorization = await this.options.client.authorize({
      sessionId: session.id,
      toolkit: providerConfig.primaryToolkit
    });

    return {
      ...await this.saveBinding(provider, normalizedActor, session, [], "authorization_required"),
      authorizeUrl: authorization.redirectUrl,
      mcpUrl: mcpUrlWithUser(session.mcpUrl, composioUserIdForActor(this.options.config.clientSlug, normalizedActor))
    };
  }

  async refreshStatus(provider: ComposioGatewayProvider, actor: ComposioActor): Promise<ComposioStatus> {
    const normalizedActor = normalizeActor(actor);
    const session = await this.createSession(provider, normalizedActor);
    const connectedAccountIds = connectedAccountsForProvider(await this.options.client.listToolkits(session.id));
    const status = connectedAccountIds.length > 0 ? "connected" : "disconnected";
    return this.saveBinding(provider, normalizedActor, session, connectedAccountIds, status);
  }

  async status(provider: ComposioGatewayProvider, actorIdOrEmail: string): Promise<ComposioStatus> {
    return this.options.bindingStore.status(provider, actorIdOrEmail);
  }

  async mcpUrl(provider: ComposioGatewayProvider, actorIdOrEmail: string): Promise<ComposioMcpUrlResult> {
    const binding = await this.options.bindingStore.get(provider, actorIdOrEmail);
    if (!binding) {
      return {
        provider,
        backend: "composio",
        status: "disconnected",
        actorId: actorIdOrEmail.trim().toLowerCase(),
        connectedAccountIds: []
      };
    }
    const connectedAccountId = binding.connectedAccountIds[0];
    return {
      provider: binding.provider,
      backend: "composio",
      status: binding.status,
      actorId: binding.actorId,
      actorEmail: binding.actorEmail,
      actorName: binding.actorName,
      composioUserId: binding.composioUserId,
      sessionId: binding.sessionId,
      connectedAccountIds: [...binding.connectedAccountIds],
      connectedAccountId,
      mcpUrl: connectedAccountId
        ? mcpUrlWithAccount(binding.mcpUrl, connectedAccountId)
        : mcpUrlWithUser(binding.mcpUrl, binding.composioUserId)
    };
  }

  private async createSession(provider: ComposioGatewayProvider, actor: Required<Pick<ComposioActor, "actorId" | "actorEmail">> & Pick<ComposioActor, "actorName">) {
    const providerConfig = this.providerConfig(provider);
    const authConfigs = authConfigsForToolkits(this.options.config.authConfigs, providerConfig.toolkits);
    const userId = composioUserIdForActor(this.options.config.clientSlug, actor);
    return this.options.client.createSession({
      userId,
      toolkits: providerConfig.toolkits,
      authConfigs: Object.keys(authConfigs).length > 0 ? authConfigs : undefined,
      connectedAccounts: undefined,
      workbenchEnabled: false
    });
  }

  private async saveBinding(
    provider: ComposioGatewayProvider,
    actor: Required<Pick<ComposioActor, "actorId" | "actorEmail">> & Pick<ComposioActor, "actorName">,
    session: { id: string; mcpUrl: string },
    connectedAccountIds: string[],
    status: "authorization_required" | "connected" | "disconnected"
  ): Promise<ComposioStatus> {
    return this.options.bindingStore.upsert({
      actorId: actor.actorId,
      actorEmail: actor.actorEmail,
      actorName: actor.actorName,
      provider,
      backend: "composio",
      composioUserId: composioUserIdForActor(this.options.config.clientSlug, actor),
      sessionId: session.id,
      mcpUrl: session.mcpUrl,
      connectedAccountIds,
      status
    });
  }

  private providerConfig(provider: ComposioGatewayProvider): GatewayConfig["composio"]["providers"][ComposioGatewayProvider] {
    const providerConfig = this.options.config.providers[provider];
    if (!providerConfig) {
      throw new Error(`Composio provider is not configured: ${provider}`);
    }
    return providerConfig;
  }
}

export function composioUserIdForActor(clientSlug: string, actor: Pick<ComposioActor, "actorId" | "actorEmail">): string {
  const actorKey = (actor.actorId || actor.actorEmail).trim().toLowerCase();
  return `${clientSlug.trim().toLowerCase()}:actor:${actorKey}`;
}

function normalizeActor(actor: ComposioActor): Required<Pick<ComposioActor, "actorId" | "actorEmail">> & Pick<ComposioActor, "actorName"> {
  const actorEmail = actor.actorEmail.trim().toLowerCase();
  return {
    actorId: (actor.actorId || actorEmail).trim().toLowerCase(),
    actorEmail,
    actorName: actor.actorName?.trim() || undefined
  };
}

function authConfigsForToolkits(allConfigs: Record<string, string>, toolkits: string[]): Record<string, string> {
  return Object.fromEntries(
    toolkits
      .map((toolkit) => [toolkit, allConfigs[toolkit]] as const)
      .filter(([, authConfigId]) => Boolean(authConfigId))
  );
}

function connectedAccountsForProvider(toolkits: ComposioToolkitStatus[]): string[] {
  return toolkits
    .filter((toolkit) => toolkit.isActive && toolkit.connectedAccountId)
    .map((toolkit) => toolkit.connectedAccountId!);
}

function mcpUrlWithUser(url: string, userId: string): string {
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.delete("connected_account_id");
  scopedUrl.searchParams.set("user_id", userId);
  return scopedUrl.toString();
}

function mcpUrlWithAccount(url: string, connectedAccountId: string): string {
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.delete("user_id");
  scopedUrl.searchParams.set("connected_account_id", connectedAccountId);
  return scopedUrl.toString();
}
