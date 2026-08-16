import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { MAX_TELEMETRY_BYTES, parseTelemetryEnvelope, verifyTelemetrySignature } from "../shared/protocol.js";
import { ControlPlaneStore } from "./store.js";

type ServerOptions = {
  store?: ControlPlaneStore;
  agentKeys?: Map<string, string>;
  dashboardToken?: string;
  allowedOrigins?: Set<string>;
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function loadAgentKeys(raw = process.env.OPSATLAS_AGENT_KEYS): Map<string, string> {
  if (!raw) return new Map();
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("OPSATLAS_AGENT_KEYS must be a JSON object");
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([deviceId, key]) => !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(deviceId) || typeof key !== "string" || key.length < 24)) throw new Error("OPSATLAS_AGENT_KEYS contains an invalid device or short key");
  return new Map(entries as Array<[string, string]>);
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_TELEMETRY_BYTES) throw new HttpError(413, "Telemetry payload is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function dashboardAuthorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) return isLoopback(request.socket.remoteAddress);
  return header(request, "authorization") === `Bearer ${token}`;
}

function applySecurityHeaders(response: ServerResponse) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

export function createControlPlane(options: ServerOptions = {}) {
  const store = options.store ?? new ControlPlaneStore();
  const agentKeys = options.agentKeys ?? loadAgentKeys();
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
        response.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-OpsAtlas-Device, X-OpsAtlas-Timestamp, X-OpsAtlas-Signature", "Access-Control-Max-Age": "600" });
        return response.end();
      }

      if (method === "GET" && url.pathname === "/healthz") return sendJson(response, 200, { status: "ok" });

      if (method === "POST" && url.pathname === "/api/v1/telemetry") {
        const deviceId = header(request, "x-opsatlas-device");
        const timestamp = header(request, "x-opsatlas-timestamp");
        const signature = header(request, "x-opsatlas-signature");
        const key = agentKeys.get(deviceId);
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

      if (method === "GET" && url.pathname === "/api/v1/state") {
        if (!dashboardAuthorized(request, dashboardToken)) throw new HttpError(401, "Dashboard authorization required");
        return sendJson(response, 200, store.snapshot());
      }

      if (method === "GET" && url.pathname === "/api/v1/events") {
        if (!dashboardAuthorized(request, dashboardToken)) throw new HttpError(401, "Dashboard authorization required");
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        response.write(`event: state\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 25_000);
        subscribers.add(response);
        request.on("close", () => { clearInterval(heartbeat); subscribers.delete(response); });
        return;
      }

      const acknowledgeMatch = url.pathname.match(/^\/api\/v1\/incidents\/([^/]+)\/ack$/);
      if (method === "POST" && acknowledgeMatch) {
        if (!dashboardAuthorized(request, dashboardToken)) throw new HttpError(401, "Dashboard authorization required");
        const incident = store.acknowledge(decodeURIComponent(acknowledgeMatch[1]));
        if (!incident) throw new HttpError(404, "Incident not found");
        broadcast();
        return sendJson(response, 200, incident);
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
  server.on("close", () => clearInterval(sweep));
  return { server, store };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const host = process.env.OPSATLAS_HOST ?? "127.0.0.1";
  const port = Number(process.env.OPSATLAS_PORT ?? "4318");
  const { server } = createControlPlane();
  server.listen(port, host, () => process.stdout.write(`OpsAtlas control plane listening on http://${host}:${port}\n`));
}
