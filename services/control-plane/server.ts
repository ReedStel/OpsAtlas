import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isValidDeviceId,
  MAX_TELEMETRY_BYTES,
  parseTelemetryEnvelope,
  verifyTelemetrySignature,
} from "../shared/protocol.js";
import { AgentCredentialRegistry } from "./credentials.js";
import { SqlitePersistence } from "./persistence.js";
import { ControlPlaneStore } from "./store.js";

type ServerOptions = {
  store?: ControlPlaneStore;
  agentKeys?: Map<string, string>;
  agentRegistry?: AgentCredentialRegistry;
  dashboardToken?: string;
  allowedOrigins?: Set<string>;
  persistence?: SqlitePersistence;
  databasePath?: string;
  credentialSecret?: string;
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function loadAgentKeys(raw = process.env.OPSATLAS_AGENT_KEYS): Map<string, string> {
  if (!raw) return new Map();
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("OPSATLAS_AGENT_KEYS must be a JSON object");
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([deviceId, key]) => !isValidDeviceId(deviceId) || typeof key !== "string" || key.length < 24)) throw new Error("OPSATLAS_AGENT_KEYS contains an invalid device or short key");
  return new Map(entries as Array<[string, string]>);
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_TELEMETRY_BYTES) throw new HttpError(413, "Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(request);
  let decoded: unknown;
  try { decoded = JSON.parse(body.toString("utf8")); } catch { throw new HttpError(400, "Request body is not valid JSON"); }
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new HttpError(400, "Request body must be a JSON object");
  return decoded as Record<string, unknown>;
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function safeTokenMatch(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function dashboardAuthorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) return isLoopback(request.socket.remoteAddress);
  const authorization = header(request, "authorization");
  if (!authorization.startsWith("Bearer ")) return false;
  return safeTokenMatch(authorization.slice(7), token);
}

function requireDashboard(request: IncomingMessage, token: string | undefined): void {
  if (!dashboardAuthorized(request, token)) throw new HttpError(401, "Dashboard authorization required");
}

function decodeIdentifier(value: string): string {
  try { return decodeURIComponent(value); } catch { throw new HttpError(400, "Path identifier is not valid URL encoding"); }
}

function applySecurityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

