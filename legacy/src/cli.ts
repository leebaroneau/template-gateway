import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { SessionTokenStore, type StaticServiceToken } from "./auth/session-tokens.js";
import { loadConfig as loadGatewayConfig, type GatewayConfig } from "./config.js";
import { providersFromConfig } from "./providers/defaults.js";
import { createComposioProviderService } from "./providers/composio/factory.js";
import type { ComposioProviderService } from "./providers/composio/service.js";
import type { ComposioGatewayProvider } from "./providers/composio/types.js";
import { createMicrosoftProviderService } from "./providers/microsoft/factory.js";
import type { MicrosoftProviderService } from "./providers/microsoft/service.js";
import { createPipedriveProviderService } from "./providers/pipedrive/factory.js";
import type { PipedriveProviderService } from "./providers/pipedrive/service.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { GatewayProviderDefinition, ProviderRegistry } from "./providers/types.js";

export interface CliIo {
  write(line: string): void;
  writeError?(line: string): void;
}

export interface CliOptions extends CliIo {
  loadConfig?: () => GatewayConfig;
  providers?: GatewayProviderDefinition[] | ProviderRegistry;
  sessionStore?: SessionLister;
  microsoftProvider?: Pick<MicrosoftProviderService, "createConnectUrl" | "status">;
  pipedriveProvider?: Pick<PipedriveProviderService, "createConnectUrl" | "status">;
  composioProvider?: Pick<ComposioProviderService, "createConnectUrl" | "status" | "mcpUrl">;
}

