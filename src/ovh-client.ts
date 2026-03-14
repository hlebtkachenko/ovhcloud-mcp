import { createHash } from "node:crypto";

const API_BASES: Record<string, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
};

const AUTH_BASES: Record<string, string> = {
  "ovh-eu": "https://auth.eu.ovhcloud.com",
  "ovh-us": "https://auth.us.ovhcloud.com",
  "ovh-ca": "https://auth.ca.ovhcloud.com",
};

const TIMEOUT_MS = 30_000;

const FORBIDDEN_PATH_PATTERNS = /[?#]|\.\./;

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
  if (FORBIDDEN_PATH_PATTERNS.test(path)) {
    throw new Error(`Unsafe API path rejected: "${path}" — must not contain "..", "?" or "#"`);
  }
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with "/": "${path}"`);
  }
}

export class OvhClient {
  private baseUrl: string;
  private config: OvhConfig;
  private timeDelta: number | null = null;

  private oauth2Token: string | null = null;
  private oauth2Expiry = 0;

  constructor(config: OvhConfig) {
    this.baseUrl = API_BASES[config.endpoint] ?? config.endpoint;
    this.config = config;
  }

  get authMode(): "apikey" | "oauth2" {
    return this.config.mode;
  }

  private async syncTime(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/time`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const serverTime = (await res.json()) as number;
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
    const authBase = AUTH_BASES[cfg.endpoint] ?? AUTH_BASES["ovh-eu"];
    const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");

    const res = await fetch(`${authBase}/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OAuth2 token request failed: ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = JSON.parse(text) as { access_token: string; expires_in: number };
    this.oauth2Token = data.access_token;
    this.oauth2Expiry = Date.now() + (data.expires_in - 30) * 1000;
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

    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: bodyStr || undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OVH API ${method.toUpperCase()} ${path} → ${res.status}: ${text.slice(0, 500)}`);
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
