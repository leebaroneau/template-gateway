import express from "express";
import type { Request, Response } from "express";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { actorContext, bearerAuth } from "./auth.js";
import { SessionCache } from "./session-cache.js";
import { forwardJsonRpc, makeComposioSessionFactory } from "./mcp-proxy.js";
import { buildAdminBackend } from "./admin/backend-factory.js";
import { createAdminRouter } from "./admin/routes.js";
import type { GatewayConnectionBackend } from "./admin/types.js";
import { GatewayAccessStore } from "./access/store.js";
import { createGatewayApiRouter } from "./api/routes.js";
import { createGatewayMcpV1Router } from "./mcp-v1/routes.js";
import { GoogleOAuthAdapter } from "./google-oauth/adapter.js";
import { GatewayGoogleStore } from "./google-oauth/store.js";
import { createGoogleOAuthRouter } from "./google-oauth/routes.js";

interface CreateAppOptions {
  adminBackend?: GatewayConnectionBackend;
  accessStore?: GatewayAccessStore;
}

export function createApp(config = loadConfig(), options: CreateAppOptions = {}) {
  const factory = makeComposioSessionFactory({
    composioApiKey: config.composioApiKey,
    composioProjectId: config.composioProjectId,
    toolkitAllowlist: config.toolkitAllowlist,
    authConfigs: config.authConfigs
  });
  const cache = new SessionCache(factory, { ttlSeconds: config.sessionTtlSeconds });
  const app = express();
  app.disable("x-powered-by");
  const adminBackend = options.adminBackend ?? buildAdminBackend(config);
  const accessStore = options.accessStore ?? new GatewayAccessStore(config.gatewayStorePath);
  const googleStore = config.googleOAuth ? new GatewayGoogleStore(config.gatewayStorePath) : undefined;
  const googleAdapter = config.googleOAuth && googleStore
    ? new GoogleOAuthAdapter(config.googleOAuth, googleStore)
    : undefined;

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      brand: config.brandSlug,
      cachedSessions: cache.size(),
      toolkitAllowlist: config.toolkitAllowlist ?? "<all toolkits the API key can see>"
    });
  });

  app.use("/admin", createAdminRouter(adminBackend, accessStore));
  app.use("/api/v1", createGatewayApiRouter({ backend: adminBackend, accessStore }));
  app.use(
    "/mcp/v1",
    createGatewayMcpV1Router({
      backend: adminBackend,
      accessStore,
      authGateAllowedDomains: config.mcpAuthGateAllowedDomains,
      authGateAllowedUsers: config.mcpAuthGateAllowedUsers
    })
  );

  app.use(
    "/admin/google-oauth",
    createGoogleOAuthRouter({
      config: config.googleOAuth,
      adapter: googleAdapter,
      store: config.googleOAuth ? googleStore : undefined,
      bearer: config.gatewayBearer
    })
  );

  const mcpRouter = express.Router();
  mcpRouter.use(express.json({ limit: "1mb" }));
  mcpRouter.use(bearerAuth(config.gatewayBearer));
  mcpRouter.use(actorContext(config.brandSlug));

  const mcpHandler = (req: Request, res: Response) => forwardJsonRpc(req, res, { cache });
  mcpRouter.post("/", mcpHandler);
  mcpRouter.delete("/", mcpHandler);

  // GET is SSE in MCP streamable HTTP. Composio Tool Router decides whether to
  // upgrade; we forward as-is. forwardJsonRpc handles the empty body for GET.
  mcpRouter.get("/", mcpHandler);

  app.use("/mcp", mcpRouter);

  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("[gateway] unhandled error:", err);
    res.status(500).json({ error: "internal gateway error", detail: err.message });
  });

  return app;
}

function main() {
  // Keep the process alive on async errors that escaped a route handler.
  // The handlers in forwardJsonRpc catch the common ones; this is a safety net.
  process.on("unhandledRejection", (reason) => {
    // eslint-disable-next-line no-console
    console.error("[gateway] unhandledRejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    // eslint-disable-next-line no-console
    console.error("[gateway] uncaughtException:", err);
  });

  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[gateway] brand=${config.brandSlug} listening on :${config.port} (TTL ${config.sessionTtlSeconds}s)`
    );
  });
}

function isDirectEntry(argvEntry = process.argv[1], moduleUrl = import.meta.url): boolean {
  return Boolean(argvEntry && pathToFileURL(argvEntry).href === moduleUrl);
}

if (isDirectEntry()) {
  main();
}
