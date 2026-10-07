import { describe, expect, it, vi } from "vitest";
import { TyriaProjectsClient, randomTicket, validateTyriaOrigin } from "./client.js";

const BASE_URL = "https://sandbox.tyriacore.app";
const RESOURCE = `${BASE_URL}/api/v1/task-projects`;
const SCOPES = "openid profile offline_access tyria.projects.read tyria.projects.write tyria.projects.comments tyria.projects.files.read";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

describe("Tyria Projects client", () => {
  it("accepts only exact safe issuer origins", () => {
    expect(validateTyriaOrigin("https://sandbox.tyriacore.app").origin).toBe("https://sandbox.tyriacore.app");
    expect(validateTyriaOrigin("http://localhost:3000").origin).toBe("http://localhost:3000");
    for (const value of ["http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com/?x=1", "file:///tmp/a"]) {
      expect(() => validateTyriaOrigin(value)).toThrow();
    }
  });

  it("creates high-entropy opaque preview tickets", () => {
    const values = new Set(Array.from({ length: 50 }, randomTicket));
    expect(values.size).toBe(50);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("keeps the device code server-side and persists only the rotated refresh token", async () => {
    let now = 1_900_000_000_000;
    const stored: Array<string | null> = [];
    const requests: Array<{ url: string; body: string }> = [];
    const accessToken = jwt({
      iss: `${BASE_URL}/api/auth`,
      sub: "user_1",
      aud: RESOURCE,
      exp: Math.floor(now / 1000) + 600,
      scope: SCOPES,
      tyria_workspace_id: "workspace_1",
    });
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/api/auth/device/code")) {
        return Response.json({ device_code: "never-expose-device-code", user_code: "ABCD-EFGH", verification_uri: `${BASE_URL}/device`, expires_in: 600, interval: 5 });
      }
      return Response.json({ token_type: "Bearer", access_token: accessToken, expires_in: 600, expires_at: Math.floor(now / 1000) + 600, refresh_token: "rotated-refresh-token", scope: SCOPES });
    });
    const client = new TyriaProjectsClient({
      getConfig: async () => ({ baseUrl: BASE_URL, clientId: "tyria-bb", refreshToken: undefined }),
      setRefreshToken: async (value) => { stored.push(value); },
      fetch: fetcher as typeof fetch,
      now: () => now,
      resolveHost: async () => ["57.144.120.141"],
    });

    const pending = await client.startConnection();
    expect(JSON.stringify(pending)).not.toContain("never-expose-device-code");
    expect(pending).toMatchObject({ state: "awaiting_user", userCode: "ABCD-EFGH" });
    now += 5_000;
    const connected = await client.pollConnection();
    expect(connected).toMatchObject({ state: "connected", account: { id: "user_1" }, workspace: { id: "workspace_1" } });
    expect(stored).toEqual([null, "rotated-refresh-token"]);
    expect(requests[1]?.body).toContain("device_code=never-expose-device-code");
  });

  it("rejects the origin itself when Tyria does not issue from its auth root", async () => {
    let now = 1_900_000_000_000;
    const accessToken = jwt({
      iss: BASE_URL,
      sub: "user_1",
      aud: RESOURCE,
      exp: Math.floor(now / 1000) + 600,
      scope: SCOPES,
      tyria_workspace_id: "workspace_1",
    });
    const client = new TyriaProjectsClient({
      getConfig: async () => ({ baseUrl: BASE_URL, clientId: "tyria-bb", refreshToken: undefined }),
      setRefreshToken: async () => undefined,
      fetch: vi.fn(async (input: URL | RequestInfo) => String(input).endsWith("/api/auth/device/code")
        ? Response.json({ device_code: "server-only", user_code: "ABCD-EFGH", verification_uri: `${BASE_URL}/device`, expires_in: 600, interval: 5 })
        : Response.json({ token_type: "Bearer", access_token: accessToken, expires_in: 600, refresh_token: "refresh", scope: SCOPES })) as typeof fetch,
      now: () => now,
      resolveHost: async () => ["57.144.120.141"],
    });

    await client.startConnection();
    now += 5_000;
    await expect(client.pollConnection()).rejects.toMatchObject({
      clientError: { code: "INVALID_AUDIENCE" },
    });
  });

  it("sends source=all and validates the Tyria attachment page shape", async () => {
    const now = 1_900_000_000_000;
    const urls: string[] = [];
    const accessToken = jwt({
      iss: `${BASE_URL}/api/auth`,
      sub: "user_1",
      aud: RESOURCE,
      exp: Math.floor(now / 1000) + 600,
      scope: SCOPES,
      tyria_workspace_id: "workspace_1",
    });
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/api/auth/oauth2/token")) {
        return Response.json({ token_type: "Bearer", access_token: accessToken, expires_in: 600, refresh_token: "rotated", scope: SCOPES });
      }
      return Response.json({
        data: {
          items: [{ id: "file_1", source: { type: "Comment", id: "comment_1" }, name: "screen.png", contentType: "image/png", sizeBytes: 42, createdAt: "2026-10-06T10:00:00.000Z", previewable: true }],
          nextCursor: null,
        },
        meta: { requestId: "request_1" },
      });
    });
    const client = new TyriaProjectsClient({
      getConfig: async () => ({ baseUrl: BASE_URL, clientId: "tyria-bb", refreshToken: "refresh" }),
      setRefreshToken: async () => undefined,
      fetch: fetcher as typeof fetch,
      now: () => now,
      resolveHost: async () => ["57.144.120.141"],
    });

    await expect(client.listAttachments("project_1", "task_1", { limit: 100, source: "all" })).resolves.toMatchObject({
      items: [{ id: "file_1", source: { type: "Comment" } }],
      nextCursor: null,
    });
    expect(urls[1]).toBe(`${BASE_URL}/api/v1/task-projects/project_1/tasks/task_1/attachments?limit=100&source=all`);
  });
});
