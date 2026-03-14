import { z } from "zod";
import { Client as SshClient } from "ssh2";
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult } from "./utils.js";

const CONNECT_TIMEOUT = 15_000;
const EXEC_TIMEOUT = 60_000;

interface SshResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SshConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  keyFile?: string;
}

function resolveSshConfig(
  params: { host?: string; port?: number; username?: string; password?: string; privateKeyFile?: string },
  defaults: { host?: string; port: number; user?: string; password?: string; key?: string },
): SshConfig {
  const host = params.host || defaults.host;
  const port = params.port || defaults.port;
  const username = params.username || defaults.user;
  const password = params.password || defaults.password;
  const keyFile = params.privateKeyFile || defaults.key;

  if (!host) throw new Error("No SSH host. Set SSH_HOST env or pass host parameter.");
  if (!username) throw new Error("No SSH user. Set SSH_USER env or pass username parameter.");
  if (!password && !keyFile) throw new Error("No SSH credentials. Set SSH_PASSWORD or SSH_PRIVATE_KEY_FILE env.");

  return { host, port, username, password, keyFile };
}

function execSsh(
  host: string,
  port: number,
  username: string,
  auth: { password?: string; privateKey?: string },
  command: string,
  timeoutMs: number,
): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
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

          stream
            .on("close", (code: number) => {
              clearTimeout(timer);
              conn.end();
              resolve({ exitCode: code ?? 0, stdout, stderr });
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
        host,
        port,
        username,
        ...(auth.privateKey
          ? { privateKey: readFileSync(auth.privateKey) }
          : { password: auth.password }),
        readyTimeout: CONNECT_TIMEOUT,
      });
  });
}

export function registerSshTools(server: McpServer) {
  const envDefaults = {
    host: process.env.SSH_HOST,
    port: process.env.SSH_PORT ? Number(process.env.SSH_PORT) : 22,
    user: process.env.SSH_USER,
    password: process.env.SSH_PASSWORD,
    key: process.env.SSH_PRIVATE_KEY_FILE,
  };

  server.tool(
    "ovh_ssh_exec",
    "Execute a command on a remote server via SSH. Uses env defaults (SSH_HOST, SSH_USER, SSH_PASSWORD/SSH_PRIVATE_KEY_FILE) or per-call overrides.",
    {
      command: z.string().describe("Shell command to execute on the remote server"),
      host: z.string().optional().describe("SSH host (default: SSH_HOST env)"),
      port: z.number().optional().describe("SSH port (default: SSH_PORT env or 22)"),
      username: z.string().optional().describe("SSH username (default: SSH_USER env)"),
      password: z.string().optional().describe("SSH password (default: SSH_PASSWORD env)"),
      privateKeyFile: z.string().optional().describe("Path to SSH private key file"),
      timeout: z.number().optional().default(60000).describe("Exec timeout in ms"),
    },
    async (params) => {
      try {
        const cfg = resolveSshConfig(params, envDefaults);
        const result = await execSsh(cfg.host, cfg.port, cfg.username, { password: cfg.password, privateKey: cfg.keyFile }, params.command, params.timeout);

        const lines = [
          `# SSH: ${params.command.slice(0, 100)}`,
          `- Host: ${cfg.host}:${cfg.port}`,
          `- Exit code: ${result.exitCode}`,
        ];

        if (result.stdout) lines.push("", "## stdout", "```", result.stdout.trimEnd(), "```");
        if (result.stderr) lines.push("", "## stderr", "```", result.stderr.trimEnd(), "```");

        return textResult(lines.join("\n"));
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );

  server.tool(
    "ovh_ssh_check",
    "Test SSH connectivity to a remote server",
    {
      host: z.string().optional().describe("SSH host (default: SSH_HOST env)"),
      port: z.number().optional().describe("SSH port (default: SSH_PORT env or 22)"),
      username: z.string().optional().describe("SSH username (default: SSH_USER env)"),
      password: z.string().optional().describe("SSH password (default: SSH_PASSWORD env)"),
      privateKeyFile: z.string().optional().describe("Path to SSH private key file"),
    },
    async (params) => {
      let cfg: SshConfig;
      try {
        cfg = resolveSshConfig(params, envDefaults);
      } catch {
        return textResult("Missing SSH connection details. Set SSH_HOST, SSH_USER, and SSH_PASSWORD/SSH_PRIVATE_KEY_FILE.");
      }

      try {
        const result = await execSsh(cfg.host, cfg.port, cfg.username, { password: cfg.password, privateKey: cfg.keyFile }, "echo OK && hostname && uptime", 15_000);
        return textResult(`# SSH Connection OK\n- Host: ${cfg.host}:${cfg.port}\n- User: ${cfg.username}\n\n\`\`\`\n${result.stdout.trimEnd()}\n\`\`\``);
      } catch (err) {
        return textResult(`# SSH Connection FAILED\n- Host: ${cfg.host}:${cfg.port}\n- Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}
