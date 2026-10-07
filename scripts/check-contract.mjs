// Validates every OVH request the tools send against OVH's published API schemas.
// Calls each tool twice (all fields filled, required fields only) against the fake OVH API,
// captures the requests and checks method, path, path/query parameter names and types,
// query enum values and JSON body field names against https://eu.api.ovh.com/v1/{api}.json.
// Usage: npm run check:contract   (schemas are cached in .spec-cache/)
import fs from "node:fs";
import path from "node:path";
import { startFakeOvh, startServer, apiCalls, VPS, ZONE } from "../test/fake-ovh.mjs";

const CACHE = path.resolve(".spec-cache");
const SPEC_BASE = "https://eu.api.ovh.com/v1/";
const APIS = ["vps", "domain", "me", "services"];
// SSH tools do not call the OVH API, explorer tools only read schemas, ovh_api_raw sends whatever it is given.
const SKIP = new Set(["ovh_ssh_exec", "ovh_ssh_check", "ovh_api_catalog", "ovh_api_search", "ovh_api_endpoint_detail", "ovh_api_raw"]);
const SAMPLES = { serviceName: VPS, zone: ZONE, billId: "CZ0001", recordId: 11, diskId: 7, fieldType: "A", subDomain: "www", target: "192.0.2.10", from: "2026-01-01", to: "2026-12-31" };

async function loadSpecs() {
  fs.mkdirSync(CACHE, { recursive: true });
  const specs = {};
  for (const api of APIS) {
    const file = path.join(CACHE, `${api}.json`);
    if (!fs.existsSync(file)) {
      const resp = await fetch(`${SPEC_BASE}${api}.json`);
      if (!resp.ok) throw new Error(`Cannot download ${api}.json: HTTP ${resp.status}`);
      fs.writeFileSync(file, await resp.text());
    }
    specs[api] = JSON.parse(fs.readFileSync(file, "utf-8"));
  }
  return specs;
}

function sample(schema, key = "") {
  if (key in SAMPLES) return SAMPLES[key];
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return sample(schema.anyOf[0], key);
  switch (schema.type) {
    case "number": case "integer": return Math.max(1, schema.minimum ?? 1);
    case "boolean": return true;
    case "object": return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, sample(v, k)]));
    default: return "X1";
  }
}

const NUMERIC = new Set(["long", "int", "double"]);

function checkValue(spec, dataType, value, label) {
  if (NUMERIC.has(dataType) && !/^-?\d+(\.\d+)?$/.test(String(value))) return [`${label}: "${value}" is not ${dataType}`];
  const values = spec.models?.[dataType]?.enum;
  if (values && !values.includes(value)) return [`${label}: "${value}" not in ${dataType} (${values.join("|")})`];
  return [];
}

function validate(specs, req) {
  const segs = req.path.split("/").slice(1).map(decodeURIComponent);
  const spec = specs[segs[0]];
  if (!spec) return [`no schema loaded for /${segs[0]}`];
  // Prefer the template with the most literal segments, e.g. /domain/zone over /domain/{serviceName}.
  const candidates = spec.apis
    .map((api) => ({ api, tpl: api.path.split("/").slice(1) }))
    .filter(({ tpl }) => tpl.length === segs.length && tpl.every((t, i) => /^\{.+\}$/.test(t) || t === segs[i]))
    .sort((a, b) => b.tpl.filter((t) => !t.startsWith("{")).length - a.tpl.filter((t) => !t.startsWith("{")).length);
  if (!candidates.length) return [`path ${req.path} is not declared`];
  const { api, tpl } = candidates[0];
  const op = api.operations.find((o) => o.httpMethod === req.method);
  if (!op) return [`${req.method} is not declared for ${api.path}`];

  const errors = [];
  const params = op.parameters ?? [];
  tpl.forEach((t, i) => {
    if (!t.startsWith("{")) return;
    const p = params.find((x) => x.paramType === "path" && x.name === t.slice(1, -1));
    if (!p) errors.push(`path parameter ${t} not declared`);
    else errors.push(...checkValue(spec, p.dataType, segs[i], `path ${t}`));
  });

  const queryParams = params.filter((p) => p.paramType === "query");
  for (const [k, v] of Object.entries(req.query)) {
    const p = queryParams.find((x) => x.name === k);
    if (!p) errors.push(`query parameter "${k}" not declared (declared: ${queryParams.map((x) => x.name).join(", ") || "none"})`);
    else errors.push(...checkValue(spec, p.dataType, v, `query ${k}`));
  }
  for (const p of queryParams) if (p.required && !(p.name in req.query)) errors.push(`required query parameter "${p.name}" missing`);

  const bodyParams = params.filter((p) => p.paramType === "body");
  if (req.body !== undefined) {
    if (!bodyParams.length) return [...errors, "body sent but none declared"];
    const fields = {};
    for (const p of bodyParams) {
      if (p.name) fields[p.name] = p;
      else Object.assign(fields, spec.models?.[p.dataType]?.properties ?? {});
    }
    for (const k of Object.keys(req.body)) if (!(k in fields)) errors.push(`body field "${k}" not declared (declared: ${Object.keys(fields).join(", ")})`);
    for (const [k, f] of Object.entries(fields)) if (f.required && !(k in req.body)) errors.push(`required body field "${k}" missing`);
  } else if (bodyParams.some((p) => p.required && p.name)) {
    errors.push("required body missing");
  }
  return errors;
}

const specs = await loadSpecs();
const fake = await startFakeOvh();
const client = await startServer(fake);

let failed = 0;
let checked = 0;
const { tools } = await client.listTools();
for (const tool of tools) {
  if (SKIP.has(tool.name)) {
    console.log(`SKIP ${tool.name}`);
    continue;
  }
  const full = sample(tool.inputSchema);
  const required = Object.fromEntries(Object.entries(full).filter(([k]) => tool.inputSchema.required?.includes(k)));
  for (const [kind, args] of [["full", full], ["required", required]]) {
    fake.reset();
    const result = await client.callTool({ name: tool.name, arguments: args });
    const calls = apiCalls(fake);
    const problems = calls.flatMap((c) => validate(specs, c).map((e) => `${c.method} ${c.path}: ${e}`));
    if (result.isError) problems.push(`tool returned an error: ${result.content[0]?.text}`);
    if (!calls.length) problems.push("no request sent");
    checked += calls.length;
    if (problems.length) {
      failed++;
      console.log(`FAIL ${tool.name} (${kind})\n     ${problems.join("\n     ")}`);
    } else {
      console.log(`ok   ${tool.name} (${kind}): ${calls.map((c) => `${c.method} ${c.path}`).join(", ")}`);
    }
  }
}

await client.close();
await fake.close();
console.log(failed ? `\n${failed} tool call(s) break the OVH schema.` : `\nAll ${checked} captured requests match the OVH schema.`);
process.exit(failed ? 1 : 0);
