import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";
import { TIMEOUT_MS } from "../ovh-client.js";
import { textResult } from "./utils.js";

interface SpecEndpoint {
  httpMethod: string;
  path: string;
  description?: string;
  parameters?: Array<{ name: string; dataType: string; required: boolean; paramType: string; description?: string }>;
}

let cachedApis: string[] | null = null;
const specCache = new Map<string, SpecEndpoint[]>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
  return (await res.json()) as T;
}

async function listApis(baseUrl: string): Promise<string[]> {
  if (cachedApis) return cachedApis;
  const data = await fetchJson<{ apis: Array<{ path: string }> }>(baseUrl);
  cachedApis = data.apis.map((a) => a.path);
  return cachedApis;
}

async function getApiSpec(baseUrl: string, apiPath: string): Promise<SpecEndpoint[]> {
  const cached = specCache.get(apiPath);
  if (cached) return cached;

  const data = await fetchJson<{ apis: Array<{ path: string; operations: Array<{ httpMethod: string; description?: string; parameters?: SpecEndpoint["parameters"] }> }> }>(
    `${baseUrl}${apiPath}`,
  );

  const endpoints: SpecEndpoint[] = [];
  for (const api of data.apis) {
    for (const op of api.operations) {
      endpoints.push({
        httpMethod: op.httpMethod,
        path: api.path,
        description: op.description,
        parameters: op.parameters,
      });
    }
  }

  specCache.set(apiPath, endpoints);
  return endpoints;
}

export function registerExplorerTools(server: McpServer, ovh: OvhClient) {
  const baseUrl = ovh.baseUrl;

  server.tool(
    "ovh_api_catalog",
    "List all available OVH API categories (vps, domain, cloud, dedicated, email, etc.)",
    {},
    async () => {
      try {
        const apis = await listApis(baseUrl);
        const lines = [`# OVH API Catalog (${apis.length} categories)`, ""];
        for (const a of apis) lines.push(`- ${a}`);
        lines.push("", "Use **ovh_api_search** to explore endpoints within a category.");
        return textResult(lines.join("\n"));
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "ovh_api_search",
    "Search OVH API endpoints by keyword or path pattern. Searches endpoint paths and descriptions across all (or specific) API categories.",
    {
      query: z.string().describe("Search keyword (e.g. 'snapshot', 'email', 'kubernetes', 'ip block')"),
      category: z.string().optional().describe("Limit to API category (e.g. '/vps', '/cloud', '/domain'). Omit to search all."),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("Filter by HTTP method"),
    },
    async ({ query, category, method }) => {
      try {
        const apis = await listApis(baseUrl);
        const q = query.toLowerCase();

        const searchIn = category
          ? apis.filter((a) => a === category || a.startsWith(category + "/"))
          : apis;

        if (!searchIn.length) {
          return textResult(`No API category matching "${category}".`);
        }

        const matches: Array<{ method: string; path: string; desc: string }> = [];
        const errors: string[] = [];

        const batchSize = 5;
        for (let i = 0; i < searchIn.length; i += batchSize) {
          const batch = searchIn.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map((api) => getApiSpec(baseUrl, api)),
          );

          for (let j = 0; j < results.length; j++) {
            const r = results[j];
            if (r.status === "rejected") {
              errors.push(batch[j]);
              continue;
            }
            for (const ep of r.value) {
              if (method && ep.httpMethod !== method) continue;
              const haystack = `${ep.path} ${ep.description || ""}`.toLowerCase();
              if (haystack.includes(q)) {
                matches.push({
                  method: ep.httpMethod,
                  path: ep.path,
                  desc: ep.description || "",
                });
              }
            }
          }

          if (matches.length >= 50) break;
        }

        if (!matches.length) {
          return textResult(`No endpoints matching "${query}"${category ? ` in ${category}` : ""}.`);
        }

        const lines = [`# API Search: "${query}" (${matches.length} results)`, ""];
        for (const m of matches.slice(0, 50)) {
          lines.push(`- **${m.method}** \`${m.path}\` — ${m.desc}`);
        }
        if (matches.length > 50) lines.push(`\n... and ${matches.length - 50} more`);
        lines.push("", "Use **ovh_api_endpoint_detail** to see parameters, or **ovh_api_raw** to call directly.");
        return textResult(lines.join("\n"));
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "ovh_api_endpoint_detail",
    "Get full details for a specific API endpoint (parameters, types, descriptions)",
    {
      path: z.string().describe("API endpoint path (e.g. /vps/{serviceName}/snapshot)"),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().default("GET"),
    },
    async ({ path: targetPath, method: targetMethod }) => {
      try {
        const apis = await listApis(baseUrl);
        const prefix = "/" + targetPath.replace(/^\//, "").split("/").slice(0, 1)[0];
        const matchingApis = apis.filter((a) => a.startsWith(prefix));

        for (const api of matchingApis) {
          const endpoints = await getApiSpec(baseUrl, api);
          const ep = endpoints.find(
            (e) => e.path === targetPath && (!targetMethod || e.httpMethod === targetMethod),
          );

          if (ep) {
            const lines = [`# ${ep.httpMethod} ${ep.path}`, ""];
            if (ep.description) lines.push(ep.description, "");
            if (ep.parameters?.length) {
              lines.push("## Parameters", "");
              for (const p of ep.parameters) {
                const req = p.required ? "**required**" : "optional";
                lines.push(`- \`${p.name}\` (${p.dataType}, ${p.paramType}, ${req})${p.description ? ` — ${p.description}` : ""}`);
              }
            } else {
              lines.push("No parameters.");
            }
            return textResult(lines.join("\n"));
          }
        }

        return textResult(`Endpoint not found: ${targetMethod || "GET"} ${targetPath}`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
}
