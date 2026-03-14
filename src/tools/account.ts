import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";

function fmt(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

export function registerAccountTools(server: McpServer, ovh: OvhClient) {
  server.tool("ovh_account_info", "Get OVH account details (name, email, country, etc.)", {}, async () => {
    const me = await ovh.get<Record<string, unknown>>("/me");
    const lines = [
      "# OVH Account",
      `- Name: ${me.firstname} ${me.name}`,
      `- NIC handle: ${me.nichandle}`,
      `- Email: ${me.email}`,
      `- Country: ${me.country}`,
      `- Language: ${me.language}`,
      `- Currency: ${(me.currency as Record<string,unknown>)?.code || me.currency}`,
      `- Organisation: ${me.organisation || "n/a"}`,
      `- Company: ${me.companyNationalIdentificationNumber || "n/a"}`,
      `- State: ${me.state}`,
      `- OVH subsidiary: ${me.ovhSubsidiary}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool("ovh_services", "List all active OVH services", {}, async () => {
    const serviceIds = await ovh.get<number[]>("/me/service");
    if (!serviceIds.length) return { content: [{ type: "text", text: "No services found." }] };

    const batchSize = 10;
    const services: Record<string, unknown>[] = [];
    for (let i = 0; i < serviceIds.length; i += batchSize) {
      const batch = serviceIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((id) => ovh.get<Record<string, unknown>>(`/me/service/${id}`)),
      );
      services.push(...results);
    }

    const lines = [`# OVH Services (${services.length})`, ""];
    for (const s of services) {
      lines.push(
        `## ${s.serviceId} — ${(s.route as Record<string,unknown> | undefined)?.path || s.serviceType || "unknown"}`,
        `- Status: ${s.status}`,
        `- Renew: ${(s.renew as Record<string,unknown>)?.mode || "n/a"}`,
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
    {
      limit: z.number().optional().default(10).describe("Max invoices to return (default 10)"),
    },
    async ({ limit }) => {
      const billIds = await ovh.get<string[]>("/me/bill");
      if (!billIds.length) return { content: [{ type: "text", text: "No invoices found." }] };

      const recent = billIds.slice(-limit).reverse();
      const bills = await Promise.all(
        recent.map((id) => ovh.get<Record<string, unknown>>(`/me/bill/${id}`)),
      );

      const lines = [`# Recent Invoices (${bills.length} of ${billIds.length} total)`, ""];
      for (const b of bills) {
        lines.push(
          `## ${b.billId}`,
          `- Date: ${b.date}`,
          `- Amount: ${(b.priceWithTax as Record<string,unknown>)?.text || b.priceWithTax}`,
          `- Without tax: ${(b.priceWithoutTax as Record<string,unknown>)?.text || b.priceWithoutTax}`,
          `- Tax: ${(b.tax as Record<string,unknown>)?.text || b.tax}`,
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
    { billId: z.string().describe("Invoice/bill ID (from ovh_invoices)") },
    async ({ billId }) => {
      const bill = await ovh.get<Record<string, unknown>>(`/me/bill/${billId}`);
      let detailText = "";
      try {
        const detailIds = await ovh.get<number[]>(`/me/bill/${billId}/details`);
        if (detailIds.length) {
          const details = await Promise.all(
            detailIds.map((id) => ovh.get<Record<string, unknown>>(`/me/bill/${billId}/details/${id}`)),
          );
          detailText = "\n## Line Items\n" + details.map((d) =>
            `- ${d.description}: ${(d.totalPrice as Record<string,unknown>)?.text || d.totalPrice} (qty: ${d.quantity})`,
          ).join("\n");
        }
      } catch { /* details endpoint may not exist for all bills */ }

      return {
        content: [{
          type: "text",
          text: `# Invoice ${billId}\n\`\`\`json\n${fmt(bill)}\n\`\`\`${detailText}`,
        }],
      };
    },
  );

  server.tool(
    "ovh_api_raw",
    "Call any OVH API endpoint directly (advanced). See https://eu.api.ovh.com/console/ for all endpoints.",
    {
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET").describe("HTTP method"),
      path: z.string().describe("API path (e.g. /vps, /me, /domain/zone/example.com/record)"),
      body: z.string().optional().describe("JSON body for POST/PUT (as string)"),
      query: z.record(z.string()).optional().describe("Query parameters as key-value pairs"),
    },
    async ({ method, path, body, query }) => {
      const parsedBody = body ? JSON.parse(body) : undefined;
      const result = await ovh.request(method, path, parsedBody, query);
      return { content: [{ type: "text", text: `# ${method} ${path}\n\n\`\`\`json\n${fmt(result)}\n\`\`\`` }] };
    },
  );
}
