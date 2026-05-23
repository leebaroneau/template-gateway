import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { createProviderRegistry } from "./providers/registry.js";

export interface CliIo {
  write(line: string): void;
}

export function buildCli(io: CliIo = { write: (line) => console.log(line) }): Command {
  const program = new Command();
  program.name("template-gateway").description("Operator CLI for template-gateway");

  program.command("doctor").description("Check local gateway configuration").action(() => {
    const config = loadConfig();
    io.write("template-gateway: ok");
    io.write(`apiBaseUrl: ${config.apiBaseUrl}`);
    io.write(`allowedEmailDomains: ${config.allowedEmailDomains.join(",")}`);
  });

  program.command("providers").description("List configured providers").action(() => {
    const registry = createProviderRegistry([]);
    const providers = registry.list();
    if (providers.length === 0) {
      io.write("No providers configured");
      return;
    }
    for (const provider of providers) {
      io.write(`${provider.slug}: ${provider.name} (${provider.mcpPath})`);
    }
  });

  return program;
}

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
  await buildCli().parseAsync(process.argv);
}
