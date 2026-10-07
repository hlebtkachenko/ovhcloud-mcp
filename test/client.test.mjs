// In-process tests of the OVH client with a stubbed fetch. All data here is synthetic.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OvhClient, validatePath } from "../dist/ovh-client.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, body = "" } = handler(String(url), init) ?? {};
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return calls;
}

test("validatePath accepts normal paths", () => {
  for (const p of ["/vps", "/domain/zone/example.com/record", "/me/bill/CZ0001", "/domain/zone/a%2Fb.example.com"]) {
    assert.doesNotThrow(() => validatePath(p), p);
  }
});

test("validatePath rejects traversal, encoded traversal, query, fragment and bad escapes", () => {
  for (const p of ["/vps/../me", "/domain/..", "/vps/%2e%2e/me", "/vps/%2E%2E/me", "/vps?x=1", "/vps#a", "/vps/%zz", "vps"]) {
    assert.throws(() => validatePath(p), undefined, p);
  }
});

for (const [endpoint, tokenUrl] of [
  ["ovh-eu", "https://www.ovh.com/auth/oauth2/token"],
  ["ovh-ca", "https://ca.ovh.com/auth/oauth2/token"],
  ["ovh-us", "https://us.ovhcloud.com/auth/oauth2/token"],
]) {
  test(`OAuth2 token request for ${endpoint} matches go-ovh`, async () => {
    const calls = stubFetch((url) => (url === tokenUrl ? { body: { access_token: "tok", expires_in: 3600 } } : { body: [] }));
    const client = new OvhClient({ mode: "oauth2", endpoint, clientId: "id", clientSecret: "secret" });
    await client.get("/vps");
    assert.equal(calls[0].url, tokenUrl);
    assert.equal(calls[0].init.method, "POST");
    const form = new URLSearchParams(calls[0].init.body);
    assert.equal(form.get("grant_type"), "client_credentials");
    assert.equal(form.get("scope"), "all");
    assert.equal(calls[0].init.headers.Authorization, `Basic ${Buffer.from("id:secret").toString("base64")}`);
    assert.equal(calls[1].init.headers.Authorization, "Bearer tok");
  });
}

test("OAuth2 with a custom endpoint is refused instead of sending the secret to the EU", () => {
  assert.throws(() => new OvhClient({ mode: "oauth2", endpoint: "https://api.example.com/1.0", clientId: "id", clientSecret: "s" }), /OAuth2/);
});

test("a failed /auth/time is an error, not a NaN timestamp", async () => {
  const calls = stubFetch((url) => (url.endsWith("/auth/time") ? { status: 503, body: "down" } : { body: [] }));
  const client = new OvhClient({ mode: "apikey", endpoint: "ovh-eu", appKey: "k", appSecret: "s", consumerKey: "c" });
  await assert.rejects(client.get("/vps"), /auth\/time/);
  assert.equal(calls.filter((c) => !c.url.endsWith("/auth/time")).length, 0);
});

test("API errors carry the HTTP status", async () => {
  stubFetch((url) => (url.endsWith("/auth/time") ? { body: 1_700_000_000 } : { status: 404, body: { message: "missing" } }));
  const client = new OvhClient({ mode: "apikey", endpoint: "ovh-eu", appKey: "k", appSecret: "s", consumerKey: "c" });
  await assert.rejects(client.get("/vps/x/snapshot"), (e) => e.status === 404);
});
