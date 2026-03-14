import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OvhClient } from "./ovh-client.js";
import { registerVpsTools } from "./tools/vps.js";
import { registerDomainTools } from "./tools/domain.js";
import { registerAccountTools } from "./tools/account.js";

const required = (name: string): string => {
  const val = process.env[name];
  if (!val) {
    process.stderr.write(`Missing env var: ${name}\n`);
    process.exit(1);
  }
  return val;
};

const client = new OvhClient({
  endpoint: process.env.OVH_ENDPOINT || "ovh-eu",
  appKey: required("OVH_APPLICATION_KEY"),
  appSecret: required("OVH_APPLICATION_SECRET"),
  consumerKey: required("OVH_CONSUMER_KEY"),
});

const server = new McpServer({
  name: "ovhcloud",
  version: "1.0.0",
});

registerVpsTools(server, client);
registerDomainTools(server, client);
registerAccountTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