interface SessionLister {
  listSessions(): Promise<Array<{ email: string; clientId: string; scopes: string[]; createdAt: string }>>;
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function buildCli(options: CliOptions = { write: (line) => console.log(line) }): Command {
  const writeError = options.writeError ?? ((line: string) => console.error(line));
  const loadConfig = options.loadConfig ?? loadGatewayConfig;
  const program = new Command();
  program.name("template-gateway").description("Operator CLI for template-gateway");

  program.command("doctor").description("Check local gateway configuration").action(() => {
    const config = readConfig(loadConfig, writeError);
    options.write("template-gateway: ok");
    options.write(`apiBaseUrl: ${config.apiBaseUrl}`);
    options.write(`allowedEmailDomains: ${config.allowedEmailDomains.join(",")}`);
  });

  program.command("providers").description("List configured providers").action(() => {
    const registry = getProviderRegistry(options.providers, readConfig(loadConfig, writeError));
    const providers = registry.list();
    if (providers.length === 0) {
      options.write("No providers configured");
      return;
    }
    for (const provider of providers) {
      options.write(`${provider.slug}: ${provider.name} (${provider.mcpPath})`);
    }
  });

  program.command("sessions").description("List active user sessions").action(async () => {
    const store = options.sessionStore ?? createDefaultSessionStore(readConfig(loadConfig, writeError));
    const sessions = await store.listSessions();
    if (sessions.length === 0) {
      options.write("No sessions");
      return;
    }
    for (const session of sessions) {
      options.write(`${session.email}: ${session.clientId} [${session.scopes.join(",")}] ${session.createdAt}`);
    }
  });

  const microsoft = program.command("microsoft").description("Manage Microsoft 365 provider connections");

  microsoft.command("connect")
    .description("Print a Microsoft OAuth login URL for an actor")
    .requiredOption("--actor <email>", "Actor email address")
    .option("--actor-id <id>", "Stable actor id or profile")
    .option("--actor-name <name>", "Display actor name")
    .action(async (commandOptions: { actor: string; actorId?: string; actorName?: string }) => {
      const provider = options.microsoftProvider ?? createMicrosoftProviderService(readConfig(loadConfig, writeError));
      const result = await provider.createConnectUrl({
        actorId: commandOptions.actorId,
        actorEmail: commandOptions.actor,
        actorName: commandOptions.actorName
      });
      options.write(result.authorizeUrl);
    });

  microsoft.command("status")
    .description("Print Microsoft connection status for an actor")
    .requiredOption("--actor <id-or-email>", "Actor id, profile, or email")
    .action(async (commandOptions: { actor: string }) => {
      const provider = options.microsoftProvider ?? createMicrosoftProviderService(readConfig(loadConfig, writeError));
      const status = await provider.status(commandOptions.actor);
      const upstream = status.upstreamLogin ? ` -> ${status.upstreamLogin}` : "";
      const scopes = status.scopes.length > 0 ? ` [${status.scopes.join(",")}]` : " []";
      const expires = status.expiresAt ? ` expires ${status.expiresAt}` : "";
      options.write(`microsoft: ${status.status} ${status.actorId}${upstream}${scopes}${expires}`);
    });

  const pipedrive = program.command("pipedrive").description("Manage Pipedrive provider connections");

  pipedrive.command("connect")
    .description("Print a Pipedrive OAuth login URL for an actor")
    .requiredOption("--actor <email>", "Actor email address")
    .option("--actor-id <id>", "Stable actor id or profile")
    .option("--actor-name <name>", "Display actor name")
    .action(async (commandOptions: { actor: string; actorId?: string; actorName?: string }) => {
      const provider = options.pipedriveProvider ?? createPipedriveProviderService(readConfig(loadConfig, writeError));
      const result = await provider.createConnectUrl({
        actorId: commandOptions.actorId,
        actorEmail: commandOptions.actor,
        actorName: commandOptions.actorName
      });
      options.write(result.authorizeUrl);
    });

  pipedrive.command("status")
    .description("Print Pipedrive connection status for an actor")
    .requiredOption("--actor <id-or-email>", "Actor id, profile, or email")
    .action(async (commandOptions: { actor: string }) => {
      const provider = options.pipedriveProvider ?? createPipedriveProviderService(readConfig(loadConfig, writeError));
      const status = await provider.status(commandOptions.actor);
      const upstream = status.upstreamLogin ? ` -> ${status.upstreamLogin}` : "";
      const apiDomain = status.apiDomain ? ` (${status.apiDomain})` : "";
      const scopes = status.scopes.length > 0 ? ` [${status.scopes.join(",")}]` : " []";
      const expires = status.expiresAt ? ` expires ${status.expiresAt}` : "";
      options.write(`pipedrive: ${status.status} ${status.actorId}${upstream}${apiDomain}${scopes}${expires}`);
    });

  // Composio commands are only registered when ENABLE_COMPOSIO_PROVIDERS=true.
  // Read config eagerly at build time to check the flag; if config fails, skip
  // registration silently — the error will surface when a command is invoked.
  // Intentionally do NOT call writeError here to avoid double-reporting errors
  // (the action handlers call readConfig again and will surface the message).
  let composioEnabled = false;
  try {
    composioEnabled = loadConfig().enableComposioProviders;
  } catch {
    // Config error will surface when a command is actually invoked.
  }

  if (composioEnabled) {
    const VALID_COMPOSIO_SLUGS: ComposioGatewayProvider[] = ["microsoft-composio", "google-composio"];

    function resolveSlug(slug: string): ComposioGatewayProvider {
      if (!(VALID_COMPOSIO_SLUGS as string[]).includes(slug)) {
        throw new CliError(`Unknown Composio provider slug: ${slug}. Valid values: ${VALID_COMPOSIO_SLUGS.join(", ")}`);
      }
      return slug as ComposioGatewayProvider;
    }

    const providerGroup = program.command("provider").description("Manage Composio provider connections");

    providerGroup.command("connect <slug>")
      .description("Print a Composio OAuth connect URL for an actor")
      .requiredOption("--actor <email>", "Actor email address")
      .option("--actor-id <id>", "Stable actor id or profile")
      .option("--actor-name <name>", "Display actor name")
      .action(async (slug: string, commandOptions: { actor: string; actorId?: string; actorName?: string }) => {
        const provider = options.composioProvider ?? createComposioProviderService(readConfig(loadConfig, writeError));
        const result = await provider.createConnectUrl(resolveSlug(slug), {
          actorId: commandOptions.actorId,
          actorEmail: commandOptions.actor,
          actorName: commandOptions.actorName
        });
        if (result.authorizeUrl) {
          options.write(result.authorizeUrl);
        } else if (result.mcpUrl) {
          options.write(result.mcpUrl);
        } else {
          options.write(`${slug}: ${result.status} ${result.actorId}`);
        }
      });

    providerGroup.command("status <slug>")
      .description("Print Composio connection status for an actor")
      .requiredOption("--actor <id-or-email>", "Actor id, profile, or email")
      .action(async (slug: string, commandOptions: { actor: string }) => {
        const provider = options.composioProvider ?? createComposioProviderService(readConfig(loadConfig, writeError));
        const status = await provider.status(resolveSlug(slug), commandOptions.actor);
        const connectedAccounts = status.connectedAccountIds.length > 0 ? ` [${status.connectedAccountIds.join(",")}]` : " []";
        options.write(`${slug}: ${status.status} ${status.actorId}${connectedAccounts}`);
      });

    providerGroup.command("mcp-url <slug>")
      .description("Print the Composio MCP URL for an actor")
      .requiredOption("--actor <id-or-email>", "Actor id, profile, or email")
      .action(async (slug: string, commandOptions: { actor: string }) => {
        const provider = options.composioProvider ?? createComposioProviderService(readConfig(loadConfig, writeError));
        const result = await provider.mcpUrl(resolveSlug(slug), commandOptions.actor);
        if (result.mcpUrl) {
          options.write(result.mcpUrl);
        } else {
          options.write(`${slug}: ${result.status} ${result.actorId}`);
        }
      });
  }

  return program;
}

function readConfig(loadConfig: () => GatewayConfig, writeError: (line: string) => void): GatewayConfig {
  try {
    return loadConfig();
  } catch (error) {
    const message = `Configuration error: ${errorMessage(error)}`;
    writeError(message);
    throw new CliError(message);
  }
}

function getProviderRegistry(providers: CliOptions["providers"], config: GatewayConfig): ProviderRegistry {
  if (!providers) {
    return createProviderRegistry(providersFromConfig(config));
  }
  if (Array.isArray(providers)) {
    return createProviderRegistry(providers);
  }
  return providers;
}

function createDefaultSessionStore(config: GatewayConfig): SessionTokenStore {
  return new SessionTokenStore(config.tokenStorePath, config.allowedEmailDomains, staticServiceTokensFromConfig(config));
}

function staticServiceTokensFromConfig(config: GatewayConfig): StaticServiceToken[] {
  const fallbackEmail = `service-token@${config.allowedEmailDomains[0] ?? "example.com"}`;
  return config.apiBearerTokens.map((binding) => {
    const [token, email, profile] = binding.split(":");
    return {
      token,
      email: email || fallbackEmail,
      profile: profile || undefined
    };
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n")[0] ?? "Unknown error";
  }
  return String(error);
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && fileURLToPath(import.meta.url) === resolve(entrypoint));
}

if (isMainModule()) {
  await import("dotenv/config");
  try {
    await buildCli().parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliError) {
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
