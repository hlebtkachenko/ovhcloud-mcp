import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { OvhClient, validatePath } from "../src/ovh-client.js";
import type { ApiKeyConfig, OAuth2Config } from "../src/ovh-client.js";

describe("validatePath", () => {
  it("accepts valid paths", () => {
    expect(() => validatePath("/vps")).not.toThrow();
    expect(() => validatePath("/domain/zone/example.com/record")).not.toThrow();
    expect(() => validatePath("/me/bill/123456")).not.toThrow();
    expect(() => validatePath("/v1/cloud/project")).not.toThrow();
  });

  it("rejects path traversal", () => {
    expect(() => validatePath("/vps/../me")).toThrow("Unsafe API path");
    expect(() => validatePath("/domain/..")).toThrow("Unsafe API path");
  });

  it("rejects query string in path", () => {
    expect(() => validatePath("/vps?foo=bar")).toThrow("Unsafe API path");
  });

  it("rejects fragment in path", () => {
    expect(() => validatePath("/vps#section")).toThrow("Unsafe API path");
  });

  it("rejects paths not starting with /", () => {
    expect(() => validatePath("vps")).toThrow('must start with "/"');
  });
});

describe("OvhClient constructor", () => {
  it("creates API key client", () => {
    const config: ApiKeyConfig = {
      mode: "apikey",
      endpoint: "ovh-eu",
      appKey: "test-key",
      appSecret: "test-secret",
      consumerKey: "test-consumer",
    };
    const client = new OvhClient(config);
    expect(client.authMode).toBe("apikey");
  });

  it("creates OAuth2 client", () => {
    const config: OAuth2Config = {
      mode: "oauth2",
      endpoint: "ovh-eu",
      clientId: "test-id",
      clientSecret: "test-secret",
    };
    const client = new OvhClient(config);
    expect(client.authMode).toBe("oauth2");
  });

  it("accepts custom endpoint URL", () => {
    const config: ApiKeyConfig = {
      mode: "apikey",
      endpoint: "https://custom.api.com/1.0",
      appKey: "k",
      appSecret: "s",
      consumerKey: "c",
    };
    const client = new OvhClient(config);
    expect(client.authMode).toBe("apikey");
  });
});

describe("OvhClient.request", () => {
  let client: OvhClient;

  beforeEach(() => {
    client = new OvhClient({
      mode: "apikey",
      endpoint: "ovh-eu",
      appKey: "test",
      appSecret: "test",
      consumerKey: "test",
    });
  });

  it("rejects unsafe paths before making network calls", async () => {
    await expect(client.get("/me/../secret")).rejects.toThrow("Unsafe API path");
    await expect(client.get("/vps?admin=true")).rejects.toThrow("Unsafe API path");
    await expect(client.get("/me#hack")).rejects.toThrow("Unsafe API path");
  });

  it("rejects paths not starting with /", async () => {
    await expect(client.get("vps")).rejects.toThrow('must start with "/"');
  });
});
