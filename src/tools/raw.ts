import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";
import { textResult } from "./utils.js";

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}: ${raw.slice(0, 100)}`);
  }
}

export function registerRawTools(server: McpServer, ovh: OvhClient) {
  server.tool(
    "ovh_api_raw",
    "Call any OVH API endpoint directly (advanced)",
    {
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),
      path: z.string().describe("API path (e.g. /vps, /me, /domain/zone/example.com/record)"),
      body: z.string().optional().describe("JSON body for POST/PUT"),
      query: z.record(z.string()).optional(),
    },
    async ({ method, path, body, query }) => {
      try {
        const parsed = body ? parseJson(body, "body") : undefined;
        const result = await ovh.request(method, path, parsed, query);
        return textResult(`# ${method} ${path}\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}
