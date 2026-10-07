import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OvhApiError, type OvhClient } from "../ovh-client.js";
import { apiPath, errorResult, READ_ONLY, textResult } from "./utils.js";

function priceText(val: unknown): string {
  if (!val) return "n/a";
  if (typeof val === "object" && val !== null && "text" in val) return String((val as Record<string, unknown>).text);
  return String(val);
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

interface ExpandedService {
  serviceId: number;
  resource?: { name?: string; displayName?: string; state?: string; product?: { name?: string } };
  route?: { path?: string };
  billing?: {
    expirationDate?: string;
    nextBillingDate?: string;
    renew?: { current?: { mode?: string; period?: string } };
    lifecycle?: { current?: { state?: string; creationDate?: string } };
  };
}

export function registerAccountTools(server: McpServer, ovh: OvhClient) {
  server.registerTool("ovh_account_info", { description: "Get OVH account details (name, email, country, etc.)", annotations: READ_ONLY }, async () => {
    try {
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
      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool("ovh_services", { description: "List all OVH services with state, renewal mode and expiration", annotations: READ_ONLY }, async () => {
    try {
      const ids = await ovh.get<number[]>("/services");
      if (!ids.length) return textResult("No services found.");

      const services = await inBatches(ids, 10, (id) => ovh.get<ExpandedService>(apiPath`/services/${id}`));

      const lines = [`# OVH Services (${services.length})`, ""];
      for (const { serviceId, resource: r = {}, billing: b = {} } of services) {
        const renew = b.renew?.current ?? {};
        const life = b.lifecycle?.current ?? {};
        const fields: Array<[string, unknown]> = [
          ["Resource", r.name],
          ["Product", r.product?.name],
          ["State", r.state],
          ["Lifecycle", life.state],
          ["Renew", renew.mode && `${renew.mode}${renew.period ? ` (${renew.period})` : ""}`],
          ["Expiration", b.expirationDate],
          ["Next billing", b.nextBillingDate],
          ["Creation", life.creationDate],
        ];
        lines.push(`## ${serviceId} — ${r.displayName || r.name || "unknown"}`, ...fields.map(([k, v]) => `- ${k}: ${v ?? "n/a"}`), "");
      }
      return textResult(lines.join("\n"));
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool(
    "ovh_invoices",
    {
      description: "List invoices (bills) in a date range, newest first",
      inputSchema: {
        limit: z.number().int().positive().optional().default(10).describe("Max invoices to return"),
        from: isoDate.optional().describe("Bills dated on or after this day, YYYY-MM-DD (default: one year ago)"),
        to: isoDate.optional().describe("Bills dated on or before this day, YYYY-MM-DD"),
      },
      annotations: READ_ONLY,
    },
    async ({ limit, from, to }) => {
      try {
        const query: Record<string, string> = {
          "date.from": from ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10),
        };
        if (to) query["date.to"] = to;
        const ids = await ovh.get<string[]>("/me/bill", query);
        if (!ids.length) return textResult(`No invoices from ${query["date.from"]}${to ? ` to ${to}` : ""}.`);

        // /me/bill returns ids in no documented order, so fetch the window and sort by date.
        const bills = (await inBatches(ids, 10, (id) => ovh.get<Record<string, unknown>>(apiPath`/me/bill/${id}`)))
          .sort((a, b) => String(b.date).localeCompare(String(a.date)))
          .slice(0, limit);

        const lines = [`# Invoices (${bills.length} of ${ids.length} since ${query["date.from"]})`, ""];
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
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ovh_invoice_detail",
    { description: "Get full details of a specific invoice", inputSchema: { billId: z.string().describe("Invoice/bill ID") }, annotations: READ_ONLY },
    async ({ billId }) => {
      try {
        const { password: _password, ...bill } = await ovh.get<Record<string, unknown>>(apiPath`/me/bill/${billId}`);
        let detailText = "";
        try {
          const detailIds = await ovh.get<string[]>(apiPath`/me/bill/${billId}/details`);
          if (detailIds.length) {
            const details = await inBatches(detailIds, 10, (id) => ovh.get<Record<string, unknown>>(apiPath`/me/bill/${billId}/details/${id}`));
            detailText = "\n\n## Line Items\n" + details
              .map((d) => `- ${d.description}: ${priceText(d.totalPrice)} (qty: ${d.quantity})`)
              .join("\n");
          }
        } catch (err) {
          if (!(err instanceof OvhApiError && err.status === 404)) throw err;
        }

        return textResult(`# Invoice ${billId}\n\`\`\`json\n${JSON.stringify(bill, null, 2)}\n\`\`\`${detailText}`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
