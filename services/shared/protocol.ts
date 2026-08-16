import { createHmac, timingSafeEqual } from "node:crypto";

export const TELEMETRY_SCHEMA_VERSION = 1 as const;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const MAX_TELEMETRY_BYTES = 64 * 1024;

export type CheckState = "up" | "down" | "degraded";

export type TelemetryEnvelope = {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  deviceId: string;
  sentAt: string;
  sequence: number;
  platform: "linux" | "win32" | "darwin" | "other";
  architecture: string;
  metrics: {
    cpuUsedPercent: number;
    memoryUsedPercent: number;
    diskUsedPercent: number;
    uptimeSeconds: number;
  };
  checks: Array<{
    name: string;
    state: CheckState;
    latencyMs?: number;
  }>;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

export function createTelemetrySignature(body: string | Buffer, timestamp: string, key: string): string {
  if (!timestamp || !key) throw new Error("A timestamp and signing key are required");
  return createHmac("sha256", key).update(timestamp).update(".").update(body).digest("hex");
}

export function verifyTelemetrySignature(
  body: string | Buffer,
  timestamp: string,
  signature: string,
  key: string,
  now = Date.now(),
  maxClockSkewMs = MAX_CLOCK_SKEW_MS,
): boolean {
  const signedAt = Number(timestamp);
  if (!Number.isInteger(signedAt) || Math.abs(now - signedAt) > maxClockSkewMs) return false;
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;

  const expected = Buffer.from(createTelemetrySignature(body, timestamp, key), "hex");
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseTelemetryEnvelope(value: unknown): TelemetryEnvelope {
  if (!isRecord(value)) throw new Error("Telemetry must be a JSON object");
  if (value.schemaVersion !== TELEMETRY_SCHEMA_VERSION) throw new Error("Unsupported telemetry schema");
  if (!isShortString(value.deviceId, 64) || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(value.deviceId)) throw new Error("Invalid deviceId");
  if (!isShortString(value.sentAt, 40) || !Number.isFinite(Date.parse(value.sentAt))) throw new Error("Invalid sentAt timestamp");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) throw new Error("Invalid sequence");
  if (!["linux", "win32", "darwin", "other"].includes(String(value.platform))) throw new Error("Invalid platform");
  if (!isShortString(value.architecture, 24) || !/^[a-z0-9_-]+$/i.test(value.architecture)) throw new Error("Invalid architecture");
  if (!isRecord(value.metrics)) throw new Error("Missing metrics");

  const metrics = value.metrics;
  if (!isFiniteNumber(metrics.cpuUsedPercent, 0, 100)) throw new Error("Invalid CPU metric");
  if (!isFiniteNumber(metrics.memoryUsedPercent, 0, 100)) throw new Error("Invalid memory metric");
  if (!isFiniteNumber(metrics.diskUsedPercent, 0, 100)) throw new Error("Invalid disk metric");
  if (!isFiniteNumber(metrics.uptimeSeconds, 0, Number.MAX_SAFE_INTEGER)) throw new Error("Invalid uptime metric");
  if (!Array.isArray(value.checks) || value.checks.length > 8) throw new Error("Invalid checks list");

  const checks = value.checks.map((item) => {
    if (!isRecord(item) || !isShortString(item.name, 48) || !/^[a-z0-9][a-z0-9 ._-]*$/i.test(item.name)) throw new Error("Invalid check name");
    if (!["up", "down", "degraded"].includes(String(item.state))) throw new Error("Invalid check state");
    if (item.latencyMs !== undefined && !isFiniteNumber(item.latencyMs, 0, 120_000)) throw new Error("Invalid check latency");
    return { name: item.name, state: item.state, ...(item.latencyMs === undefined ? {} : { latencyMs: item.latencyMs }) } as TelemetryEnvelope["checks"][number];
  });

  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    deviceId: value.deviceId,
    sentAt: value.sentAt,
    sequence: value.sequence as number,
    platform: value.platform as TelemetryEnvelope["platform"],
    architecture: value.architecture,
    metrics: {
      cpuUsedPercent: metrics.cpuUsedPercent,
      memoryUsedPercent: metrics.memoryUsedPercent,
      diskUsedPercent: metrics.diskUsedPercent,
      uptimeSeconds: metrics.uptimeSeconds,
    },
    checks,
  };
}
