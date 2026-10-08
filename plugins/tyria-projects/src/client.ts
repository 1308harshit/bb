import { lookup } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  apiErrorCodeSchema,
  attachmentViewSchema,
  clientErrorSchema,
  commentViewSchema,
  connectionStateSchema,
  projectBoardSchema,
  projectSummarySchema,
  taskDetailSchema,
  taskSummarySchema,
  type AttachmentListQuery,
  type AttachmentView,
  type AssignTaskInput,
  type ClientError,
  type CommentListQuery,
  type ConnectionState,
  type CreateCommentInput,
  type CreateTaskInput,
  type MoveTaskInput,
  type PatchTaskInput,
  type ProjectListQuery,
  type TaskListQuery,
} from "../contract.js";

export const DEFAULT_TYRIA_BASE_URL = "https://www.sandbox.tyriacore.app";
export const DEFAULT_TYRIA_CLIENT_ID = "tyria-bb";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const REQUESTED_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "tyria.projects.read",
  "tyria.projects.write",
  "tyria.projects.comments",
  "tyria.projects.files.read",
] as const;

const deviceResponseSchema = z
  .object({
    device_code: z.string().min(1).max(4096),
    user_code: z.string().min(1).max(100),
    verification_uri: z.string().url(),
    verification_uri_complete: z.string().url().optional(),
    expires_in: z.number().int().positive().max(3600),
    interval: z.number().int().positive().max(60),
  })
  .strict();
const tokenResponseSchema = z
  .object({
    token_type: z.literal("Bearer"),
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().max(86_400),
    expires_at: z.number().int().positive().optional(),
    refresh_token: z.string().min(1).optional(),
    scope: z.string(),
    id_token: z.string().min(1).optional(),
  })
  .strict();
const deviceErrorSchema = z
  .object({
    error: z.enum([
      "authorization_pending",
      "slow_down",
      "access_denied",
      "expired_token",
      "invalid_client",
      "invalid_grant",
      "invalid_scope",
      "invalid_target",
    ]),
  })
  .passthrough();
const apiErrorBodySchema = z
  .object({
    error: z
      .object({
        code: apiErrorCodeSchema,
        message: z.string().min(1).max(500),
        requestId: z.string().min(1).max(200),
        retryable: z.boolean(),
        fieldIssues: z
          .array(z.object({ path: z.string(), message: z.string() }).strict())
          .optional(),
        currentVersion: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();
const apiMetaSchema = z.object({ requestId: z.string().min(1) }).strict();
const cursorPage = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() }).strict();
const success = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: apiMetaSchema }).strict();
const jwtClaimsSchema = z
  .object({
    iss: z.string().url(),
    sub: z.string().min(1).max(128),
    aud: z.union([z.string(), z.array(z.string())]),
    exp: z.number().int().positive(),
    scope: z.string(),
    tyria_workspace_id: z.string().min(1).max(128),
  })
  .passthrough();
const idClaimsSchema = z
  .object({ name: z.string().min(1).max(255).optional() })
  .passthrough();

export class TyriaClientFailure extends Error {
  readonly clientError: ClientError;

  constructor(error: ClientError) {
    super(error.message);
    this.name = "TyriaClientFailure";
    this.clientError = clientErrorSchema.parse(error);
  }
}

interface ClientConfig {
  baseUrl: string;
  clientId: string;
  refreshToken: string | undefined;
}

interface TokenState {
  accessToken: string;
  expiresAtMs: number;
  account: { id: string; displayName: string };
  workspace: { id: string; name: string };
}

interface DeviceFlow {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAtMs: number;
  intervalMs: number;
  nextPollAtMs: number;
}

interface TyriaProjectsClientOptions {
  getConfig(): Promise<ClientConfig>;
  setRefreshToken(value: string | null): Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  resolveHost?: (hostname: string) => Promise<string[]>;
}

function failure(
  code: ClientError["code"],
  message: string,
  retryable = false,
  extra: Partial<Pick<ClientError, "requestId" | "currentVersion">> = {},
): TyriaClientFailure {
  return new TyriaClientFailure({ code, message, retryable, ...extra });
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    isPrivateIpv4(normalized) ||
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

export function validateTyriaOrigin(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw failure(
      "INVALID_CONFIGURATION",
      "Tyria base URL must be an absolute origin.",
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw failure(
      "INVALID_CONFIGURATION",
      "Tyria base URL must contain only an origin without credentials, path, query, or fragment.",
    );
  }
  const loopback = url.hostname === "localhost";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw failure(
      "INVALID_CONFIGURATION",
      "Tyria requires HTTPS, except for an exact localhost development origin.",
    );
  }
  if (!loopback && (url.hostname.includes(":") || isPrivateIpv4(url.hostname))) {
    throw failure(
      "INVALID_CONFIGURATION",
      "Private and link-local Tyria origins are not allowed.",
    );
  }
  return url;
}

