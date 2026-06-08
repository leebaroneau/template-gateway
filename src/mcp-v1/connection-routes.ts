import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayApiScope } from "../access/types.js";
import { scopeAllowed } from "../access/types.js";
import type { GatewayConnectionBackend } from "../admin/types.js";
import type { GatewayAppInstallStore } from "../apps/store.js";
import { authenticateGatewayConnectionMcpRequest } from "./connection-auth.js";
import { callConnectionScopedTool, connectionScopedTools } from "./connection-tools.js";
import type { ConnectionMcpActor, McpJsonRpcRequest } from "./types.js";

interface CreateGatewayConnectionMcpRouterOptions {
  backend: GatewayConnectionBackend;
  accessStore: GatewayAccessStore;
  authGateAllowedDomains?: string[];
  authGateAllowedUsers?: string[];
  appInstallStore?: GatewayAppInstallStore;
}

declare module "express-serve-static-core" {
  interface Request {
    gatewayConnectionMcpActor?: ConnectionMcpActor;
  }
}

export function createGatewayConnectionMcpRouter(options: CreateGatewayConnectionMcpRouterOptions): express.Router {
  const router = express.Router({ mergeParams: true });

  router.use(express.json({ limit: "1mb" }));
  router.use((error: Error, _req: Request, res: Response, next: NextFunction) => {
    if (error) {
      res.status(400).json(jsonRpcError(null, -32700, "Invalid JSON"));
      return;
    }
    next();
  });
  router.use((req, res, next) => authenticateRequest(req, res, next, options));
  router.post("/", (req, res, next) => {
    handleJsonRpc(req, res, options).catch(next);
  });
  router.all("/", (_req, res) => {
    res.status(405).json({ error: "method_not_allowed", message: "Use POST for connection MCP JSON-RPC requests" });
  });
  router.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
    const actor = req.gatewayConnectionMcpActor;
    if (actor !== undefined) {
      recordUsage(options.accessStore, actor, req.method, 500, undefined, Date.now(), req.params.connectionId);
    }
    res.status(500).json({ error: "internal_error", message: "Internal connection MCP error" });
  });

  return router;
}

async function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  options: CreateGatewayConnectionMcpRouterOptions
): Promise<void> {
  const connectionId = req.params.connectionId;
  const state = await options.backend.snapshot();
  const result = authenticateGatewayConnectionMcpRequest({
    connectionId,
    authorizationHeader: req.get("Authorization"),
    identityHeaders: req.headers as Record<string, string | string[] | undefined>,
    accessStore: options.accessStore,
    state,
    authGateAllowedDomains: options.authGateAllowedDomains,
    authGateAllowedUsers: options.authGateAllowedUsers
  });

  if (!result.ok) {
    options.accessStore.recordUsage({
      route: `/mcp/v1/connections/${connectionId}`,
      method: req.method,
      statusCode: result.statusCode
    });
    options.accessStore.writeAccessAudit({
      action: "connection_mcp_auth.failed",
      targetType: "connection",
      targetId: connectionId,
      detail: result.detail,
      actor: "anonymous",
      metadata: { route: `/mcp/v1/connections/${connectionId}`, method: req.method, reason: result.reason, connectionId }
    });
    res.status(result.statusCode).json({
      error: result.reason === "connection_unavailable" ? "connection_unavailable" : result.statusCode === 404 ? "not_found" : result.statusCode === 403 ? "forbidden" : "unauthorized",
      message: result.detail
    });
    return;
  }

  req.gatewayConnectionMcpActor = result.actor;
  options.accessStore.writeAccessAudit({
    action: "connection_mcp_auth.succeeded",
    targetType: "connection",
    targetId: connectionId,
    detail: `Authenticated connection MCP ${req.method} /mcp/v1/connections/${connectionId}`,
    actor: result.actor.actorId,
    metadata: actorMetadata(result.actor)
  });
  next();
}

async function handleJsonRpc(
  req: Request,
  res: Response,
  options: CreateGatewayConnectionMcpRouterOptions
): Promise<void> {
  const startedAt = Date.now();
  const actor = req.gatewayConnectionMcpActor;
  if (actor === undefined) {
    res.status(401).json({ error: "unauthorized", message: "Missing or invalid connection MCP auth" });
    return;
  }

  const request = parseJsonRpcRequest(req.body);
  if (!request.ok) {
    recordUsage(options.accessStore, actor, req.method, 400, undefined, startedAt, actor.context.connectionId);
    res.status(400).json(jsonRpcError(null, -32600, request.message));
    return;
  }

  switch (request.value.method) {
    case "initialize":
      recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt, actor.context.connectionId);
      res.json(jsonRpcResult(request.value.id, initializeResult(request.value.params)));
      return;
    case "notifications/initialized":
      recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt, actor.context.connectionId);
      res.status(202).end();
      return;
    case "ping":
      recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt, actor.context.connectionId);
      res.json(jsonRpcResult(request.value.id, {}));
      return;
    case "tools/list":
      handleToolsList(req, res, options, request.value, actor, startedAt);
      return;
    case "tools/call":
      await handleToolCall(req, res, options, request.value, actor, startedAt);
      return;
    default:
      recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt, actor.context.connectionId);
      res.json(jsonRpcError(request.value.id, -32601, `Method not found: ${request.value.method}`));
      return;
  }
}

