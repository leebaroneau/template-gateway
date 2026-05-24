import { Composio } from "@composio/core";
import type { GatewayConfig } from "../../config.js";
import { ComposioBindingStore } from "./binding-store.js";
import { ComposioProviderService } from "./service.js";
import type {
  ComposioAuthorizeInput,
  ComposioAuthorizeResult,
  ComposioSessionClient,
  ComposioSessionCreateInput,
  ComposioSessionInfo,
  ComposioToolkitStatus
} from "./types.js";

export function createComposioProviderService(config: GatewayConfig): ComposioProviderService {
  return new ComposioProviderService({
    config: config.composio,
    bindingStore: new ComposioBindingStore(config.composio.bindingStorePath),
    client: new ComposioSdkSessionClient(config.composio.apiKey)
  });
}

interface ComposioSdkLike {
  create(userId: string, config: unknown): Promise<ComposioSdkSessionLike>;
  use(sessionId: string): Promise<ComposioSdkSessionLike>;
}

interface ComposioSdkSessionLike {
  sessionId: string;
  mcp: { url: string };
  authorize(toolkit: string, options?: { callbackUrl?: string }): Promise<{ redirectUrl?: string | null }>;
  toolkits(options?: unknown): Promise<{
    items: Array<{
      slug: string;
      connection?: {
        isActive: boolean;
        connectedAccount?: { id: string };
      };
    }>;
  }>;
}

export class ComposioSdkSessionClient implements ComposioSessionClient {
  private sdk?: ComposioSdkLike;

  constructor(
    private readonly apiKey?: string,
    sdk?: ComposioSdkLike
  ) {
    this.sdk = sdk;
  }

  async createSession(input: ComposioSessionCreateInput): Promise<ComposioSessionInfo> {
    const session = await this.getSdk().create(input.userId, {
      toolkits: input.toolkits,
      authConfigs: input.authConfigs,
      connectedAccounts: input.connectedAccounts,
      workbench: { enable: input.workbenchEnabled }
    });
    return {
      id: session.sessionId,
      mcpUrl: session.mcp.url
    };
  }

  async authorize(input: ComposioAuthorizeInput): Promise<ComposioAuthorizeResult> {
    const session = await this.getSdk().use(input.sessionId);
    const authorization = await session.authorize(input.toolkit, input.callbackUrl ? {
      callbackUrl: input.callbackUrl
    } : undefined);
    if (!authorization.redirectUrl) {
      throw new Error("Composio authorization response did not include a redirect URL.");
    }
    return {
      redirectUrl: authorization.redirectUrl
    };
  }

  async listToolkits(sessionId: string): Promise<ComposioToolkitStatus[]> {
    const session = await this.getSdk().use(sessionId);
    const toolkits = await session.toolkits();
    return toolkits.items.map((toolkit) => ({
      slug: toolkit.slug,
      isActive: toolkit.connection?.isActive === true,
      connectedAccountId: toolkit.connection?.connectedAccount?.id
    }));
  }

  private getSdk(): ComposioSdkLike {
    if (this.sdk) return this.sdk;
    if (!this.apiKey) {
      throw new Error("COMPOSIO_API_KEY is required for Composio-backed providers.");
    }
    this.sdk = new Composio({ apiKey: this.apiKey }) as unknown as ComposioSdkLike;
    return this.sdk;
  }
}