function decodeJwt(token: string): unknown {
  const payload = token.split(".")[1];
  if (!payload) throw failure("UNAUTHENTICATED", "Tyria returned an invalid access token.");
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw failure("UNAUTHENTICATED", "Tyria returned an invalid access token.");
  }
}

function queryString(input: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    query.set(key, String(value));
  }
  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}

function retryAfterMs(response: Response): number {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 30_000));
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, Math.min(time - Date.now(), 30_000)) : 0;
}

function safeMessage(code: ClientError["code"]): string {
  const messages: Partial<Record<ClientError["code"], string>> = {
    UNAUTHENTICATED: "Connect Tyria again to continue.",
    TOKEN_EXPIRED: "Your Tyria authorization expired. Connect again.",
    INVALID_AUDIENCE: "The Tyria authorization is not valid for Projects.",
    INSUFFICIENT_SCOPE: "The Tyria authorization does not include this capability.",
    PERMISSION_DENIED: "You do not have permission for this Tyria action.",
    FEATURE_DISABLED: "Tyria Projects is disabled for this workspace.",
    RESOURCE_NOT_FOUND: "The requested Tyria record is unavailable.",
    VERSION_CONFLICT: "This task changed in Tyria. Refresh it before retrying.",
    DUPLICATE_MUTATION: "Tyria rejected a conflicting repeated mutation.",
    WIP_LIMIT_WARNING: "This phase is at its WIP limit. Confirm to proceed anyway.",
    RATE_LIMITED: "Tyria is rate limiting requests. Try again shortly.",
    UPSTREAM_UNAVAILABLE: "Tyria is temporarily unavailable.",
    NETWORK_ERROR: "Tyria could not be reached.",
    INTERNAL_ERROR: "Tyria could not complete the request.",
  };
  return messages[code] ?? "Tyria rejected the request.";
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an unreadable response.", true);
  }
}

export class TyriaProjectsClient {
  private readonly getConfig: TyriaProjectsClientOptions["getConfig"];
  private readonly setRefreshToken: TyriaProjectsClientOptions["setRefreshToken"];
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly sleeper: (milliseconds: number) => Promise<void>;
  private readonly resolveHost: (hostname: string) => Promise<string[]>;
  private token: TokenState | null = null;
  private flow: DeviceFlow | null = null;
  private refreshPromise: Promise<TokenState> | null = null;
  private disposed = false;

