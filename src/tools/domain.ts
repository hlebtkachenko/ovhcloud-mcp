import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";
import { textResult } from "./utils.js";

const zoneParam = z.string().describe("DNS zone (domain name, e.g. example.com)");

interface DnsRecord {
  id: number;
  fieldType: string;
  subDomain: string;
  target: string;
  ttl: number;
}

export function registerDomainTools(server: McpServer, ovh: OvhClient) {
  server.tool("ovh_domain_list", "List all domains in your OVH account", {}, async () => {
    try {
      const [domains, zones] = await Promise.all([
        ovh.get<string[]>("/domain"),
        ovh.get<string[]>("/domain/zone"),
      ]);
      const lines = [
        "# Domains",
        ...domains.map((d) => `- ${d}`),
        "",
        "# DNS Zones",
        ...zones.map((zone) => `- ${zone}`),
      ];
      return textResult(lines.join("\n"));
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  });

  server.tool("ovh_domain_zone_info", "Get DNS zone details", { zone: zoneParam }, async ({ zone }) => {
    try {
      const info = await ovh.get<Record<string, unknown>>(`/domain/zone/${zone}`);
      const ns = (info.nameServers as string[])?.join(", ") || "n/a";
      const lines = [
        `# Zone: ${zone}`,
        `- DNSSEC: ${info.dnssecSupported ? "supported" : "not supported"}`,
        `- Name servers: ${ns}`,
        `- Last update: ${info.lastUpdate}`,
      ];
      return textResult(lines.join("\n"));
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  });

  server.tool(
    "ovh_domain_dns_records",
    "List DNS records for a zone (optionally filter by type or subdomain)",
    {
      zone: zoneParam,
      fieldType: z.string().optional().describe("Filter by record type (A, CNAME, MX, TXT, etc.)"),
      subDomain: z.string().optional().describe("Filter by subdomain (www, @, mail, etc.)"),
    },
    async ({ zone, fieldType, subDomain }) => {
      try {
        const query: Record<string, string> = {};
        if (fieldType) query.fieldType = fieldType;
        if (subDomain) query.subDomain = subDomain;

        const ids = await ovh.get<number[]>(`/domain/zone/${zone}/record`, query);
        if (!ids.length) return textResult("No records found.");

        const records: DnsRecord[] = [];
        for (let i = 0; i < ids.length; i += 20) {
          const batch = await Promise.all(
            ids.slice(i, i + 20).map((id) => ovh.get<DnsRecord>(`/domain/zone/${zone}/record/${id}`)),
          );
          records.push(...batch);
        }

        const lines = [`# DNS Records for ${zone} (${records.length})`, ""];
        for (const r of records) {
          lines.push(`- **${r.fieldType}** ${r.subDomain || "@"} → ${r.target} (TTL: ${r.ttl}, id: ${r.id})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "ovh_domain_dns_record_detail",
    "Get a specific DNS record by ID",
    { zone: zoneParam, recordId: z.number().describe("DNS record ID") },
    async ({ zone, recordId }) => {
      try {
        const r = await ovh.get<DnsRecord>(`/domain/zone/${zone}/record/${recordId}`);
        return textResult(`# Record #${recordId}\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\``);
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "ovh_domain_dns_create",
    "Create a new DNS record",
    {
      zone: zoneParam,
      fieldType: z.string().describe("Record type: A, AAAA, CNAME, MX, TXT, SRV, etc."),
      subDomain: z.string().describe("Subdomain (empty string for root)"),
      target: z.string().describe("Record value (IP, hostname, text)"),
      ttl: z.number().optional().default(3600).describe("TTL in seconds"),
    },
    async ({ zone, fieldType, subDomain, target, ttl }) => {
      try {
        const result = await ovh.post(`/domain/zone/${zone}/record`, { fieldType, subDomain, target, ttl });
        await ovh.post(`/domain/zone/${zone}/refresh`);
        return textResult(`Record created and zone refreshed.\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "ovh_domain_dns_update",
    "Update an existing DNS record",
    {
      zone: zoneParam,
      recordId: z.number().describe("DNS record ID"),
      subDomain: z.string().optional(),
      target: z.string().optional(),
      ttl: z.number().optional(),
    },
    async ({ zone, recordId, subDomain, target, ttl }) => {
      try {
        const body: Record<string, unknown> = {};
        if (subDomain !== undefined) body.subDomain = subDomain;
        if (target !== undefined) body.target = target;
        if (ttl !== undefined) body.ttl = ttl;
        await ovh.put(`/domain/zone/${zone}/record/${recordId}`, body);
        await ovh.post(`/domain/zone/${zone}/refresh`);
        return textResult(`Record #${recordId} updated and zone refreshed.`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "ovh_domain_dns_delete",
    "Delete a DNS record (careful!)",
    { zone: zoneParam, recordId: z.number().describe("DNS record ID to delete") },
    async ({ zone, recordId }) => {
      try {
        await ovh.del(`/domain/zone/${zone}/record/${recordId}`);
        await ovh.post(`/domain/zone/${zone}/refresh`);
        return textResult(`Record #${recordId} deleted and zone refreshed.`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool("ovh_domain_dns_refresh", "Force refresh a DNS zone", { zone: zoneParam }, async ({ zone }) => {
    try {
      await ovh.post(`/domain/zone/${zone}/refresh`);
      return textResult(`Zone ${zone} refreshed.`);
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  });
}
