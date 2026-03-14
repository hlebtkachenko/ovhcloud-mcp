import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OvhClient } from "../ovh-client.js";

const serviceName = z.string().describe("VPS service name (e.g. vps-xxxxxxxx.vps.ovh.net)");

interface VpsModel {
  name?: string;
  ram?: number;
  disk?: number;
  vcore?: number;
}

interface VpsInfo {
  state: string;
  displayName: string;
  zone: string;
  name: string;
  keymap: string | null;
  slaMonitoring: boolean;
  monitoringIpBlocks: string[];
  model: VpsModel;
}

interface ServiceInfo {
  status: string;
  expiration: string;
  creation: string;
  renew: { automatic: boolean };
}

export function registerVpsTools(server: McpServer, ovh: OvhClient) {
  server.tool("ovh_vps_list", "List all VPS services on your OVH account", {}, async () => {
    const names = await ovh.get<string[]>("/vps");
    if (!names.length) return { content: [{ type: "text", text: "No VPS found." }] };

    const details = await Promise.all(
      names.map(async (name) => {
        try {
          const vps = await ovh.get<VpsInfo>(`/vps/${name}`);
          const m = vps.model;
          return [
            `## ${name}`,
            `- State: ${vps.state}`,
            `- Model: ${m?.name ?? "n/a"}`,
            `- RAM: ${m?.ram ?? "?"} MB, Disk: ${m?.disk ?? "?"} GB, vCores: ${m?.vcore ?? "?"}`,
            `- Zone: ${vps.zone}`,
          ].join("\n");
        } catch {
          return `## ${name}\n(details unavailable)`;
        }
      }),
    );
    return { content: [{ type: "text", text: details.join("\n\n") }] };
  });

  server.tool(
    "ovh_vps_info",
    "Get detailed VPS information",
    { serviceName },
    async ({ serviceName: sn }) => {
      const [vps, svc, ips] = await Promise.all([
        ovh.get<VpsInfo>(`/vps/${sn}`),
        ovh.get<ServiceInfo>(`/vps/${sn}/serviceInfos`),
        ovh.get<string[]>(`/vps/${sn}/ips`),
      ]);
      const m = vps.model;
      const lines = [
        `# VPS: ${sn}`,
        "",
        "## Server",
        `- State: ${vps.state}`,
        `- Display name: ${vps.displayName}`,
        `- Datacenter: ${vps.zone}`,
        `- Monitoring: ${vps.monitoringIpBlocks?.length ? "enabled" : "disabled"}`,
        "",
        "## Hardware",
        `- Model: ${m?.name ?? "n/a"}`,
        `- RAM: ${m?.ram ?? "?"} MB`,
        `- Disk: ${m?.disk ?? "?"} GB`,
        `- vCores: ${m?.vcore ?? "?"}`,
        "",
        "## IPs",
        ...ips.map((ip) => `- ${ip}`),
        "",
        "## Service",
        `- Status: ${svc.status}`,
        `- Expiration: ${svc.expiration}`,
        `- Renew: ${svc.renew?.automatic ? "automatic" : "manual"}`,
        `- Creation: ${svc.creation}`,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "ovh_vps_monitoring",
    "Get VPS usage statistics (CPU, network RX/TX)",
    {
      serviceName,
      type: z.enum(["cpu", "net:rx", "net:tx"]).default("cpu"),
      period: z.enum(["lastday", "lastweek", "lastmonth", "lastyear"]).default("lastday"),
    },
    async ({ serviceName: sn, type, period }) => {
      const data = await ovh.get(`/vps/${sn}/use`, { type, period });
      return { content: [{ type: "text", text: `# Monitoring: ${type} (${period})\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` }] };
    },
  );

  server.tool("ovh_vps_ips", "List all IPs assigned to a VPS", { serviceName }, async ({ serviceName: sn }) => {
    const ips = await ovh.get<string[]>(`/vps/${sn}/ips`);
    return { content: [{ type: "text", text: ips.length ? ips.map((ip) => `- ${ip}`).join("\n") : "No IPs." }] };
  });

  server.tool("ovh_vps_reboot", "Reboot a VPS (careful!)", { serviceName }, async ({ serviceName: sn }) => {
    await ovh.post(`/vps/${sn}/reboot`);
    return { content: [{ type: "text", text: `Reboot initiated for ${sn}.` }] };
  });

  server.tool("ovh_vps_start", "Start a stopped VPS", { serviceName }, async ({ serviceName: sn }) => {
    await ovh.post(`/vps/${sn}/start`);
    return { content: [{ type: "text", text: `Start initiated for ${sn}.` }] };
  });

  server.tool("ovh_vps_stop", "Stop a running VPS (careful!)", { serviceName }, async ({ serviceName: sn }) => {
    await ovh.post(`/vps/${sn}/stop`);
    return { content: [{ type: "text", text: `Stop initiated for ${sn}.` }] };
  });

  server.tool("ovh_vps_snapshot", "Get VPS snapshot information", { serviceName }, async ({ serviceName: sn }) => {
    try {
      const snap = await ovh.get<{ creationDate: string; description: string }>(`/vps/${sn}/snapshot`);
      return { content: [{ type: "text", text: `# Snapshot\n- Created: ${snap.creationDate}\n- Description: ${snap.description || "(none)"}` }] };
    } catch {
      return { content: [{ type: "text", text: `No snapshot exists for ${sn}.` }] };
    }
  });

  server.tool(
    "ovh_vps_create_snapshot",
    "Create a new VPS snapshot (overwrites existing)",
    { serviceName, description: z.string().optional().describe("Snapshot description") },
    async ({ serviceName: sn, description }) => {
      await ovh.post(`/vps/${sn}/createSnapshot`, description ? { description } : undefined);
      return { content: [{ type: "text", text: `Snapshot creation initiated for ${sn}.` }] };
    },
  );
}