  constructor(options: TyriaProjectsClientOptions) {
    this.getConfig = options.getConfig;
    this.setRefreshToken = options.setRefreshToken;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleeper =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, milliseconds);
          timer.unref?.();
        }));
    this.resolveHost =
      options.resolveHost ??
      (async (hostname) => {
        const addresses = await lookup(hostname, { all: true, verbatim: true });
        return addresses.map((entry) => entry.address);
      });
  }

  dispose(): void {
    this.disposed = true;
    this.flow = null;
    this.token = null;
  }

  isConnected(): boolean {
    return this.token !== null && this.token.expiresAtMs > this.now();
  }

  private async config(): Promise<{ origin: URL; clientId: string; refreshToken: string | undefined }> {
    const configured = await this.getConfig();
    const origin = validateTyriaOrigin(configured.baseUrl.trim());
    const clientId = configured.clientId.trim();
    if (!/^[A-Za-z0-9._~-]{1,128}$/u.test(clientId)) {
      throw failure("INVALID_CONFIGURATION", "Tyria client ID is invalid.");
    }
    if (origin.hostname !== "localhost") {
      let addresses: string[];
      try {
        addresses = await this.resolveHost(origin.hostname);
      } catch {
        throw failure("NETWORK_ERROR", "Tyria could not be reached.", true);
      }
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        throw failure(
          "INVALID_CONFIGURATION",
          "The Tyria origin resolved to a private or link-local address.",
        );
      }
    }
    return { origin, clientId, refreshToken: configured.refreshToken };
  }

  private resource(origin: URL): string {
    return `${origin.origin}/api/v1/task-projects`;
  }

  private async postForm(origin: URL, path: string, values: Record<string, string>): Promise<Response> {
    const response = await this.fetcher(new URL(path, origin), {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(values),
    });
    if (response.status >= 300 && response.status < 400) {
      throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an unsafe redirect.");
    }
    return response;
  }

  async getConnection(): Promise<ConnectionState> {
    if (this.flow) return this.flowState();
    if (this.token && this.token.expiresAtMs > this.now()) return this.connectedState(this.token);
    const { refreshToken } = await this.config();
    if (!refreshToken) return { state: "disconnected" };
    try {
      const token = await this.refresh();
      return this.connectedState(token);
    } catch (error) {
      return { state: "expired", reason: asClientError(error).message };
    }
  }

  async startConnection(): Promise<ConnectionState> {
    await this.disconnect(true);
    const { origin, clientId } = await this.config();
    let response: Response;
    try {
      response = await this.postForm(origin, "/api/auth/device/code", {
        client_id: clientId,
        scope: REQUESTED_SCOPES.join(" "),
        resource: this.resource(origin),
      });
    } catch (error) {
      throw error instanceof TyriaClientFailure
        ? error
        : failure("NETWORK_ERROR", "Tyria could not be reached.", true);
    }
    if (!response.ok) {
      throw failure("UNAUTHENTICATED", "Tyria could not start authorization.");
    }
    const body = deviceResponseSchema.safeParse(await parseJson(response));
    if (!body.success) {
      throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an invalid authorization response.");
    }
    const verification = new URL(
      body.data.verification_uri_complete ?? body.data.verification_uri,
    );
    if (verification.origin !== origin.origin || verification.protocol !== origin.protocol) {
      throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an unsafe verification address.");
    }
    const now = this.now();
    this.flow = {
      deviceCode: body.data.device_code,
      userCode: body.data.user_code,
      verificationUri: verification.toString(),
      expiresAtMs: now + body.data.expires_in * 1000,
      intervalMs: body.data.interval * 1000,
      nextPollAtMs: now + body.data.interval * 1000,
    };
    return this.flowState();
  }

  async pollConnection(): Promise<ConnectionState> {
    const flow = this.flow;
    if (!flow) return this.getConnection();
    if (flow.expiresAtMs <= this.now()) {
      this.flow = null;
      return { state: "expired", reason: "The Tyria authorization code expired." };
    }
    if (this.now() < flow.nextPollAtMs) return this.flowState();
    const { origin, clientId } = await this.config();
    flow.nextPollAtMs = this.now() + flow.intervalMs;
    let response: Response;
    try {
      response = await this.postForm(origin, "/api/auth/oauth2/token", {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: flow.deviceCode,
        client_id: clientId,
        resource: this.resource(origin),
      });
    } catch {
      return {
        state: "error",
        error: {
          code: "NETWORK_ERROR",
          message: "Tyria could not be reached while waiting for approval.",
          retryable: true,
        },
      };
    }
    if (response.ok) {
      const token = await this.acceptToken(await parseJson(response), origin);
      this.flow = null;
      return this.connectedState(token);
    }
    const body = deviceErrorSchema.safeParse(await parseJson(response));
    if (!body.success) {
      this.flow = null;
      throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an invalid authorization response.");
    }
    if (body.data.error === "authorization_pending") return this.flowState();
    if (body.data.error === "slow_down") {
      flow.intervalMs += 5_000;
      flow.nextPollAtMs = this.now() + flow.intervalMs;
      return this.flowState();
    }
    this.flow = null;
    if (body.data.error === "access_denied") {
      throw failure("CONNECTION_CANCELLED", "Tyria authorization was denied.");
    }
    if (body.data.error === "expired_token") {
      return { state: "expired", reason: "The Tyria authorization code expired." };
    }
    throw failure("INVALID_CONFIGURATION", "Tyria rejected the OAuth client configuration.");
  }

  private flowState(): ConnectionState {
    if (!this.flow) return { state: "disconnected" };
    return connectionStateSchema.parse({
      state: "awaiting_user",
      verificationUri: this.flow.verificationUri,
      userCode: this.flow.userCode,
      expiresAt: new Date(this.flow.expiresAtMs).toISOString(),
    });
  }

  private connectedState(token: TokenState): ConnectionState {
    return connectionStateSchema.parse({
      state: "connected",
      account: token.account,
      workspace: token.workspace,
      expiresAt: new Date(token.expiresAtMs).toISOString(),
    });
  }

  private async acceptToken(raw: unknown, origin: URL): Promise<TokenState> {
    const response = tokenResponseSchema.safeParse(raw);
    if (!response.success) {
      throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an invalid token response.");
    }
    const requiredScopes = new Set(REQUESTED_SCOPES);
    const granted = new Set(response.data.scope.split(/\s+/u).filter(Boolean));
    if ([...requiredScopes].some((scope) => !granted.has(scope))) {
      throw failure("INSUFFICIENT_SCOPE", "Tyria did not grant every required Projects scope.");
    }
    const claims = jwtClaimsSchema.safeParse(decodeJwt(response.data.access_token));
    if (!claims.success) {
      throw failure("UNAUTHENTICATED", "Tyria returned an invalid access token.");
    }
    const resource = this.resource(origin);
    const audience = Array.isArray(claims.data.aud) ? claims.data.aud : [claims.data.aud];
    const issuer = new URL("/api/auth", origin).toString();
    if (claims.data.iss !== issuer || !audience.includes(resource)) {
      throw failure("INVALID_AUDIENCE", "The Tyria token is not valid for this Projects resource.");
    }
    const profile = response.data.id_token
      ? idClaimsSchema.safeParse(decodeJwt(response.data.id_token))
      : null;
    const expiresAtMs = Math.min(
      this.now() + response.data.expires_in * 1000,
      response.data.expires_at ? response.data.expires_at * 1000 : Number.POSITIVE_INFINITY,
      claims.data.exp * 1000,
    );
    const token: TokenState = {
      accessToken: response.data.access_token,
      expiresAtMs,
      account: {
        id: claims.data.sub,
        displayName:
          profile?.success && profile.data.name ? profile.data.name : claims.data.sub,
      },
      workspace: {
        id: claims.data.tyria_workspace_id,
        name: claims.data.tyria_workspace_id,
      },
    };
    if (response.data.refresh_token) {
      await this.setRefreshToken(response.data.refresh_token);
    }
    this.token = token;
    return token;
  }

  private async refresh(): Promise<TokenState> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<TokenState> {
    const { origin, clientId, refreshToken } = await this.config();
    if (!refreshToken) throw failure("NOT_CONNECTED", "Connect Tyria to continue.");
    let response: Response;
    try {
      response = await this.postForm(origin, "/api/auth/oauth2/token", {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        resource: this.resource(origin),
      });
    } catch {
      throw failure("NETWORK_ERROR", "Tyria could not be reached.", true);
    }
    if (!response.ok) {
      await this.clearGrant();
      throw failure("TOKEN_EXPIRED", "Your Tyria authorization expired. Connect again.");
    }
    return this.acceptToken(await parseJson(response), origin);
  }

  private async accessToken(): Promise<string> {
    if (this.disposed) throw failure("NOT_CONNECTED", "The Tyria plugin is stopping.");
    if (this.token && this.token.expiresAtMs - this.now() > 30_000) {
      return this.token.accessToken;
    }
    return (await this.refresh()).accessToken;
  }

  private async clearGrant(): Promise<void> {
    this.token = null;
    this.flow = null;
    await this.setRefreshToken(null);
  }

  async disconnect(skipRevoke = false): Promise<void> {
    const config = await this.config();
    this.flow = null;
    this.token = null;
    if (!skipRevoke && config.refreshToken) {
      try {
        await this.postForm(config.origin, "/api/auth/oauth2/revoke", {
          token: config.refreshToken,
          token_type_hint: "refresh_token",
          client_id: config.clientId,
        });
      } catch {}
    }
    await this.setRefreshToken(null);
  }

  private async request(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    input?: unknown,
  ): Promise<Response> {
    const safeRead = method === "GET";
    const { origin } = await this.config();
    let refreshed = false;
    for (let attempt = 0; attempt < (safeRead ? 3 : 1); attempt += 1) {
      const accessToken = await this.accessToken();
      let response: Response;
      try {
        response = await this.fetcher(new URL(path, origin), {
          method,
          redirect: "manual",
          cache: "no-store",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            ...(input === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        });
      } catch {
        if (!safeRead || attempt === 2) {
          throw failure("NETWORK_ERROR", "Tyria could not be reached.", true);
        }
        await this.sleeper(150 * 2 ** attempt + Math.floor(Math.random() * 100));
        continue;
      }
      if (response.status >= 300 && response.status < 400) {
        throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an unsafe redirect.");
      }
      if (response.status === 401 && safeRead && !refreshed) {
        refreshed = true;
        this.token = null;
        await this.refresh();
        continue;
      }
      if (safeRead && (response.status === 429 || response.status === 503) && attempt < 2) {
        const wait = retryAfterMs(response) || 150 * 2 ** attempt + Math.floor(Math.random() * 100);
        await this.sleeper(wait);
        continue;
      }
      return response;
    }
    throw failure("UPSTREAM_UNAVAILABLE", "Tyria is temporarily unavailable.", true);
  }

  private async json<T>(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    schema: z.ZodType<T>,
    input?: unknown,
  ): Promise<T> {
    const response = await this.request(method, path, input);
    const raw = await parseJson(response);
    if (!response.ok) {
      const parsed = apiErrorBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an invalid error response.", true);
      }
      throw failure(
        parsed.data.error.code,
        safeMessage(parsed.data.error.code),
        parsed.data.error.retryable,
        {
          requestId: parsed.data.error.requestId,
          ...(parsed.data.error.currentVersion === undefined
            ? {}
            : { currentVersion: parsed.data.error.currentVersion }),
        },
      );
    }
    const parsed = success(schema).safeParse(raw);
    if (!parsed.success) {
      throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an invalid Projects response.", true);
    }
    return parsed.data.data;
  }

  listProjects(query: ProjectListQuery) {
    return this.json(
      "GET",
      `/api/v1/task-projects${queryString(query)}`,
      cursorPage(projectSummarySchema),
    );
  }

  getBoard(projectId: string) {
    return this.json(
      "GET",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/board`,
      projectBoardSchema,
    );
  }

  listTasks(projectId: string, query: TaskListQuery) {
    return this.json(
      "GET",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks${queryString(query)}`,
      cursorPage(taskSummarySchema),
    );
  }

  getTask(projectId: string, taskId: string) {
    return this.json(
      "GET",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      taskDetailSchema,
    );
  }

  createTask(projectId: string, input: CreateTaskInput) {
    return this.json(
      "POST",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks`,
      taskDetailSchema,
      input,
    );
  }

  patchTask(projectId: string, taskId: string, input: PatchTaskInput) {
    return this.json(
      "PATCH",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
      taskDetailSchema,
      input,
    );
  }

  moveTask(projectId: string, taskId: string, input: MoveTaskInput) {
    return this.json(
      "PATCH",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/phase`,
      taskDetailSchema,
      input,
    );
  }

  assignTask(projectId: string, taskId: string, input: AssignTaskInput) {
    return this.json(
      "PUT",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/assignees`,
      taskDetailSchema,
      input,
    );
  }

  listComments(projectId: string, taskId: string, query: CommentListQuery) {
    return this.json(
      "GET",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments${queryString(query)}`,
      cursorPage(commentViewSchema),
    );
  }

  createComment(projectId: string, taskId: string, input: CreateCommentInput) {
    return this.json(
      "POST",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`,
      commentViewSchema,
      input,
    );
  }

  listAttachments(projectId: string, taskId: string, query: AttachmentListQuery) {
    return this.json(
      "GET",
      `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/attachments${queryString(query)}`,
      cursorPage(attachmentViewSchema),
    );
  }

  async findAttachment(projectId: string, taskId: string, fileId: string): Promise<AttachmentView> {
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const result = await this.listAttachments(projectId, taskId, {
        limit: 100,
        source: "all",
        ...(cursor ? { cursor } : {}),
      });
      const match = result.items.find((item) => item.id === fileId);
      if (match) return match;
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    throw failure("RESOURCE_NOT_FOUND", "The requested Tyria record is unavailable.");
  }

  async attachmentResponse(projectId: string, taskId: string, fileId: string): Promise<Response> {
    const path = `/api/v1/task-projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(fileId)}/content`;
    const response = await this.request("GET", path);
    if (!response.ok) {
      const raw = await parseJson(response);
      const parsed = apiErrorBodySchema.safeParse(raw);
      if (!parsed.success) throw failure("UPSTREAM_UNAVAILABLE", "Tyria returned an invalid error response.", true);
      throw failure(parsed.data.error.code, safeMessage(parsed.data.error.code), parsed.data.error.retryable, {
        requestId: parsed.data.error.requestId,
      });
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_ATTACHMENT_BYTES) {
      throw failure("PAYLOAD_TOO_LARGE", "This attachment exceeds the 10 MiB limit.");
    }
    return response;
  }

  async attachmentImage(projectId: string, taskId: string, fileId: string): Promise<{ data: string; mimeType: string }> {
    const response = await this.attachmentResponse(projectId, taskId, fileId);
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw failure("UNSUPPORTED_MEDIA_TYPE", "Muse analysis supports PNG and JPEG screenshots only.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw failure("PAYLOAD_TOO_LARGE", "This attachment exceeds the 10 MiB limit.");
    }
    return { data: bytes.toString("base64"), mimeType };
  }
}

export function asClientError(error: unknown): ClientError {
  if (error instanceof TyriaClientFailure) return error.clientError;
  return {
    code: "INTERNAL_ERROR",
    message: "Tyria could not complete the request.",
    retryable: false,
  };
}

export function randomTicket(): string {
  return randomBytes(32).toString("base64url");
}
