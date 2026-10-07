import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";
import { errorResult, textResult } from "./utils.js";

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}: ${raw.slice(0, 100)}`);
  }
}

export function registerRawTools(server: McpServer, ovh: OvhClient, allowWrites: boolean) {
  server.registerTool(
    "ovh_api_raw",
    {
      description: `Call any OVH API endpoint directly (advanced). ${allowWrites ? "POST/PUT/DELETE are enabled." : "Only GET is enabled; POST/PUT/DELETE need OVH_ALLOW_RAW_WRITES=true on the server."}`,
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),
        path: z.string().describe("API path (e.g. /vps, /me, /domain/zone/example.com/record)"),
        body: z.string().optional().describe("JSON body for POST/PUT"),
        query: z.record(z.string(), z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ method, path, body, query }) => {
      if (method !== "GET" && !allowWrites) {
        return errorResult(new Error(`${method} via ovh_api_raw is disabled. Set OVH_ALLOW_RAW_WRITES=true in the server environment to allow raw writes.`));
      }
      try {
        const parsed = body ? parseJson(body, "body") : undefined;
        const result = await ovh.request(method, path, parsed, query);
        return textResult(`# ${method} ${path}\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
      } catch (err) {
        return errorResult(err, "ovh_api_raw with GET");
      }
    },
  );
}
