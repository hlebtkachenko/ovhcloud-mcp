// End-to-end tests: the built server (dist/) talks to a fake OVH API over HTTP.
// Run with `npm test` (builds first). All data here is synthetic.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeOvh, startServer, apiCalls, VPS, ZONE } from "./fake-ovh.mjs";

let fake;
let client;

before(async () => {
  fake = await startFakeOvh();
  client = await startServer(fake, { OVH_TIMEOUT_MS: "500" });
});

after(async () => {
  await client?.close();
  await fake?.close();
});

beforeEach(() => fake.reset());

const call = (name, args = {}) => client.callTool({ name, arguments: args });
const text = (r) => r.content.map((c) => c.text).join("\n");
const ok = (r) => assert.ok(!r.isError, text(r));

test("registers 27 tools, each with annotations", async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 27);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const t of tools) assert.ok(t.annotations, `${t.name} has no annotations`);
  for (const n of ["ovh_vps_list", "ovh_vps_info", "ovh_services", "ovh_invoices", "ovh_api_search", "ovh_domain_dns_records"]) {
    assert.equal(byName[n].annotations.readOnlyHint, true, n);
  }
  for (const n of ["ovh_vps_reboot", "ovh_vps_stop", "ovh_domain_dns_delete", "ovh_domain_dns_update", "ovh_api_raw", "ovh_ssh_exec"]) {
    assert.equal(byName[n].annotations.destructiveHint, true, n);
  }
  assert.equal(byName.ovh_domain_dns_create.annotations.destructiveHint, false);
  assert.equal(byName.ovh_api_raw.annotations.openWorldHint, true);
  assert.equal(byName.ovh_ssh_exec.annotations.openWorldHint, true);
});

test("ovh_vps_list reads model.memory for RAM", async () => {
  const r = await call("ovh_vps_list");
  ok(r);
  assert.deepEqual(apiCalls(fake).map((c) => `${c.method} ${c.path}`), ["GET /vps", `GET /vps/${VPS}`]);
  assert.match(text(r), /RAM: 2048 MB/);
});

test("ovh_vps_list reports a failed detail request as an error", async () => {
  fake.override = (req) => (req.rawPath === `/vps/${VPS}` ? { status: 500, body: { message: "boom" } } : undefined);
  const r = await call("ovh_vps_list");
  assert.ok(r.isError);
  assert.match(text(r), /500/);
});

test("ovh_vps_info sends three reads and shows RAM from memory", async () => {
  const r = await call("ovh_vps_info", { serviceName: VPS });
  ok(r);
  assert.deepEqual(apiCalls(fake).map((c) => `${c.method} ${c.path}`).sort(), [`GET /vps/${VPS}`, `GET /vps/${VPS}/ips`, `GET /vps/${VPS}/serviceInfos`]);
  assert.match(text(r), /RAM: 2048 MB/);
});

test("ovh_vps_monitoring uses the documented disk monitoring endpoint", async () => {
  const r = await call("ovh_vps_monitoring", { serviceName: VPS, period: "lastweek" });
  ok(r);
  assert.deepEqual(apiCalls(fake), [
    { method: "GET", path: `/vps/${VPS}/disks`, query: {}, body: undefined },
    { method: "GET", path: `/vps/${VPS}/disks/7/monitoring`, query: { type: "used", period: "lastweek" }, body: undefined },
  ]);

  fake.reset();
  ok(await call("ovh_vps_monitoring", { serviceName: VPS, diskId: 7, type: "max", period: "today" }));
  assert.deepEqual(apiCalls(fake).map((c) => [c.path, c.query]), [[`/vps/${VPS}/disks/7/monitoring`, { type: "max", period: "today" }]]);
});

test("ovh_vps_ips, reboot, start and stop hit their endpoints", async () => {
  ok(await call("ovh_vps_ips", { serviceName: VPS }));
  for (const action of ["reboot", "start", "stop"]) ok(await call(`ovh_vps_${action}`, { serviceName: VPS }));
  assert.deepEqual(apiCalls(fake).map((c) => `${c.method} ${c.path}`), [
    `GET /vps/${VPS}/ips`, `POST /vps/${VPS}/reboot`, `POST /vps/${VPS}/start`, `POST /vps/${VPS}/stop`,
  ]);
});

test("ovh_vps_snapshot: 404 means no snapshot, other errors are errors", async () => {
  ok(await call("ovh_vps_snapshot", { serviceName: VPS }));
  assert.deepEqual(apiCalls(fake).map((c) => `${c.method} ${c.path}`), [`GET /vps/${VPS}/snapshot`]);
  fake.override = () => ({ status: 404, body: { message: "The requested object (snapshot) does not exist" } });
  const none = await call("ovh_vps_snapshot", { serviceName: VPS });
  ok(none);
  assert.match(text(none), /No snapshot exists/);
  fake.override = () => ({ status: 403, body: { message: "This call has not been granted" } });
  const denied = await call("ovh_vps_snapshot", { serviceName: VPS });
  assert.ok(denied.isError);
  assert.match(text(denied), /403/);
});

