import { createHash } from "node:crypto";

const API_BASES: Record<string, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
};

// Same token URLs and scope as go-ovh (ovh/ovh.go, ovh/configuration.go).
const OAUTH2_TOKEN_URLS: Record<string, string> = {
  "ovh-eu": "https://www.ovh.com/auth/oauth2/token",
  "ovh-ca": "https://ca.ovh.com/auth/oauth2/token",
  "ovh-us": "https://us.ovhcloud.com/auth/oauth2/token",
};

export const TIMEOUT_MS = Number(process.env.OVH_TIMEOUT_MS) || 30_000;

const FORBIDDEN_PATH_PATTERNS = /[?#\\]|\.\./;

export class OvhApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface ApiKeyConfig {
  mode: "apikey";
  endpoint: string;
  appKey: string;
  appSecret: string;
  consumerKey: string;
}

export interface OAuth2Config {
  mode: "oauth2";
  endpoint: string;
  clientId: string;
  clientSecret: string;
}

export type OvhConfig = ApiKeyConfig | OAuth2Config;

export function validatePath(path: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error(`Unsafe API path rejected: "${path}" — invalid percent-encoding`);
  }
  if (FORBIDDEN_PATH_PATTERNS.test(path) || FORBIDDEN_PATH_PATTERNS.test(decoded)) {
    throw new Error(`Unsafe API path rejected: "${path}" — must not contain "..", "?", "#" or "\\", even percent-encoded`);
  }
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with "/": "${path}"`);
  }
}

export class OvhClient {
  readonly baseUrl: string;
  private config: OvhConfig;
  private timeDelta: number | null = null;

  private oauth2Token: string | null = null;
  private oauth2Expiry = 0;

  constructor(config: OvhConfig) {
    if (config.mode === "oauth2" && !OAUTH2_TOKEN_URLS[config.endpoint]) {
      throw new Error(`OAuth2 is only supported for ${Object.keys(OAUTH2_TOKEN_URLS).join(", ")}, not "${config.endpoint}"`);
    }
    this.baseUrl = (API_BASES[config.endpoint] ?? config.endpoint).replace(/\/+$/, "");
    this.config = config;
  }

  get authMode(): "apikey" | "oauth2" {
    return this.config.mode;
  }

  private async syncTime(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/time`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    const serverTime = Number(text);
    if (!res.ok || !Number.isFinite(serverTime)) {
      throw new OvhApiError(`OVH time sync GET /auth/time failed → ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    this.timeDelta = serverTime - Math.floor(Date.now() / 1000);
  }

  private async getTimestamp(): Promise<number> {
    if (this.timeDelta === null) await this.syncTime();
    return Math.floor(Date.now() / 1000) + (this.timeDelta ?? 0);
  }

  private sign(method: string, url: string, body: string, timestamp: number): string {
    const cfg = this.config as ApiKeyConfig;
    const payload = [cfg.appSecret, cfg.consumerKey, method, url, body, String(timestamp)].join("+");
    return "$1$" + createHash("sha1").update(payload).digest("hex");
  }

  private async getOAuth2Token(): Promise<string> {
    if (this.oauth2Token && Date.now() < this.oauth2Expiry) {
      return this.oauth2Token;
    }

    const cfg = this.config as OAuth2Config;
    const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");

    const res = await fetch(OAUTH2_TOKEN_URLS[cfg.endpoint], {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=all",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OAuth2 token request failed: ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("OAuth2 token response has no access_token");
    this.oauth2Token = data.access_token;
    this.oauth2Expiry = Date.now() + ((data.expires_in ?? 60) - 30) * 1000;
    return this.oauth2Token;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    validatePath(path);

    let url = `${this.baseUrl}${path}`;
    if (query && Object.keys(query).length > 0) {
      url += "?" + new URLSearchParams(query).toString();
    }

    const bodyStr = body != null ? JSON.stringify(body) : "";
    const headers: Record<string, string> = {};

    if (this.config.mode === "apikey") {
      const cfg = this.config as ApiKeyConfig;
      const timestamp = await this.getTimestamp();
      headers["X-Ovh-Application"] = cfg.appKey;
      headers["X-Ovh-Consumer"] = cfg.consumerKey;
      headers["X-Ovh-Timestamp"] = String(timestamp);
      headers["X-Ovh-Signature"] = this.sign(method.toUpperCase(), url, bodyStr, timestamp);
    } else {
      const token = await this.getOAuth2Token();
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (bodyStr) headers["Content-Type"] = "application/json";

    const verb = method.toUpperCase();
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, { method: verb, headers, body: bodyStr || undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (err) {
      // A write that timed out may still have been applied; never retry it blindly.
      if (verb !== "GET" && err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(`OVH API ${verb} ${path} timed out after ${TIMEOUT_MS} ms: outcome unknown. Check the current state with a read before retrying.`);
      }
      throw err;
    }
    if (!res.ok) {
      throw new OvhApiError(`OVH API ${verb} ${path} → ${res.status}: ${text.slice(0, 500)}`, res.status);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  get<T = unknown>(path: string, query?: Record<string, string>) {
    return this.request<T>("GET", path, undefined, query);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body);
  }

  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, body);
  }

  del<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
  }
}
