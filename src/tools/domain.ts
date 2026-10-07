import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";
import { apiPath, errorResult, READ_ONLY, textResult } from "./utils.js";

const zoneParam = z.string().describe("DNS zone (domain name, e.g. example.com)");

interface DnsRecord {
  id: number;
  fieldType: string;
  subDomain: string;
  target: string;
  ttl: number;
}

const WRITE = { readOnlyHint: false, openWorldHint: false } as const;

export function registerDomainTools(server: McpServer, ovh: OvhClient) {
  /** The write already succeeded; a failed refresh must not read as a failed write. */
  async function refreshAfter(zone: string, done: string) {
    try {
      await ovh.post(apiPath`/domain/zone/${zone}/refresh`);
      return textResult(`${done} Zone refreshed.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ...textResult(`${done}\nZone refresh failed: ${msg}\nThe change is saved but not live yet; run ovh_domain_dns_refresh.`), isError: true };
    }
  }

  server.registerTool("ovh_domain_list", { description: "List all domains in your OVH account", annotations: READ_ONLY }, async () => {
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
      return errorResult(err);
    }
  });

  server.registerTool("ovh_domain_zone_info", { description: "Get DNS zone details", inputSchema: { zone: zoneParam }, annotations: READ_ONLY }, async ({ zone }) => {
    try {
      const info = await ovh.get<Record<string, unknown>>(apiPath`/domain/zone/${zone}`);
      const ns = (info.nameServers as string[])?.join(", ") || "n/a";
      const lines = [
        `# Zone: ${zone}`,
        `- DNSSEC: ${info.dnssecSupported ? "supported" : "not supported"}`,
        `- Name servers: ${ns}`,
        `- Last update: ${info.lastUpdate}`,
      ];
      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool(
    "ovh_domain_dns_records",
    {
      description: "List DNS records for a zone (optionally filter by type or subdomain)",
      inputSchema: {
        zone: zoneParam,
        fieldType: z.string().optional().describe("Filter by record type (A, CNAME, MX, TXT, etc.)"),
        subDomain: z.string().optional().describe("Filter by subdomain (www, @, mail, etc.)"),
      },
      annotations: READ_ONLY,
    },
    async ({ zone, fieldType, subDomain }) => {
      try {
        const query: Record<string, string> = {};
        if (fieldType) query.fieldType = fieldType;
        if (subDomain) query.subDomain = subDomain;

        const ids = await ovh.get<number[]>(apiPath`/domain/zone/${zone}/record`, query);
        if (!ids.length) return textResult("No records found.");

        const records: DnsRecord[] = [];
        for (let i = 0; i < ids.length; i += 20) {
          const batch = await Promise.all(
            ids.slice(i, i + 20).map((id) => ovh.get<DnsRecord>(apiPath`/domain/zone/${zone}/record/${id}`)),
          );
          records.push(...batch);
        }

        const lines = [`# DNS Records for ${zone} (${records.length})`, ""];
        for (const r of records) {
          lines.push(`- **${r.fieldType}** ${r.subDomain || "@"} → ${r.target} (TTL: ${r.ttl}, id: ${r.id})`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ovh_domain_dns_record_detail",
    { description: "Get a specific DNS record by ID", inputSchema: { zone: zoneParam, recordId: z.number().describe("DNS record ID") }, annotations: READ_ONLY },
    async ({ zone, recordId }) => {
      try {
        const r = await ovh.get<DnsRecord>(apiPath`/domain/zone/${zone}/record/${recordId}`);
        return textResult(`# Record #${recordId}\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\``);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ovh_domain_dns_create",
    {
      description: "Create a new DNS record, then refresh the zone",
      inputSchema: {
        zone: zoneParam,
        fieldType: z.string().describe("Record type: A, AAAA, CNAME, MX, TXT, SRV, etc."),
        subDomain: z.string().describe("Subdomain (empty string for root)"),
        target: z.string().describe("Record value (IP, hostname, text)"),
        ttl: z.number().optional().default(3600).describe("TTL in seconds"),
      },
      annotations: { ...WRITE, destructiveHint: false, idempotentHint: false },
    },
    async ({ zone, fieldType, subDomain, target, ttl }) => {
      let result: unknown;
      try {
        result = await ovh.post(apiPath`/domain/zone/${zone}/record`, { fieldType, subDomain, target, ttl });
      } catch (err) {
        return errorResult(err, "ovh_domain_dns_records");
      }
      return refreshAfter(zone, `Record created.\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
    },
  );

  server.registerTool(
    "ovh_domain_dns_update",
    {
      description: "Update an existing DNS record, then refresh the zone",
      inputSchema: {
        zone: zoneParam,
        recordId: z.number().describe("DNS record ID"),
        subDomain: z.string().optional(),
        target: z.string().optional(),
        ttl: z.number().optional(),
      },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    async ({ zone, recordId, subDomain, target, ttl }) => {
      const body: Record<string, unknown> = {};
      if (subDomain !== undefined) body.subDomain = subDomain;
      if (target !== undefined) body.target = target;
      if (ttl !== undefined) body.ttl = ttl;
      try {
        await ovh.put(apiPath`/domain/zone/${zone}/record/${recordId}`, body);
      } catch (err) {
        return errorResult(err, "ovh_domain_dns_record_detail");
      }
      return refreshAfter(zone, `Record #${recordId} updated.`);
    },
  );

  server.registerTool(
    "ovh_domain_dns_delete",
    {
      description: "Delete a DNS record, then refresh the zone (careful!)",
      inputSchema: { zone: zoneParam, recordId: z.number().describe("DNS record ID to delete") },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    async ({ zone, recordId }) => {
      try {
        await ovh.del(apiPath`/domain/zone/${zone}/record/${recordId}`);
      } catch (err) {
        return errorResult(err, "ovh_domain_dns_record_detail");
      }
      return refreshAfter(zone, `Record #${recordId} deleted.`);
    },
  );

  server.registerTool(
    "ovh_domain_dns_refresh",
    { description: "Force refresh a DNS zone", inputSchema: { zone: zoneParam }, annotations: { ...WRITE, destructiveHint: false, idempotentHint: true } },
    async ({ zone }) => {
      try {
        await ovh.post(apiPath`/domain/zone/${zone}/refresh`);
        return textResult(`Zone ${zone} refreshed.`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
