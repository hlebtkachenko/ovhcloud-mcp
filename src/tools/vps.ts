import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";

function fmt(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

export function registerVpsTools(server: McpServer, ovh: OvhClient) {
  server.tool("ovh_vps_list", "List all VPS services on your OVH account", {}, async () => {
    const names = await ovh.get<string[]>("/vps");
    if (!names.length) return { content: [{ type: "text", text: "No VPS found." }] };

      const details = await Promise.all(
      names.map(async (name) => {
        try {
          const info = await ovh.get<Record<string, unknown>>(`/vps/${name}`);
          const model = info.model as Record<string, unknown> | undefined;
          return `## ${name}\n- State: ${info.state}\n- Model: ${model?.name ?? "n/a"}\n- RAM: ${model?.ram ?? "?"} MB\n- Disk: ${model?.disk ?? "?"} GB\n- vCores: ${model?.vcore ?? "?"}\n- Zone: ${info.zone}\n- OS: ${info.displayName || info.name}`;
        } catch {
          return `## ${name}\n(details unavailable)`;
        }
      }),
    );
    return { content: [{ type: "text", text: details.join("\n\n") }] };
  });

  const vpsName = { serviceName: z.string().describe("VPS service name (e.g. vps-xxxxxxxx.vps.ovh.net). Use ovh_vps_list to find it.") };

  server.tool("ovh_vps_info", "Get detailed VPS information", vpsName, async ({ serviceName }) => {
    const [info, serviceInfos, ips] = await Promise.all([
      ovh.get<Record<string, unknown>>(`/vps/${serviceName}`),
      ovh.get<Record<string, unknown>>(`/vps/${serviceName}/serviceInfos`),
      ovh.get<string[]>(`/vps/${serviceName}/ips`),
    ]);

    const lines = [
      `# VPS: ${serviceName}`,
      "",
      "## Server",
      `- State: ${info.state}`,
      `- Display name: ${info.displayName}`,
      `- Datacenter: ${info.zone}`,
      `- OS: ${info.name}`,
      `- Keymap: ${info.keymap}`,
      `- Monitoring: ${(info.monitoringIpBlocks as unknown[] | undefined)?.length ? "enabled" : "disabled"}`,
      `- SLA monitoring: ${info.slaMonitoring}`,
      "",
      "## Hardware",
      `- Model: ${(info.model as Record<string,unknown>)?.name ?? "n/a"}`,
      `- RAM: ${(info.model as Record<string,unknown>)?.ram ?? "?"} MB`,
      `- Disk: ${(info.model as Record<string,unknown>)?.disk ?? "?"} GB`,
      `- vCores: ${(info.model as Record<string,unknown>)?.vcore ?? "?"}`,
      "",
      "## IPs",
      ...ips.map((ip) => `- ${ip}`),
      "",
      "## Service",
      `- Status: ${serviceInfos.status}`,
      `- Expiration: ${serviceInfos.expiration}`,
      `- Renew: ${(serviceInfos.renew as Record<string,unknown>)?.automatic ? "automatic" : "manual"}`,
      `- Creation: ${serviceInfos.creation}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });

  server.tool(
    "ovh_vps_monitoring",
    "Get VPS usage statistics (CPU, network RX/TX)",
    {
      serviceName: vpsName.serviceName,
      type: z.enum(["cpu", "net:rx", "net:tx"]).default("cpu").describe("Metric type"),
      period: z.enum(["lastday", "lastweek", "lastmonth", "lastyear"]).default("lastday").describe("Time period"),
    },
    async ({ serviceName, type, period }) => {
      const data = await ovh.get<Record<string, unknown>>(
        `/vps/${serviceName}/use`,
        { type, period },
      );
      return { content: [{ type: "text", text: `# VPS Monitoring: ${type} (${period})\n\n\`\`\`json\n${fmt(data)}\n\`\`\`` }] };
    },
  );

  server.tool("ovh_vps_ips", "List all IPs assigned to a VPS", vpsName, async ({ serviceName }) => {
    const ips = await ovh.get<string[]>(`/vps/${serviceName}/ips`);
    return { content: [{ type: "text", text: ips.length ? ips.map((ip) => `- ${ip}`).join("\n") : "No IPs found." }] };
  });

  server.tool("ovh_vps_reboot", "Reboot a VPS (careful!)", vpsName, async ({ serviceName }) => {
    const result = await ovh.post(`/vps/${serviceName}/reboot`);
    return { content: [{ type: "text", text: `Reboot initiated for ${serviceName}.\n\n${fmt(result)}` }] };
  });

  server.tool("ovh_vps_start", "Start a stopped VPS", vpsName, async ({ serviceName }) => {
    const result = await ovh.post(`/vps/${serviceName}/start`);
    return { content: [{ type: "text", text: `Start initiated for ${serviceName}.\n\n${fmt(result)}` }] };
  });

  server.tool("ovh_vps_stop", "Stop a running VPS (careful!)", vpsName, async ({ serviceName }) => {
    const result = await ovh.post(`/vps/${serviceName}/stop`);
    return { content: [{ type: "text", text: `Stop initiated for ${serviceName}.\n\n${fmt(result)}` }] };
  });

  server.tool("ovh_vps_snapshot", "Get VPS snapshot information", vpsName, async ({ serviceName }) => {
    try {
      const snap = await ovh.get<Record<string, unknown>>(`/vps/${serviceName}/snapshot`);
      return {
        content: [{
          type: "text",
          text: `# Snapshot for ${serviceName}\n- Created: ${snap.creationDate}\n- Description: ${snap.description || "(none)"}\n\nFull data:\n\`\`\`json\n${fmt(snap)}\n\`\`\``,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `No snapshot exists for ${serviceName}.\n\n${String(e)}` }] };
    }
  });

  server.tool(
    "ovh_vps_create_snapshot",
    "Create a new VPS snapshot (overwrites existing)",
    {
      serviceName: vpsName.serviceName,
      description: z.string().optional().describe("Snapshot description"),
    },
    async ({ serviceName, description }) => {
      const result = await ovh.post(`/vps/${serviceName}/createSnapshot`, description ? { description } : undefined);
      return { content: [{ type: "text", text: `Snapshot creation initiated for ${serviceName}.\n\n${fmt(result)}` }] };
    },
  );
}
