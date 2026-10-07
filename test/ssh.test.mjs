// SSH tool tests against an in-process ssh2 server with a throwaway host key. All data here is synthetic.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import ssh2 from "ssh2";
import { startServer } from "./fake-ovh.mjs";

const { Server, utils } = ssh2;
const GOOD_PASSWORD = "synthetic-pass";

let sshd;
let port;
let fingerprint;
const passwordsSeen = [];
const commandsSeen = [];
const clients = [];

before(async () => {
  const keys = utils.generateKeyPairSync("ed25519");
  fingerprint = "SHA256:" + createHash("sha256").update(utils.parseKey(keys.public).getPublicSSH()).digest("base64").replace(/=+$/, "");
  sshd = new Server({ hostKeys: [keys.private] }, (conn) => {
    conn.on("authentication", (ctx) => {
      if (ctx.method === "password") passwordsSeen.push(ctx.password);
      if (ctx.method === "password" && ctx.password === GOOD_PASSWORD) ctx.accept();
      else ctx.reject(["password"]);
    });
    conn.on("ready", () => {
      conn.on("session", (accept) => {
        accept().on("exec", (acceptExec, _reject, info) => {
          const stream = acceptExec();
          commandsSeen.push(info.command);
          if (info.command === "fail") {
            stream.stderr.write("synthetic failure\n");
            stream.exit(3);
          } else if (info.command === "killed") {
            stream.exit("KILL", false, "");
          } else {
            stream.write("OK\n");
            stream.exit(0);
          }
          stream.end();
        });
      });
    });
    conn.on("error", () => {});
  });
  await new Promise((r) => sshd.listen(0, "127.0.0.1", r));
  port = sshd.address().port;
});

after(async () => {
  for (const c of clients) await c.close();
  sshd?.close();
});

beforeEach(() => { passwordsSeen.length = 0; commandsSeen.length = 0; });

async function mcp(env) {
  const c = await startServer(null, env);
  clients.push(c);
  return (name, args) => c.callTool({ name, arguments: args });
}
const text = (r) => r.content.map((c) => c.text).join("\n");

test("env SSH_PASSWORD is never sent to a host other than SSH_HOST", async () => {
  const call = await mcp({ SSH_HOST: "192.0.2.1", SSH_USER: "admin", SSH_PASSWORD: "env-only-secret" });
  const r = await call("ovh_ssh_exec", { command: "echo", host: "127.0.0.1", port });
  assert.ok(r.isError);
  assert.ok(!passwordsSeen.includes("env-only-secret"), "env password leaked to another host");
});

test("explicit credentials work for another host and warn that the key is unverified", async () => {
  const call = await mcp({ SSH_HOST: "192.0.2.1" });
  const r = await call("ovh_ssh_exec", { command: "echo", host: "127.0.0.1", port, username: "admin", password: GOOD_PASSWORD });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /Exit code: 0/);
  assert.match(text(r), /host key not verified/i);
});

test("SSH_HOST_KEY mismatch aborts before any password is sent", async () => {
  const call = await mcp({ SSH_HOST: "127.0.0.1", SSH_PORT: String(port), SSH_USER: "admin", SSH_PASSWORD: GOOD_PASSWORD, SSH_HOST_KEY: "SHA256:AAAAsyntheticwrongfingerprintAAAAAAAAAAAAAAA" });
  const r = await call("ovh_ssh_exec", { command: "echo" });
  assert.ok(r.isError);
  assert.deepEqual(passwordsSeen, []);
});

test("matching SSH_HOST_KEY connects with env credentials, no warning", async () => {
  const call = await mcp({ SSH_HOST: "127.0.0.1", SSH_PORT: String(port), SSH_USER: "admin", SSH_PASSWORD: GOOD_PASSWORD, SSH_HOST_KEY: fingerprint });
  const r = await call("ovh_ssh_exec", { command: "echo" });
  assert.ok(!r.isError, text(r));
  assert.doesNotMatch(text(r), /not verified/i);
  assert.deepEqual(commandsSeen, ["echo"]);
  const check = await call("ovh_ssh_check", {});
  assert.ok(!check.isError, text(check));
  assert.equal(commandsSeen[1], "echo OK && hostname && uptime");

  const failed = await call("ovh_ssh_exec", { command: "fail" });
  assert.ok(failed.isError);
  assert.match(text(failed), /Exit code: 3/);
  assert.match(text(failed), /synthetic failure/);
});

test("a command killed by a signal is an error, not exit 0", async () => {
  const call = await mcp({ SSH_HOST: "127.0.0.1", SSH_PORT: String(port), SSH_USER: "admin", SSH_PASSWORD: GOOD_PASSWORD });
  const killed = await call("ovh_ssh_exec", { command: "killed" });
  assert.ok(killed.isError);
  assert.match(text(killed), /signal SIGKILL/);
  assert.doesNotMatch(text(killed), /Exit code: 0/);
});

test("ovh_ssh_check failure is an error", async () => {
  const call = await mcp({ SSH_HOST: "127.0.0.1", SSH_PORT: String(port), SSH_USER: "admin", SSH_PASSWORD: "wrong-pass", SSH_HOST_KEY: fingerprint });
  const r = await call("ovh_ssh_check", {});
  assert.ok(r.isError);
});

test("SSH tools take no private key path from the model", async () => {
  const c = await startServer(null, {});
  clients.push(c);
  const { tools } = await c.listTools();
  for (const n of ["ovh_ssh_exec", "ovh_ssh_check"]) {
    assert.ok(!("privateKeyFile" in tools.find((t) => t.name === n).inputSchema.properties), n);
  }
});
