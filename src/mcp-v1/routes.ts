import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayApiScope } from "../access/types.js";
import { scopeAllowed } from "../access/types.js";
import type { GatewayConnectionBackend } from "../admin/types.js";
import type { GatewayAppInstallStore } from "../apps/store.js";
import { authenticateGatewayMcpRequest } from "./auth.js";
import { callGatewayMcpTool, gatewayMcpTools, requiredScopeForGatewayMcpTool } from "./tools.js";
import type { GatewayMcpActor, McpJsonRpcRequest } from "./types.js";

interface CreateGatewayMcpV1RouterOptions {
  backend: GatewayConnectionBackend;
  accessStore: GatewayAccessStore;
  authGateAllowedDomains?: string[];
  authGateAllowedUsers?: string[];
  appInstallStore?: GatewayAppInstallStore;
}

declare module "express-serve-static-core" {
  interface Request {
    gatewayMcpActor?: GatewayMcpActor;
  }
}

const metadataReadScopes: GatewayApiScope[] = [
  "mcp.read",
  "brands.read",
  "regions.read",
  "connectors.read",
  "connections.read",
  "apps.read"
];

export function createGatewayMcpV1Router(options: CreateGatewayMcpV1RouterOptions): express.Router {
  const router = express.Router();

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
    res.status(405).json({ error: "method_not_allowed", message: "Use POST for /mcp/v1 JSON-RPC requests" });
  });
  router.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
    const actor = req.gatewayMcpActor;
    if (actor !== undefined) {
      recordUsage(options.accessStore, actor, req.method, 500, undefined, Date.now());
    }
    res.status(500).json({ error: "internal_error", message: "Internal MCP error" });
  });

  return router;
}

function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  options: CreateGatewayMcpV1RouterOptions
): void {
  const result = authenticateGatewayMcpRequest({
    authorizationHeader: req.get("Authorization"),
    identityHeaders: req.headers as Record<string, string | string[] | undefined>,
    accessStore: options.accessStore,
    authGateAllowedDomains: options.authGateAllowedDomains,
    authGateAllowedUsers: options.authGateAllowedUsers
  });

  if (!result.ok) {
    options.accessStore.recordUsage({
      route: "/mcp/v1",
      method: req.method,
      statusCode: result.statusCode
    });
    options.accessStore.writeAccessAudit({
      action: "mcp_auth.failed",
      targetType: "api_client",
      targetId: "unknown",
      detail: result.detail,
      actor: "anonymous",
      metadata: { route: "/mcp/v1", method: req.method, reason: result.reason }
    });
    res.status(result.statusCode).json({
      error: result.statusCode === 403 ? "forbidden" : "unauthorized",
      message: result.detail
    });
    return;
  }

  req.gatewayMcpActor = result.actor;
  options.accessStore.writeAccessAudit({
    action: "mcp_auth.succeeded",
    targetType: "api_client",
    targetId: result.actor.actorId,
    detail: `Authenticated MCP ${req.method} /mcp/v1`,
    actor: result.actor.actorId,
    metadata: actorMetadata(result.actor)
  });
  next();
}

async function handleJsonRpc(
  req: Request,
  res: Response,
  options: CreateGatewayMcpV1RouterOptions
): Promise<void> {
  const startedAt = Date.now();
  const actor = req.gatewayMcpActor;
  if (actor === undefined) {
    res.status(401).json({ error: "unauthorized", message: "Missing or invalid MCP auth" });
    return;
  }

  const request = parseJsonRpcRequest(req.body);
  if (!request.ok) {
    recordUsage(options.accessStore, actor, req.method, 400, undefined, startedAt);
    res.status(400).json(jsonRpcError(null, -32600, request.message));
    return;
  }

  switch (request.value.method) {
    case "initialize":
      recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt);
      res.json(jsonRpcResult(request.value.id, initializeResult(request.value.params)));
      return;
    case "notifications/initialized":
      recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt);
      res.status(202).end();
      return;
    case "ping":
      recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt);
      res.json(jsonRpcResult(request.value.id, {}));
      return;
    case "tools/list":
      handleToolsList(req, res, options, request.value, actor, startedAt);
      return;
    case "tools/call":
      await handleToolCall(req, res, options, request.value, actor, startedAt);
      return;
    default:
      recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt);
      res.json(jsonRpcError(request.value.id, -32601, `Method not found: ${request.value.method}`));
      return;
  }
}

