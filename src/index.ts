import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OvhClient } from "./ovh-client.js";
import type { OvhConfig } from "./ovh-client.js";
import { registerVpsTools } from "./tools/vps.js";
import { registerDomainTools } from "./tools/domain.js";
import { registerAccountTools } from "./tools/account.js";
import { registerExplorerTools } from "./tools/explorer.js";
import { registerSshTools } from "./tools/ssh.js";

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

function required(name: string): string {
  const val = env(name);
  if (!val) {
    process.stderr.write(`Missing required env var: ${name}\n`);
    process.exit(1);
  }
  return val;
}

function detectAuthConfig(): OvhConfig {
  const clientId = env("OVH_CLIENT_ID");
  const clientSecret = env("OVH_CLIENT_SECRET");

  if (clientId && clientSecret) {
    process.stderr.write("Auth mode: OAuth2 (service account)\n");
    return {
      mode: "oauth2",
      endpoint: env("OVH_ENDPOINT") || "ovh-eu",
      clientId,
      clientSecret,
    };
  }

  process.stderr.write("Auth mode: API key (SHA1-HMAC)\n");
  return {
    mode: "apikey",
    endpoint: env("OVH_ENDPOINT") || "ovh-eu",
    appKey: required("OVH_APPLICATION_KEY"),
    appSecret: required("OVH_APPLICATION_SECRET"),
    consumerKey: required("OVH_CONSUMER_KEY"),
  };
}

const client = new OvhClient(detectAuthConfig());
const server = new McpServer({ name: "ovhcloud", version: "2.0.0" });

registerVpsTools(server, client);
registerDomainTools(server, client);
registerAccountTools(server, client);
registerExplorerTools(server, client);
registerSshTools(server);

await server.connect(new StdioServerTransport());