test("ovh_vps_create_snapshot sends the description and does not claim to overwrite", async () => {
  ok(await call("ovh_vps_create_snapshot", { serviceName: VPS, description: "before upgrade" }));
  assert.deepEqual(apiCalls(fake), [{ method: "POST", path: `/vps/${VPS}/createSnapshot`, query: {}, body: { description: "before upgrade" } }]);
  const { tools } = await client.listTools();
  const desc = tools.find((t) => t.name === "ovh_vps_create_snapshot").description;
  assert.doesNotMatch(desc, /overwrite/i);
  assert.match(desc, /no existing snapshot/i);
});

test("a POST that times out reports an unknown outcome", async () => {
  fake.override = (req) => (req.method === "POST" ? { status: 200, body: {}, delay: 1500 } : undefined);
  const r = await call("ovh_vps_reboot", { serviceName: VPS });
  assert.ok(r.isError);
  assert.match(text(r), /outcome unknown/i);
  assert.match(text(r), /ovh_vps_info/);
});

test("path parameters are encoded and traversal is rejected", async () => {
  const r = await call("ovh_vps_info", { serviceName: "../me" });
  assert.ok(r.isError);
  assert.equal(apiCalls(fake).length, 0);

  await call("ovh_domain_dns_record_detail", { zone: "a/b.example.com", recordId: 11 });
  assert.equal(apiCalls(fake)[0].path, "/domain/zone/a%2Fb.example.com/record/11");

  fake.reset();
  const raw = await call("ovh_api_raw", { method: "GET", path: "/vps/%2e%2e/me" });
  assert.ok(raw.isError);
  assert.equal(apiCalls(fake).length, 0);
});

test("domain read tools send the documented requests", async () => {
  ok(await call("ovh_domain_list"));
  ok(await call("ovh_domain_zone_info", { zone: ZONE }));
  ok(await call("ovh_domain_dns_records", { zone: ZONE, fieldType: "A", subDomain: "www" }));
  ok(await call("ovh_domain_dns_record_detail", { zone: ZONE, recordId: 11 }));
  assert.deepEqual(apiCalls(fake).map((c) => [`${c.method} ${c.path}`, c.query]).sort(), [
    ["GET /domain", {}],
    [`GET /domain/zone/${ZONE}`, {}],
    [`GET /domain/zone/${ZONE}/record`, { fieldType: "A", subDomain: "www" }],
    [`GET /domain/zone/${ZONE}/record/11`, {}],
    [`GET /domain/zone/${ZONE}/record/11`, {}],
    ["GET /domain/zone", {}],
  ].sort());
});

test("DNS create, update, delete and refresh send the documented bodies", async () => {
  ok(await call("ovh_domain_dns_create", { zone: ZONE, fieldType: "A", subDomain: "api", target: "192.0.2.11", ttl: 600 }));
  ok(await call("ovh_domain_dns_update", { zone: ZONE, recordId: 11, subDomain: "www", target: "192.0.2.12", ttl: 300 }));
  ok(await call("ovh_domain_dns_delete", { zone: ZONE, recordId: 11 }));
  ok(await call("ovh_domain_dns_refresh", { zone: ZONE }));
  assert.deepEqual(apiCalls(fake).map((c) => [`${c.method} ${c.path}`, c.body]), [
    [`POST /domain/zone/${ZONE}/record`, { fieldType: "A", subDomain: "api", target: "192.0.2.11", ttl: 600 }],
    [`POST /domain/zone/${ZONE}/refresh`, undefined],
    [`PUT /domain/zone/${ZONE}/record/11`, { subDomain: "www", target: "192.0.2.12", ttl: 300 }],
    [`POST /domain/zone/${ZONE}/refresh`, undefined],
    [`DELETE /domain/zone/${ZONE}/record/11`, undefined],
    [`POST /domain/zone/${ZONE}/refresh`, undefined],
    [`POST /domain/zone/${ZONE}/refresh`, undefined],
  ]);
});

