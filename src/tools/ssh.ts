import { z } from "zod";
import { Client as SshClient } from "ssh2";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, textResult } from "./utils.js";

const CONNECT_TIMEOUT = 15_000;

interface SshResult {
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
}

interface SshConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  keyFile?: string;
  /** OpenSSH SHA256 fingerprint without the "SHA256:" prefix and padding. */
  hostKey?: string;
}

interface SshEnv {
  host?: string;
  port: number;
  user?: string;
  password?: string;
  key?: string;
  hostKey?: string;
}

/**
 * Env credentials and the pinned host key apply only to SSH_HOST. Any other host needs an
 * explicit username and password in the call, so env secrets never reach a model-chosen host.
 */
function resolveSshConfig(params: { host?: string; port?: number; username?: string; password?: string }, env: SshEnv): SshConfig {
  const host = params.host || env.host;
  if (!host) throw new Error("No SSH host. Set SSH_HOST env or pass host parameter.");
  const isDefaultHost = !!env.host && host.toLowerCase() === env.host.toLowerCase();
  const port = params.port || (isDefaultHost ? env.port : 22);

  if (!isDefaultHost) {
    if (!params.username || !params.password) {
      throw new Error(`Host ${host} is not SSH_HOST, so env credentials are not used for it. Pass username and password explicitly.`);
    }
    return { host, port, username: params.username, password: params.password };
  }

  const username = params.username || env.user;
  const password = params.password || (env.key ? undefined : env.password);
  const keyFile = params.password ? undefined : env.key;
  if (!username) throw new Error("No SSH user. Set SSH_USER env or pass username parameter.");
  if (!password && !keyFile) throw new Error("No SSH credentials. Set SSH_PASSWORD or SSH_PRIVATE_KEY_FILE env.");
  return { host, port, username, password, keyFile, hostKey: env.hostKey?.replace(/^SHA256:/, "").replace(/=+$/, "") };
}

function fingerprint(key: Buffer): string {
  return createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
}

function execSsh(cfg: SshConfig, command: string, timeoutMs: number): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH command timed out after ${timeoutMs} ms: outcome unknown, it may have run partly or still be running.`));
    }, timeoutMs);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }

          let stdout = "";
          let stderr = "";
          let exitCode: number | null = null;
          let signal: string | undefined;

          stream
            .on("exit", (code: number | null, sig?: string) => {
              exitCode = typeof code === "number" ? code : null;
              signal = sig ?? undefined;
            })
            .on("close", () => {
              clearTimeout(timer);
              conn.end();
              resolve({ exitCode, signal, stdout, stderr });
            })
            .on("data", (data: Buffer) => {
              stdout += data.toString();
              if (stdout.length > 100_000) stdout = stdout.slice(-80_000);
            })
            .stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
              if (stderr.length > 50_000) stderr = stderr.slice(-40_000);
            });
        });
      })
      .on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        ...(cfg.keyFile ? { privateKey: readFileSync(cfg.keyFile) } : { password: cfg.password }),
        ...(cfg.hostKey ? { hostVerifier: (key: Buffer) => fingerprint(key) === cfg.hostKey } : {}),
        readyTimeout: CONNECT_TIMEOUT,
      });
  });
}

function hostKeyNote(cfg: SshConfig): string[] {
  return cfg.hostKey ? [] : ["- Warning: host key not verified (set SSH_HOST_KEY to pin SSH_HOST's fingerprint)"];
}

const target = {
  host: z.string().optional().describe("SSH host (default: SSH_HOST env). Env credentials are used only for SSH_HOST"),
  port: z.number().optional().describe("SSH port (default: SSH_PORT env for SSH_HOST, else 22)"),
  username: z.string().optional().describe("SSH username (default: SSH_USER env, SSH_HOST only)"),
  password: z.string().optional().describe("SSH password (default: SSH_PASSWORD env, SSH_HOST only)"),
};

export function registerSshTools(server: McpServer) {
  const env: SshEnv = {
    host: process.env.SSH_HOST,
    port: process.env.SSH_PORT ? Number(process.env.SSH_PORT) : 22,
    user: process.env.SSH_USER,
    password: process.env.SSH_PASSWORD,
    key: process.env.SSH_PRIVATE_KEY_FILE,
    hostKey: process.env.SSH_HOST_KEY,
  };

  server.registerTool(
    "ovh_ssh_exec",
    {
      description: "Execute a shell command on a remote server via SSH. Uses env defaults (SSH_HOST, SSH_USER, SSH_PASSWORD/SSH_PRIVATE_KEY_FILE, SSH_HOST_KEY) or explicit per-call credentials for other hosts.",
      inputSchema: {
        command: z.string().describe("Shell command to execute on the remote server"),
        ...target,
        timeout: z.number().optional().default(60000).describe("Exec timeout in ms"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const cfg = resolveSshConfig(params, env);
        const result = await execSsh(cfg, params.command, params.timeout);
        const failed = result.exitCode !== 0;

        const lines = [
          `# SSH: ${params.command.slice(0, 100)}`,
          `- Host: ${cfg.host}:${cfg.port}`,
          result.signal ? `- Killed by signal ${result.signal}` : `- Exit code: ${result.exitCode ?? "unknown"}`,
          ...hostKeyNote(cfg),
        ];

        if (result.stdout) lines.push("", "## stdout", "```", result.stdout.trimEnd(), "```");
        if (result.stderr) lines.push("", "## stderr", "```", result.stderr.trimEnd(), "```");

        return failed ? { ...textResult(lines.join("\n")), isError: true } : textResult(lines.join("\n"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "ovh_ssh_check",
    {
      description: "Test SSH connectivity to a remote server (runs `echo OK && hostname && uptime`)",
      inputSchema: target,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (params) => {
      let cfg: SshConfig;
      try {
        cfg = resolveSshConfig(params, env);
      } catch (err) {
        return errorResult(err);
      }

      try {
        const result = await execSsh(cfg, "echo OK && hostname && uptime", 15_000);
        const out = [`- Host: ${cfg.host}:${cfg.port}`, `- User: ${cfg.username}`, ...hostKeyNote(cfg), "", "```", (result.stdout + result.stderr).trimEnd(), "```"].join("\n");
        if (result.exitCode !== 0) return { ...textResult(`# SSH Connection FAILED (exit ${result.exitCode ?? result.signal})\n${out}`), isError: true };
        return textResult(`# SSH Connection OK\n${out}`);
      } catch (err) {
        return { ...textResult(`# SSH Connection FAILED\n- Host: ${cfg.host}:${cfg.port}\n- Error: ${err instanceof Error ? err.message : String(err)}`), isError: true };
      }
    },
  );
}