export function createControlPlane(options: ServerOptions = {}) {
  const ownsPersistence = !options.persistence && Boolean(options.databasePath);
  const persistence = options.persistence ?? (options.databasePath ? new SqlitePersistence(options.databasePath) : undefined);
  const store = options.store ?? new ControlPlaneStore({ persistence });
  const agents = options.agentRegistry ?? new AgentCredentialRegistry({
    initialKeys: options.agentKeys ?? loadAgentKeys(),
    persistence,
    credentialSecret: options.credentialSecret ?? process.env.OPSATLAS_CREDENTIAL_KEY,
  });
  const dashboardToken = options.dashboardToken ?? process.env.OPSATLAS_DASHBOARD_TOKEN;
  const allowedOrigins = options.allowedOrigins ?? new Set((process.env.OPSATLAS_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
  const subscribers = new Set<ServerResponse>();

  const broadcast = () => {
    const message = `event: state\ndata: ${JSON.stringify(store.snapshot())}\n\n`;
    for (const response of subscribers) response.write(message);
  };

  const server = createServer(async (request, response) => {
    applySecurityHeaders(response);
    const origin = header(request, "origin");
    if (origin) {
      if (!allowedOrigins.has(origin)) return sendJson(response, 403, { error: "Origin is not allowed" });
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";

      if (method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, X-OpsAtlas-Device, X-OpsAtlas-Timestamp, X-OpsAtlas-Signature",
          "Access-Control-Max-Age": "600",
        });
        return response.end();
      }

      if (method === "GET" && url.pathname === "/healthz") {
        return sendJson(response, 200, {
          status: "ok",
          version: "1.0.0",
          persistence: persistence ? "sqlite" : "memory",
          durableCredentials: agents.persistenceEnabled,
        });
      }

      if (method === "POST" && url.pathname === "/api/v1/telemetry") {
        const deviceId = header(request, "x-opsatlas-device");
        const timestamp = header(request, "x-opsatlas-timestamp");
        const signature = header(request, "x-opsatlas-signature");
        const key = agents.get(deviceId);
        if (!key) throw new HttpError(401, "Unknown agent");
        const body = await readBody(request);
        if (!verifyTelemetrySignature(body, timestamp, signature, key)) throw new HttpError(401, "Invalid or stale telemetry signature");
        let decoded: unknown;
        try { decoded = JSON.parse(body.toString("utf8")); } catch { throw new HttpError(400, "Telemetry body is not valid JSON"); }
        let telemetry;
        try { telemetry = parseTelemetryEnvelope(decoded); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid telemetry"); }
        if (telemetry.deviceId !== deviceId) throw new HttpError(400, "Signed device and body device do not match");
        const previous = store.devices.get(deviceId);
        if (previous && telemetry.sequence <= previous.telemetry.sequence) throw new HttpError(409, "Telemetry sequence was already accepted");
        const result = store.ingest(telemetry);
        broadcast();
        return sendJson(response, 202, { accepted: true, receivedAt: result.device.lastSeen, incidents: result.incidents.length });
      }

      if (method === "POST" && url.pathname === "/api/v1/enroll") {
        const body = await readJson(request);
        const deviceId = body.deviceId;
        const token = body.token;
        if (!isValidDeviceId(deviceId) || typeof token !== "string") throw new HttpError(400, "A valid deviceId and enrollment token are required");
        try {
          const enrolled = agents.enroll(deviceId, token);
          store.recordAudit(`agent:${deviceId}`, "agent.enrolled", deviceId, { durable: agents.persistenceEnabled });
          return sendJson(response, 201, { deviceId, agentKey: enrolled.agentKey, createdAt: enrolled.createdAt, durable: agents.persistenceEnabled });
        } catch (error) {
          throw new HttpError(401, error instanceof Error ? error.message : "Enrollment failed");
        }
      }

      if (method === "GET" && url.pathname === "/api/v1/state") {
        requireDashboard(request, dashboardToken);
        return sendJson(response, 200, store.snapshot());
      }

      if (method === "GET" && url.pathname === "/api/v1/events") {
        requireDashboard(request, dashboardToken);
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        response.write(`event: state\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 25_000);
        subscribers.add(response);
        request.on("close", () => { clearInterval(heartbeat); subscribers.delete(response); });
        return;
      }

      if (method === "GET" && url.pathname === "/api/v1/agents") {
        requireDashboard(request, dashboardToken);
        return sendJson(response, 200, { agents: agents.list(), durableCredentials: agents.persistenceEnabled });
      }

      if (method === "POST" && url.pathname === "/api/v1/enrollments") {
        requireDashboard(request, dashboardToken);
        const body = await readJson(request);
        if (!isValidDeviceId(body.deviceId)) throw new HttpError(400, "A valid deviceId is required");
        const ttlSeconds = body.ttlSeconds === undefined ? 600 : Number(body.ttlSeconds);
        try {
          const enrollment = agents.issueEnrollment(body.deviceId, ttlSeconds);
          store.recordAudit("dashboard", "enrollment.issued", body.deviceId, { expiresAt: enrollment.expiresAt });
          return sendJson(response, 201, { deviceId: body.deviceId, ...enrollment });
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : "Enrollment could not be created");
        }
      }

      const acknowledgeMatch = url.pathname.match(/^\/api\/v1\/incidents\/([^/]+)\/ack$/);
      if (method === "POST" && acknowledgeMatch) {
        requireDashboard(request, dashboardToken);
        const incident = store.acknowledge(decodeIdentifier(acknowledgeMatch[1]));
        if (!incident) throw new HttpError(404, "Incident not found");
        broadcast();
        return sendJson(response, 200, incident);
      }

      const rotateMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/rotate$/);
      if (method === "POST" && rotateMatch) {
        requireDashboard(request, dashboardToken);
        const deviceId = decodeIdentifier(rotateMatch[1]);
        if (!isValidDeviceId(deviceId)) throw new HttpError(400, "Invalid deviceId");
        const rotated = agents.rotate(deviceId);
        if (!rotated) throw new HttpError(404, "Agent not found");
        store.recordAudit("dashboard", "agent.key-rotated", deviceId, { durable: agents.persistenceEnabled });
        return sendJson(response, 200, { deviceId, ...rotated, durable: agents.persistenceEnabled });
      }

      const agentMatch = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
      if (method === "DELETE" && agentMatch) {
        requireDashboard(request, dashboardToken);
        const deviceId = decodeIdentifier(agentMatch[1]);
        if (!isValidDeviceId(deviceId)) throw new HttpError(400, "Invalid deviceId");
        const credential = agents.list().find((item) => item.deviceId === deviceId);
        if (!agents.revoke(deviceId)) throw new HttpError(404, "Agent not found");
        const durable = credential?.source === "enrolled" && agents.persistenceEnabled;
        store.recordAudit("dashboard", "agent.revoked", deviceId, { durable });
        return sendJson(response, 200, {
          revoked: true,
          deviceId,
          durable,
          ...(durable ? {} : { warning: "Remove any matching static environment key before restart" }),
        });
      }

      throw new HttpError(404, "Route not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Internal server error";
      if (!response.headersSent) sendJson(response, status, { error: message });
      else response.end();
    }
  });

  const sweep = setInterval(() => { if (store.sweepStale().length > 0) broadcast(); }, 30_000);
  sweep.unref();
  server.on("close", () => {
    clearInterval(sweep);
    if (ownsPersistence) persistence?.close();
  });
  return { server, store, agents };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const host = process.env.OPSATLAS_HOST ?? "127.0.0.1";
  const port = Number(process.env.OPSATLAS_PORT ?? "4318");
  const dashboardToken = process.env.OPSATLAS_DASHBOARD_TOKEN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("OPSATLAS_PORT must be a valid TCP port");
  if (!isLoopback(host) && (!dashboardToken || dashboardToken.length < 24)) throw new Error("A dashboard token of at least 24 characters is required when binding beyond loopback");
  const { server } = createControlPlane({
    dashboardToken,
    databasePath: process.env.OPSATLAS_DATABASE_PATH ?? "./data/opsatlas.db",
    credentialSecret: process.env.OPSATLAS_CREDENTIAL_KEY,
  });
  server.listen(port, host, () => process.stdout.write(`OpsAtlas control plane listening on http://${host}:${port}\n`));
}
