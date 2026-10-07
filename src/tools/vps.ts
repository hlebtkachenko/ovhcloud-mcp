import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OvhApiError, type OvhClient } from "../ovh-client.js";
import { apiPath, errorResult, READ_ONLY, textResult } from "./utils.js";

const serviceName = z.string().describe("VPS service name (e.g. vps-xxxxxxxx.vps.ovh.net)");

interface VpsModel {
  name?: string;
  memory?: number;
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

const POWER = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export function registerVpsTools(server: McpServer, ovh: OvhClient) {
  server.registerTool("ovh_vps_list", { description: "List all VPS services on your OVH account", annotations: READ_ONLY }, async () => {
    try {
      const names = await ovh.get<string[]>("/vps");
      if (!names.length) return textResult("No VPS found.");

      let failed = false;
      const details = await Promise.all(
        names.map(async (name) => {
          try {
            const vps = await ovh.get<VpsInfo>(apiPath`/vps/${name}`);
            const m = vps.model;
            return [
              `## ${name}`,
              `- State: ${vps.state}`,
              `- Model: ${m?.name ?? "n/a"}`,
              `- RAM: ${m?.memory ?? "?"} MB, Disk: ${m?.disk ?? "?"} GB, vCores: ${m?.vcore ?? "?"}`,
              `- Zone: ${vps.zone}`,
            ].join("\n");
          } catch (err) {
            failed = true;
            return `## ${name}\nError: ${err instanceof Error ? err.message : String(err)}`;
          }
        }),
      );
      return failed ? { ...textResult(details.join("\n\n")), isError: true } : textResult(details.join("\n\n"));
    } catch (err) {
      return errorResult(err);
    }
  });

  server.registerTool(
    "ovh_vps_info",
    { description: "Get detailed VPS information", inputSchema: { serviceName }, annotations: READ_ONLY },
    async ({ serviceName: sn }) => {
      try {
        const [vps, svc, ips] = await Promise.all([
          ovh.get<VpsInfo>(apiPath`/vps/${sn}`),
          ovh.get<ServiceInfo>(apiPath`/vps/${sn}/serviceInfos`),
          ovh.get<string[]>(apiPath`/vps/${sn}/ips`),
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
          `- RAM: ${m?.memory ?? "?"} MB`,
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
        return textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ovh_vps_monitoring",
    {
      description: "Get VPS disk usage statistics over a period (OVH's public API has no VPS CPU or network statistics)",
      inputSchema: {
        serviceName,
        diskId: z.number().int().optional().describe("Disk ID (default: every disk of the VPS)"),
        type: z.enum(["used", "max"]).default("used").describe("used = space used, max = disk size"),
        period: z.enum(["today", "lastday", "lastweek", "lastmonth", "lastyear"]).default("lastday"),
      },
      annotations: READ_ONLY,
    },
    async ({ serviceName: sn, diskId, type, period }) => {
      try {
        const disks = diskId !== undefined ? [diskId] : await ovh.get<number[]>(apiPath`/vps/${sn}/disks`);
        if (!disks.length) return textResult(`No disks found for ${sn}.`);
        const sections = [];
        for (const id of disks) {
          const data = await ovh.get(apiPath`/vps/${sn}/disks/${id}/monitoring`, { type, period });
          sections.push(`## Disk ${id}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
        }
        return textResult(`# Disk monitoring: ${type} (${period})\n\n${sections.join("\n\n")}`);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool("ovh_vps_ips", { description: "List all IPs assigned to a VPS", inputSchema: { serviceName }, annotations: READ_ONLY }, async ({ serviceName: sn }) => {
    try {
      const ips = await ovh.get<string[]>(apiPath`/vps/${sn}/ips`);
      return textResult(ips.length ? ips.map((ip) => `- ${ip}`).join("\n") : "No IPs.");
    } catch (err) {
      return errorResult(err);
    }
  });

  const power = (action: "reboot" | "start" | "stop", description: string, done: string) =>
    server.registerTool(`ovh_vps_${action}`, { description, inputSchema: { serviceName }, annotations: POWER }, async ({ serviceName: sn }) => {
      try {
        await ovh.post(apiPath`/vps/${sn}/${action}`);
        return textResult(`${done} initiated for ${sn}.`);
      } catch (err) {
        return errorResult(err, "ovh_vps_info");
      }
    });
  power("reboot", "Reboot a VPS (careful!)", "Reboot");
  power("start", "Start a stopped VPS", "Start");
  power("stop", "Stop a running VPS (careful!)", "Stop");

  server.registerTool("ovh_vps_snapshot", { description: "Get VPS snapshot information", inputSchema: { serviceName }, annotations: READ_ONLY }, async ({ serviceName: sn }) => {
    try {
      const snap = await ovh.get<{ creationDate: string; description: string }>(apiPath`/vps/${sn}/snapshot`);
      return textResult(`# Snapshot\n- Created: ${snap.creationDate}\n- Description: ${snap.description || "(none)"}`);
    } catch (err) {
      if (err instanceof OvhApiError && err.status === 404) return textResult(`No snapshot exists for ${sn}.`);
      return errorResult(err);
    }
  });

  server.registerTool(
    "ovh_vps_create_snapshot",
    {
      description: "Create a VPS snapshot. Requires the snapshot option and no existing snapshot (check with ovh_vps_snapshot first)",
      inputSchema: { serviceName, description: z.string().optional().describe("Snapshot description") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ serviceName: sn, description }) => {
      try {
        await ovh.post(apiPath`/vps/${sn}/createSnapshot`, description ? { description } : undefined);
        return textResult(`Snapshot creation initiated for ${sn}.`);
      } catch (err) {
        return errorResult(err, "ovh_vps_snapshot");
      }
    },
  );
}
