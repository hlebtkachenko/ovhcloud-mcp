import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}: ${raw.slice(0, 100)}`);
  }
}

function priceText(val: unknown): string {
  if (!val) return "n/a";
  if (typeof val === "object" && val !== null && "text" in val) return String((val as Record<string, unknown>).text);
  return String(val);
}

export function registerAccountTools(server: McpServer, ovh: OvhClient) {
  server.tool("ovh_account_info", "Get OVH account details (name, email, country, etc.)", {}, async () => {
    const me = await ovh.get<Record<string, unknown>>("/me");
    const currency = typeof me.currency === "object" && me.currency !== null
      ? (me.currency as Record<string, unknown>).code
      : me.currency;
    const lines = [
      "# OVH Account",
      `- Name: ${me.firstname} ${me.name}`,
      `- NIC handle: ${me.nichandle}`,
      `- Email: ${me.email}`,
      `- Country: ${me.country}`,
      `- Language: ${me.language}`,
      `- Currency: ${currency || "n/a"}`,
      `- Organisation: ${me.organisation || "n/a"}`,
      `- State: ${me.state}`,
      `- Subsidiary: ${me.ovhSubsidiary}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool("ovh_services", "List all active OVH services", {}, async () => {
    const ids = await ovh.get<number[]>("/me/service");
    if (!ids.length) return { content: [{ type: "text", text: "No services found." }] };

    const services: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = await Promise.all(
        ids.slice(i, i + 10).map((id) => ovh.get<Record<string, unknown>>(`/me/service/${id}`)),
      );
      services.push(...batch);
    }

    const lines = [`# OVH Services (${services.length})`, ""];
    for (const s of services) {
      const route = s.route as Record<string, unknown> | undefined;
      const renew = s.renew as Record<string, unknown> | undefined;
      lines.push(
        `## ${s.serviceId} — ${route?.path || s.serviceType || "unknown"}`,
        `- Status: ${s.status}`,
        `- Renew: ${renew?.mode || "n/a"}`,
        `- Expiration: ${s.expirationDate || "n/a"}`,
        `- Creation: ${s.creationDate || "n/a"}`,
        "",
      );
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool(
    "ovh_invoices",
    "List recent invoices (bills)",
    { limit: z.number().optional().default(10).describe("Max invoices to return") },
    async ({ limit }) => {
      const ids = await ovh.get<string[]>("/me/bill");
      if (!ids.length) return { content: [{ type: "text", text: "No invoices found." }] };

      const recent = ids.slice(-limit).reverse();
      const bills = await Promise.all(
        recent.map((id) => ovh.get<Record<string, unknown>>(`/me/bill/${id}`)),
      );

      const lines = [`# Recent Invoices (${bills.length} of ${ids.length} total)`, ""];
      for (const b of bills) {
        lines.push(
          `## ${b.billId}`,
          `- Date: ${b.date}`,
          `- Total: ${priceText(b.priceWithTax)}`,
          `- Net: ${priceText(b.priceWithoutTax)}`,
          `- Tax: ${priceText(b.tax)}`,
          `- PDF: ${b.pdfUrl || "n/a"}`,
          "",
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "ovh_invoice_detail",
    "Get full details of a specific invoice",
    { billId: z.string().describe("Invoice/bill ID") },
    async ({ billId }) => {
      const bill = await ovh.get<Record<string, unknown>>(`/me/bill/${billId}`);
      let detailText = "";
      try {
        const detailIds = await ovh.get<number[]>(`/me/bill/${billId}/details`);
        if (detailIds.length) {
          const details = await Promise.all(
            detailIds.map((id) => ovh.get<Record<string, unknown>>(`/me/bill/${billId}/details/${id}`)),
          );
          detailText = "\n\n## Line Items\n" + details
            .map((d) => `- ${d.description}: ${priceText(d.totalPrice)} (qty: ${d.quantity})`)
            .join("\n");
        }
      } catch { /* some bills lack details */ }

      return { content: [{ type: "text", text: `# Invoice ${billId}\n\`\`\`json\n${JSON.stringify(bill, null, 2)}\n\`\`\`${detailText}` }] };
    },
  );
}