function handleToolsList(
  req: Request,
  res: Response,
  options: CreateGatewayConnectionMcpRouterOptions,
  request: McpJsonRpcRequest,
  actor: ConnectionMcpActor,
  startedAt: number
): void {
  if (!scopeAllowed(actor.scopes, "mcp.read")) {
    recordUsage(options.accessStore, actor, req.method, 403, "mcp.read", startedAt, actor.context.connectionId);
    res.status(403).json({ error: "forbidden", message: "Missing required scope: mcp.read" });
    return;
  }
  options.accessStore.writeAccessAudit({
    action: "connection_mcp_tool.listed",
    targetType: "connection",
    targetId: actor.context.connectionId,
    detail: "Listed connection MCP tools",
    actor: actor.actorId,
    metadata: { toolCount: String(connectionScopedTools.length), ...actorMetadata(actor) }
  });
  recordUsage(options.accessStore, actor, req.method, 200, "mcp.read", startedAt, actor.context.connectionId);
  res.json(jsonRpcResult(request.id, { tools: connectionScopedTools }));
}

async function handleToolCall(
  req: Request,
  res: Response,
  options: CreateGatewayConnectionMcpRouterOptions,
  request: McpJsonRpcRequest,
  actor: ConnectionMcpActor,
  startedAt: number
): Promise<void> {
  const params = parseToolCallParams(request.params);
  if (!params.ok) {
    recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt, actor.context.connectionId);
    res.json(jsonRpcError(request.id, -32602, params.message));
    return;
  }
  if (!scopeAllowed(actor.scopes, "mcp.read")) {
    recordUsage(options.accessStore, actor, req.method, 403, "mcp.read", startedAt, actor.context.connectionId);
    res.status(403).json({ error: "forbidden", message: "Missing required scope: mcp.read" });
    return;
  }

  const result = await callConnectionScopedTool(
    params.value.name,
    params.value.arguments ?? {},
    actor.context,
    await options.backend.snapshot(),
    options.appInstallStore
  );
  options.accessStore.writeAccessAudit({
    action: result.isError ? "connection_mcp_tool.failed" : "connection_mcp_tool.called",
    targetType: "connection",
    targetId: actor.context.connectionId,
    detail: `${result.isError ? "Failed" : "Called"} connection MCP tool ${params.value.name}`,
    actor: actor.actorId,
    metadata: { toolName: params.value.name, ...actorMetadata(actor) }
  });
  recordUsage(options.accessStore, actor, req.method, 200, "mcp.read", startedAt, actor.context.connectionId);
  res.json(jsonRpcResult(request.id, result));
}

function parseJsonRpcRequest(body: unknown): { ok: true; value: McpJsonRpcRequest } | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid JSON-RPC request" };
  }
  const value = body as Partial<McpJsonRpcRequest>;
  if (value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return { ok: false, message: "Invalid JSON-RPC request" };
  }
  return { ok: true, value: value as McpJsonRpcRequest };
}

function initializeResult(params: unknown): Record<string, unknown> {
  const protocolVersion =
    params && typeof params === "object" && "protocolVersion" in params && typeof params.protocolVersion === "string"
      ? params.protocolVersion
      : "2025-06-18";
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "haverford-gateway-connection", version: "v1" }
  };
}

function parseToolCallParams(
  params: unknown
): { ok: true; value: { name: string; arguments?: unknown } } | { ok: false; message: string } {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { ok: false, message: "tools/call params must be an object" };
  }
  const value = params as { name?: unknown; arguments?: unknown };
  if (typeof value.name !== "string" || value.name.trim() === "") {
    return { ok: false, message: "tools/call name is required" };
  }
  return { ok: true, value: { name: value.name, arguments: value.arguments } };
}

function jsonRpcResult(id: McpJsonRpcRequest["id"], result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: McpJsonRpcRequest["id"], code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function recordUsage(
  accessStore: GatewayAccessStore,
  actor: ConnectionMcpActor,
  method: string,
  statusCode: number,
  scope: GatewayApiScope | undefined,
  startedAt: number,
  connectionId: string
): void {
  accessStore.recordUsage({
    clientId: actor.type === "connection_token" ? actor.clientId : undefined,
    keyId: actor.type === "connection_token" ? actor.apiKeyId : undefined,
    route: `/mcp/v1/connections/${connectionId}`,
    method,
    statusCode,
    scope,
    durationMs: Math.max(0, Date.now() - startedAt)
  });
}

function actorMetadata(actor: ConnectionMcpActor): Record<string, string> {
  if (actor.type === "connection_token") {
    return {
      authMethod: "connection_token",
      connectionId: actor.context.connectionId,
      tokenId: actor.tokenId,
      clientId: actor.clientId,
      keyId: actor.apiKeyId
    };
  }
  return {
    authMethod: "auth_gate",
    connectionId: actor.context.connectionId,
    email: actor.email,
    domain: actor.domain
  };
}
