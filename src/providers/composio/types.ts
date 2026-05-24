import type { GatewayConfig } from "../../config.js";

export type ComposioGatewayProvider = keyof GatewayConfig["composio"]["providers"];
export type ComposioBindingStatus = "authorization_required" | "connected" | "disconnected";

export interface ComposioActor {
  actorId?: string;
  actorEmail: string;
  actorName?: string;
}

export interface ComposioSessionCreateInput {
  userId: string;
  toolkits: string[];
  authConfigs?: Record<string, string>;
  connectedAccounts?: Record<string, string[]>;
  workbenchEnabled: boolean;
}

export interface ComposioSessionInfo {
  id: string;
  mcpUrl: string;
}

export interface ComposioAuthorizeInput {
  sessionId: string;
  toolkit: string;
  callbackUrl?: string;
}

export interface ComposioAuthorizeResult {
  redirectUrl: string;
}

export interface ComposioToolkitStatus {
  slug: string;
  isActive: boolean;
  connectedAccountId?: string;
}

export interface ComposioSessionClient {
  createSession(input: ComposioSessionCreateInput): Promise<ComposioSessionInfo>;
  authorize(input: ComposioAuthorizeInput): Promise<ComposioAuthorizeResult>;
  listToolkits(sessionId: string): Promise<ComposioToolkitStatus[]>;
}

export interface ComposioBinding {
  actorId: string;
  actorEmail: string;
  actorName?: string;
  provider: string;
  backend: "composio";
  composioUserId: string;
  sessionId: string;
  mcpUrl: string;
  connectedAccountIds: string[];
  status: ComposioBindingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ComposioStatus {
  provider: string;
  backend: "composio";
  status: ComposioBindingStatus;
  actorId: string;
  actorEmail?: string;
  actorName?: string;
  composioUserId?: string;
  sessionId?: string;
  connectedAccountIds: string[];
}

export interface ComposioConnectResult extends ComposioStatus {
  authorizeUrl?: string;
  mcpUrl?: string;
}

export interface ComposioMcpUrlResult extends ComposioStatus {
  mcpUrl?: string;
  connectedAccountId?: string;
}
