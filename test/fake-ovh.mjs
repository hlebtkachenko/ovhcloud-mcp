// Fake OVH API used by the tests and the contract check. All data is synthetic.
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const VPS = "vps-1.example.net";
export const ZONE = "example.com";

const json = (body, status = 200) => ({ status, body });

const SPEC = {
  apis: [
    {
      path: "/vps/{serviceName}/snapshot",
      operations: [{ httpMethod: "GET", description: "Retrieve information about the current VPS snapshot", parameters: [{ name: "serviceName", dataType: "string", paramType: "path", required: true }] }],
    },
  ],
};

const ROUTES = {
  "GET /auth/time": () => json(1_700_000_000),
  "GET /": () => json({ apis: [{ path: "/vps" }, { path: "/domain" }] }),
  "GET /vps.json": () => json(SPEC),
  "GET /domain.json": () => json({ apis: [] }),
  "GET /vps": () => json([VPS]),
  [`GET /vps/${VPS}`]: () => json({ state: "running", displayName: "demo", zone: "Region OpenStack: os-example", name: VPS, monitoringIpBlocks: [], model: { name: "vps-demo", memory: 2048, disk: 40, vcore: 2 } }),
  [`GET /vps/${VPS}/serviceInfos`]: () => json({ status: "ok", expiration: "2027-01-01", creation: "2025-01-01", renew: { automatic: true } }),
  [`GET /vps/${VPS}/ips`]: () => json(["192.0.2.10"]),
  [`GET /vps/${VPS}/disks`]: () => json([7]),
  [`GET /vps/${VPS}/disks/7/monitoring`]: () => json({ unit: "MB", values: [{ timestamp: 1_700_000_000, value: 1024 }] }),
  [`GET /vps/${VPS}/snapshot`]: () => json({ creationDate: "2026-01-15T10:00:00Z", description: "nightly" }),
  [`POST /vps/${VPS}/reboot`]: () => json({ id: 1, type: "rebootVm", state: "todo" }),
  [`POST /vps/${VPS}/start`]: () => json({ id: 2, type: "startVm", state: "todo" }),
  [`POST /vps/${VPS}/stop`]: () => json({ id: 3, type: "stopVm", state: "todo" }),
  [`POST /vps/${VPS}/createSnapshot`]: () => json({ id: 4, type: "createSnapshot", state: "todo" }),
  "GET /domain": () => json([ZONE]),
  "GET /domain/zone": () => json([ZONE]),
  [`GET /domain/zone/${ZONE}`]: () => json({ name: ZONE, dnssecSupported: true, nameServers: ["ns1.example.net"], lastUpdate: "2026-01-15T10:00:00Z" }),
  [`GET /domain/zone/${ZONE}/record`]: () => json([11]),
  [`GET /domain/zone/${ZONE}/record/11`]: () => json({ id: 11, zone: ZONE, fieldType: "A", subDomain: "www", target: "192.0.2.10", ttl: 3600 }),
  [`POST /domain/zone/${ZONE}/record`]: () => json({ id: 12, zone: ZONE, fieldType: "A", subDomain: "api", target: "192.0.2.11", ttl: 3600 }),
  [`PUT /domain/zone/${ZONE}/record/11`]: () => json(null),
  [`DELETE /domain/zone/${ZONE}/record/11`]: () => json(null),
  [`POST /domain/zone/${ZONE}/refresh`]: () => json(null),
  "GET /me": () => json({ firstname: "Jane", name: "Doe", nichandle: "xx12345-ovh", email: "jane@example.com", country: "CZ", language: "en_GB", currency: { code: "EUR" }, state: "complete", ovhSubsidiary: "CZ" }),
  "GET /services": () => json([101]),
  "GET /services/101": () => json({
    serviceId: 101,
    resource: { name: VPS, displayName: "demo", state: "active", product: { name: "vps-demo", description: "VPS" } },
    route: { path: "/vps/{serviceName}", url: `/vps/${VPS}` },
    billing: {
      expirationDate: "2027-01-01T00:00:00Z",
      nextBillingDate: "2027-01-01T00:00:00Z",
      renew: { current: { mode: "automatic", period: "P1M", nextDate: "2027-01-01T00:00:00Z" } },
      lifecycle: { current: { state: "active", creationDate: "2025-01-01T00:00:00Z" } },
    },
  }),
  // Returned out of date order on purpose: the tool must sort by date.
  "GET /me/bill": () => json(["CZ0002", "CZ0001", "CZ0003"]),
  "GET /me/bill/CZ0001": () => json(bill("CZ0001", "2026-03-01")),
  "GET /me/bill/CZ0002": () => json(bill("CZ0002", "2026-01-01")),
  "GET /me/bill/CZ0003": () => json(bill("CZ0003", "2026-02-01")),
  "GET /me/bill/CZ0001/details": () => json(["D1"]),
  "GET /me/bill/CZ0001/details/D1": () => json({ billDetailId: "D1", description: "VPS demo", quantity: "1", totalPrice: { text: "5.00 EUR", value: 5 } }),
};

function bill(billId, date) {
  return {
    billId,
    date: `${date}T00:00:00Z`,
    password: "SYNTHETIC-BILL-SECRET",
    pdfUrl: `https://invoices.example.com/${billId}.pdf`,
    priceWithTax: { text: "6.05 EUR", value: 6.05 },
    priceWithoutTax: { text: "5.00 EUR", value: 5 },
    tax: { text: "1.05 EUR", value: 1.05 },
  };
}

/** Starts a fake OVH API. `override(req)` may return {status, body, delay} to replace the default route. */
export async function startFakeOvh() {
  const fake = { requests: [], override: null };
  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, "http://fake");
      const raw = Buffer.concat(chunks).toString("utf-8");
      const entry = {
        method: req.method,
        path: url.pathname,
        rawPath: req.url.split("?")[0],
        query: Object.fromEntries(url.searchParams),
        body: raw ? JSON.parse(raw) : undefined,
        headers: req.headers,
      };
      fake.requests.push(entry);
      const key = `${req.method} ${entry.rawPath}`;
      const resp = fake.override?.(entry) ?? ROUTES[key]?.(entry) ?? json({ message: `no route ${key}` }, 404);
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(resp.status, { "Content-Type": "application/json" });
        res.end(resp.body === null ? "" : JSON.stringify(resp.body));
      };
      if (resp.delay) setTimeout(send, resp.delay);
      else send();
    });
  });
  await new Promise((r) => fake.server.listen(0, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${fake.server.address().port}`;
  fake.reset = () => {
    fake.requests.length = 0;
    fake.override = null;
  };
  fake.close = () => new Promise((r) => { fake.server.closeAllConnections?.(); fake.server.close(r); });
  return fake;
}

/** Starts dist/index.js over stdio with API-key auth pointed at the fake. */
export async function startServer(fake, extraEnv = {}) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    stderr: "ignore",
    env: {
      OVH_ENDPOINT: fake?.url ?? "http://127.0.0.1:9",
      OVH_APPLICATION_KEY: "app-key",
      OVH_APPLICATION_SECRET: "app-secret",
      OVH_CONSUMER_KEY: "consumer-key",
      ...extraEnv,
    },
  }));
  return client;
}

/** Requests the tool sent to the OVH API (time sync and spec fetches excluded). */
export const apiCalls = (fake) =>
  fake.requests.filter((r) => r.path !== "/auth/time").map((r) => ({ method: r.method, path: r.rawPath, query: r.query, body: r.body }));