function handleToolsList(
  req: Request,
  res: Response,
  options: CreateGatewayMcpV1RouterOptions,
  request: McpJsonRpcRequest,
  actor: GatewayMcpActor,
  startedAt: number
): void {
  const allowed = metadataReadScopes.some((scope) => scopeAllowed(actor.scopes, scope));
  if (!allowed) {
    recordUsage(options.accessStore, actor, req.method, 403, "mcp.read", startedAt);
    res.status(403).json({ error: "forbidden", message: "Missing required scope: mcp.read" });
    return;
  }

  options.accessStore.writeAccessAudit({
    action: "mcp_tool.listed",
    targetType: "api_client",
    targetId: actor.actorId,
    detail: "Listed MCP gateway tools",
    actor: actor.actorId,
    metadata: {
      route: "/mcp/v1",
      method: req.method,
      toolCount: String(gatewayMcpTools.length),
      ...actorMetadata(actor)
    }
  });
  recordUsage(options.accessStore, actor, req.method, 200, "mcp.read", startedAt);
  res.json(jsonRpcResult(request.id, { tools: gatewayMcpTools }));
}

async function handleToolCall(
  req: Request,
  res: Response,
  options: CreateGatewayMcpV1RouterOptions,
  request: McpJsonRpcRequest,
  actor: GatewayMcpActor,
  startedAt: number
): Promise<void> {
  const params = parseToolCallParams(request.params);
  if (!params.ok) {
    recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt);
    res.json(jsonRpcError(request.id, -32602, params.message));
    return;
  }

  const requiredScope = requiredScopeForGatewayMcpTool(params.value.name);
  if (requiredScope !== undefined && !actorCanCallTool(actor, requiredScope)) {
    recordUsage(options.accessStore, actor, req.method, 403, requiredScope, startedAt);
    res.status(403).json({ error: "forbidden", message: `Missing required scope: ${requiredScope}` });
    return;
  }

  const result = await callGatewayMcpTool(params.value.name, params.value.arguments ?? {}, await options.backend.snapshot(), options.appInstallStore);
  recordToolAudit(options.accessStore, actor, params.value.name, result.isError, {
    resultCount: resultCount(result.structuredContent)
  });
  recordUsage(options.accessStore, actor, req.method, 200, requiredScope, startedAt);
  res.json(jsonRpcResult(request.id, result));
}

function actorCanCallTool(actor: GatewayMcpActor, granularScope: GatewayApiScope): boolean {
  return scopeAllowed(actor.scopes, "mcp.read") || scopeAllowed(actor.scopes, granularScope);
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
    serverInfo: { name: "haverford-gateway", version: "v1" }
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
  actor: GatewayMcpActor,
  method: string,
  statusCode: number,
  scope: GatewayApiScope | undefined,
  startedAt: number
): void {
  accessStore.recordUsage({
    clientId: actor.type === "api_client" ? actor.authenticated.client.id : undefined,
    keyId: actor.type === "api_client" ? actor.authenticated.key.id : undefined,
    route: "/mcp/v1",
    method,
    statusCode,
    scope,
    durationMs: Math.max(0, Date.now() - startedAt)
  });
}

function recordToolAudit(
  accessStore: GatewayAccessStore,
  actor: GatewayMcpActor,
  toolName: string,
  failed: boolean,
  metadata: Record<string, string>
): void {
  accessStore.writeAccessAudit({
    action: failed ? "mcp_tool.failed" : "mcp_tool.called",
    targetType: "api_client",
    targetId: actor.actorId,
    detail: `${failed ? "Failed" : "Called"} MCP tool ${toolName}`,
    actor: actor.actorId,
    metadata: { toolName, ...metadata, ...actorMetadata(actor) }
  });
}

function actorMetadata(actor: GatewayMcpActor): Record<string, string> {
  if (actor.type === "api_client") {
    return {
      authMethod: "api_key",
      clientId: actor.authenticated.client.id,
      keyId: actor.authenticated.key.id,
      fingerprint: actor.authenticated.key.fingerprint
    };
  }
  return { authMethod: "auth_gate", email: actor.email, domain: actor.domain };
}

function resultCount(structuredContent: Record<string, unknown>): string {
  for (const value of Object.values(structuredContent)) {
    if (Array.isArray(value)) return String(value.length);
  }
  return Object.keys(structuredContent).length === 0 ? "0" : "1";
}
