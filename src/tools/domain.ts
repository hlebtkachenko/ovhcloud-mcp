import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";

const zone = z.string().describe("DNS zone (domain name, e.g. example.com)");

interface DnsRecord {
  id: number;
  fieldType: string;
  subDomain: string;
  target: string;
  ttl: number;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}: ${raw.slice(0, 100)}`);
  }
}

export function registerDomainTools(server: McpServer, ovh: OvhClient) {
  server.tool("ovh_domain_list", "List all domains in your OVH account", {}, async () => {
    const [domains, zones] = await Promise.all([
      ovh.get<string[]>("/domain"),
      ovh.get<string[]>("/domain/zone"),
    ]);
    const lines = [
      "# Domains",
      ...domains.map((d) => `- ${d}`),
      "",
      "# DNS Zones",
      ...zones.map((z) => `- ${z}`),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool("ovh_domain_zone_info", "Get DNS zone details", { zone }, async ({ zone: z }) => {
    const info = await ovh.get<Record<string, unknown>>(`/domain/zone/${z}`);
    const ns = (info.nameServers as string[])?.join(", ") || "n/a";
    const lines = [
      `# Zone: ${z}`,
      `- DNSSEC: ${info.dnssecSupported ? "supported" : "not supported"}`,
      `- Name servers: ${ns}`,
      `- Last update: ${info.lastUpdate}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool(
    "ovh_domain_dns_records",
    "List DNS records for a zone (optionally filter by type or subdomain)",
    {
      zone,
      fieldType: z.string().optional().describe("Filter by record type (A, CNAME, MX, TXT, etc.)"),
      subDomain: z.string().optional().describe("Filter by subdomain (www, @, mail, etc.)"),
    },
    async ({ zone: z, fieldType, subDomain }) => {
      const query: Record<string, string> = {};
      if (fieldType) query.fieldType = fieldType;
      if (subDomain) query.subDomain = subDomain;

      const ids = await ovh.get<number[]>(`/domain/zone/${z}/record`, query);
      if (!ids.length) return { content: [{ type: "text", text: "No records found." }] };

      const records: DnsRecord[] = [];
      for (let i = 0; i < ids.length; i += 20) {
        const batch = await Promise.all(
          ids.slice(i, i + 20).map((id) => ovh.get<DnsRecord>(`/domain/zone/${z}/record/${id}`)),
        );
        records.push(...batch);
      }

      const lines = [`# DNS Records for ${z} (${records.length})`, ""];
      for (const r of records) {
        lines.push(`- **${r.fieldType}** ${r.subDomain || "@"} → ${r.target} (TTL: ${r.ttl}, id: ${r.id})`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "ovh_domain_dns_record_detail",
    "Get a specific DNS record by ID",
    { zone, recordId: z.number().describe("DNS record ID") },
    async ({ zone: z, recordId }) => {
      const r = await ovh.get<DnsRecord>(`/domain/zone/${z}/record/${recordId}`);
      return { content: [{ type: "text", text: `# Record #${recordId}\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\`` }] };
    },
  );

  server.tool(
    "ovh_domain_dns_create",
    "Create a new DNS record",
    {
      zone,
      fieldType: z.string().describe("Record type: A, AAAA, CNAME, MX, TXT, SRV, etc."),
      subDomain: z.string().describe("Subdomain (empty string for root)"),
      target: z.string().describe("Record value (IP, hostname, text)"),
      ttl: z.number().optional().default(3600).describe("TTL in seconds"),
    },
    async ({ zone: z, fieldType, subDomain, target, ttl }) => {
      const result = await ovh.post(`/domain/zone/${z}/record`, { fieldType, subDomain, target, ttl });
      await ovh.post(`/domain/zone/${z}/refresh`);
      return { content: [{ type: "text", text: `Record created and zone refreshed.\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`` }] };
    },
  );

  server.tool(
    "ovh_domain_dns_update",
    "Update an existing DNS record",
    {
      zone,
      recordId: z.number().describe("DNS record ID"),
      subDomain: z.string().optional(),
      target: z.string().optional(),
      ttl: z.number().optional(),
    },
    async ({ zone: z, recordId, subDomain, target, ttl }) => {
      const body: Record<string, unknown> = {};
      if (subDomain !== undefined) body.subDomain = subDomain;
      if (target !== undefined) body.target = target;
      if (ttl !== undefined) body.ttl = ttl;
      await ovh.put(`/domain/zone/${z}/record/${recordId}`, body);
      await ovh.post(`/domain/zone/${z}/refresh`);
      return { content: [{ type: "text", text: `Record #${recordId} updated and zone refreshed.` }] };
    },
  );

  server.tool(
    "ovh_domain_dns_delete",
    "Delete a DNS record (careful!)",
    { zone, recordId: z.number().describe("DNS record ID to delete") },
    async ({ zone: z, recordId }) => {
      await ovh.del(`/domain/zone/${z}/record/${recordId}`);
      await ovh.post(`/domain/zone/${z}/refresh`);
      return { content: [{ type: "text", text: `Record #${recordId} deleted and zone refreshed.` }] };
    },
  );

  server.tool("ovh_domain_dns_refresh", "Force refresh a DNS zone", { zone }, async ({ zone: z }) => {
    await ovh.post(`/domain/zone/${z}/refresh`);
    return { content: [{ type: "text", text: `Zone ${z} refreshed.` }] };
  });

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
      const parsed = body ? parseJson(body, "body") : undefined;
      const result = await ovh.request(method, path, parsed, query);
      return { content: [{ type: "text", text: `# ${method} ${path}\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`` }] };
    },
  );
}