test("DNS write that succeeds but whose refresh fails says the write happened", async () => {
  fake.override = (req) => (req.rawPath.endsWith("/refresh") ? { status: 500, body: { message: "refresh broke" } } : undefined);
  const r = await call("ovh_domain_dns_create", { zone: ZONE, fieldType: "A", subDomain: "api", target: "192.0.2.11" });
  assert.ok(r.isError);
  assert.match(text(r), /Record created/);
  assert.match(text(r), /"id": 12/);
  assert.match(text(r), /refresh failed/i);
  assert.equal(apiCalls(fake).filter((c) => c.method === "POST" && c.path.endsWith("/record")).length, 1);
});

test("ovh_account_info reads /me", async () => {
  ok(await call("ovh_account_info"));
  assert.deepEqual(apiCalls(fake).map((c) => `${c.method} ${c.path}`), ["GET /me"]);
});

test("ovh_services reads /services and the expanded service", async () => {
  const r = await call("ovh_services");
  ok(r);
  assert.deepEqual(apiCalls(fake).map((c) => `${c.method} ${c.path}`), ["GET /services", "GET /services/101"]);
  const t = text(r);
  assert.match(t, /vps-1\.example\.net/);
  assert.match(t, /State: active/);
  assert.match(t, /Renew: automatic/);
  assert.match(t, /Expiration: 2027-01-01/);
});

test("ovh_invoices filters by date and sorts by bill date", async () => {
  const r = await call("ovh_invoices", { limit: 2, from: "2026-01-01", to: "2026-12-31" });
  ok(r);
  const list = apiCalls(fake)[0];
  assert.equal(list.path, "/me/bill");
  assert.deepEqual(list.query, { "date.from": "2026-01-01", "date.to": "2026-12-31" });
  const t = text(r);
  assert.ok(t.indexOf("CZ0001") < t.indexOf("CZ0003"), t);
  assert.doesNotMatch(t, /CZ0002/);

  fake.reset();
  ok(await call("ovh_invoices"));
  assert.ok(apiCalls(fake)[0].query["date.from"], "default window sets date.from");
});

test("ovh_invoice_detail hides the bill password", async () => {
  const r = await call("ovh_invoice_detail", { billId: "CZ0001" });
  ok(r);
  assert.doesNotMatch(text(r), /SYNTHETIC-BILL-SECRET|"password"/);
  assert.match(text(r), /VPS demo/);
  assert.deepEqual(apiCalls(fake).map((c) => c.path), ["/me/bill/CZ0001", "/me/bill/CZ0001/details", "/me/bill/CZ0001/details/D1"]);
});

test("explorer tools fetch {category}.json schemas", async () => {
  ok(await call("ovh_api_catalog"));
  assert.ok(fake.requests.some((r) => r.method === "GET" && r.rawPath === "/"));
  const s = await call("ovh_api_search", { query: "snapshot", category: "/vps" });
  ok(s);
  assert.match(text(s), /\/vps\/\{serviceName\}\/snapshot/);
  const d = await call("ovh_api_endpoint_detail", { path: "/vps/{serviceName}/snapshot" });
  ok(d);
  assert.match(text(d), /serviceName/);
  assert.ok(fake.requests.some((r) => r.rawPath === "/vps.json"));
  assert.ok(!fake.requests.some((r) => r.rawPath === "/vps"));
});

test("ovh_api_search reports schema fetch failures instead of no matches", async () => {
  fake.override = (req) => (req.rawPath.endsWith(".json") ? { status: 401, body: { message: "You must login first" } } : undefined);
  const r = await call("ovh_api_search", { query: "zzz-not-cached" });
  assert.ok(r.isError);
  assert.match(text(r), /401/);
});

test("ovh_api_raw allows GET and refuses writes without OVH_ALLOW_RAW_WRITES", async () => {
  ok(await call("ovh_api_raw", { method: "GET", path: "/vps", query: { iamTags: "x" } }));
  assert.deepEqual(apiCalls(fake), [{ method: "GET", path: "/vps", query: { iamTags: "x" }, body: undefined }]);
  fake.reset();
  const w = await call("ovh_api_raw", { method: "POST", path: `/vps/${VPS}/reboot` });
  assert.ok(w.isError);
  assert.match(text(w), /OVH_ALLOW_RAW_WRITES/);
  assert.equal(apiCalls(fake).length, 0);
});

test("ovh_api_raw sends writes when OVH_ALLOW_RAW_WRITES=true", async () => {
  const writer = await startServer(fake, { OVH_ALLOW_RAW_WRITES: "true" });
  try {
    const r = await writer.callTool({ name: "ovh_api_raw", arguments: { method: "PUT", path: `/domain/zone/${ZONE}/record/11`, body: '{"ttl":60}' } });
    ok(r);
    assert.deepEqual(apiCalls(fake), [{ method: "PUT", path: `/domain/zone/${ZONE}/record/11`, query: {}, body: { ttl: 60 } }]);
  } finally {
    await writer.close();
  }
});
