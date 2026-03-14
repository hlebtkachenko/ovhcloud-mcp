import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";

function fmt(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

export function registerDomainTools(server: McpServer, ovh: OvhClient) {
  server.tool("ovh_domain_list", "List all domains in your OVH account", {}, async () => {
    const domains = await ovh.get<string[]>("/domain");
    const zones = await ovh.get<string[]>("/domain/zone");
    const lines = ["# Domains", ...domains.map((d) => `- ${d}`), "", "# DNS Zones", ...zones.map((z) => `- ${z}`)];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  const zoneName = {
    zone: z.string().describe("DNS zone name (domain name, e.g. example.com). Use ovh_domain_list to find it."),
  };

  server.tool("ovh_domain_zone_info", "Get DNS zone details", zoneName, async ({ zone }) => {
    const info = await ovh.get<Record<string, unknown>>(`/domain/zone/${zone}`);
    return {
      content: [{
        type: "text",
        text: [
          `# Zone: ${zone}`,
          `- Has DNS Anywhere: ${info.hasDnsAnycast}`,
          `- Name servers: ${(info.nameServers as string[] | undefined)?.join(", ") || "n/a"}`,
          `- Last update: ${info.lastUpdate}`,
          `- DNSSEC: ${info.dnssecSupported ? "supported" : "not supported"}`,
        ].join("\n"),
      }],
    };
  });

  server.tool(
    "ovh_domain_dns_records",
    "List DNS records for a zone (optionally filter by type or subdomain)",
    {
      zone: zoneName.zone,
      fieldType: z.string().optional().describe("Filter by record type (A, AAAA, CNAME, MX, TXT, etc.)"),
      subDomain: z.string().optional().describe("Filter by subdomain (e.g. 'www', '@' for root)"),
    },
    async ({ zone, fieldType, subDomain }) => {
      const query: Record<string, string> = {};
      if (fieldType) query.fieldType = fieldType;
      if (subDomain) query.subDomain = subDomain;

      const ids = await ovh.get<number[]>(`/domain/zone/${zone}/record`, query);
      if (!ids.length) return { content: [{ type: "text", text: "No records found." }] };

      const batchSize = 20;
      const records: Record<string, unknown>[] = [];
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((id) => ovh.get<Record<string, unknown>>(`/domain/zone/${zone}/record/${id}`)),
        );
        records.push(...results);
      }

      const lines = [`# DNS Records for ${zone}`, `Total: ${records.length}`, ""];
      for (const r of records) {
        const sub = r.subDomain || "@";
        lines.push(`- **${r.fieldType}** ${sub} → ${r.target} (TTL: ${r.ttl}, ID: ${r.id})`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "ovh_domain_dns_record_detail",
    "Get a specific DNS record by ID",
    {
      zone: zoneName.zone,
      recordId: z.number().describe("DNS record ID (from ovh_domain_dns_records)"),
    },
    async ({ zone, recordId }) => {
      const r = await ovh.get<Record<string, unknown>>(`/domain/zone/${zone}/record/${recordId}`);
      return { content: [{ type: "text", text: `# DNS Record #${recordId}\n\`\`\`json\n${fmt(r)}\n\`\`\`` }] };
    },
  );

  server.tool(
    "ovh_domain_dns_create",
    "Create a new DNS record",
    {
      zone: zoneName.zone,
      fieldType: z.string().describe("Record type: A, AAAA, CNAME, MX, TXT, SRV, etc."),
      subDomain: z.string().describe("Subdomain (use empty string for root)"),
      target: z.string().describe("Record value (IP, hostname, text, etc.)"),
      ttl: z.number().optional().default(3600).describe("TTL in seconds (default 3600)"),
    },
    async ({ zone, fieldType, subDomain, target, ttl }) => {
      const result = await ovh.post(`/domain/zone/${zone}/record`, {
        fieldType,
        subDomain,
        target,
        ttl,
      });
      await ovh.post(`/domain/zone/${zone}/refresh`);
      return {
        content: [{
          type: "text",
          text: `DNS record created and zone refreshed.\n\n\`\`\`json\n${fmt(result)}\n\`\`\``,
        }],
      };
    },
  );

  server.tool(
    "ovh_domain_dns_update",
    "Update an existing DNS record",
    {
      zone: zoneName.zone,
      recordId: z.number().describe("DNS record ID"),
      subDomain: z.string().optional().describe("New subdomain value"),
      target: z.string().optional().describe("New target value"),
      ttl: z.number().optional().describe("New TTL"),
    },
    async ({ zone, recordId, subDomain, target, ttl }) => {
      const body: Record<string, unknown> = {};
      if (subDomain !== undefined) body.subDomain = subDomain;
      if (target !== undefined) body.target = target;
      if (ttl !== undefined) body.ttl = ttl;

      await ovh.put(`/domain/zone/${zone}/record/${recordId}`, body);
      await ovh.post(`/domain/zone/${zone}/refresh`);
      return { content: [{ type: "text", text: `DNS record #${recordId} updated and zone refreshed.` }] };
    },
  );

  server.tool(
    "ovh_domain_dns_delete",
    "Delete a DNS record (careful!)",
    {
      zone: zoneName.zone,
      recordId: z.number().describe("DNS record ID to delete"),
    },
    async ({ zone, recordId }) => {
      await ovh.del(`/domain/zone/${zone}/record/${recordId}`);
      await ovh.post(`/domain/zone/${zone}/refresh`);
      return { content: [{ type: "text", text: `DNS record #${recordId} deleted and zone refreshed.` }] };
    },
  );

  server.tool("ovh_domain_dns_refresh", "Force refresh a DNS zone", zoneName, async ({ zone }) => {
    await ovh.post(`/domain/zone/${zone}/refresh`);
    return { content: [{ type: "text", text: `Zone ${zone} refreshed.` }] };
  });
}
