import { createHash } from "node:crypto";

const ENDPOINTS: Record<string, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
};

export interface OvhConfig {
  endpoint: string;
  appKey: string;
  appSecret: string;
  consumerKey: string;
}

export class OvhClient {
  private baseUrl: string;
  private appKey: string;
  private appSecret: string;
  private consumerKey: string;
  private timeDelta: number | null = null;

  constructor(config: OvhConfig) {
    this.baseUrl = ENDPOINTS[config.endpoint] ?? config.endpoint;
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.consumerKey = config.consumerKey;
  }

  private async syncTime(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/time`);
    const serverTime = (await res.json()) as number;
    this.timeDelta = serverTime - Math.floor(Date.now() / 1000);
  }

  private async getTimestamp(): Promise<number> {
    if (this.timeDelta === null) await this.syncTime();
    return Math.floor(Date.now() / 1000) + this.timeDelta!;
  }

  private sign(
    method: string,
    url: string,
    body: string,
    timestamp: number,
  ): string {
    const raw = [
      this.appSecret,
      this.consumerKey,
      method,
      url,
      body,
      String(timestamp),
    ].join("+");
    return "$1$" + createHash("sha1").update(raw).digest("hex");
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (query && Object.keys(query).length > 0) {
      url += "?" + new URLSearchParams(query).toString();
    }

    const bodyStr = body != null ? JSON.stringify(body) : "";
    const timestamp = await this.getTimestamp();
    const signature = this.sign(method.toUpperCase(), url, bodyStr, timestamp);

    const headers: Record<string, string> = {
      "X-Ovh-Application": this.appKey,
      "X-Ovh-Consumer": this.consumerKey,
      "X-Ovh-Timestamp": String(timestamp),
      "X-Ovh-Signature": signature,
    };
    if (bodyStr) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: bodyStr || undefined,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(
        `OVH API ${method.toUpperCase()} ${path} → ${res.status}: ${text}`,
      );
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
