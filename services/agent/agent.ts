import { statfs } from "node:fs/promises";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createTelemetrySignature, TELEMETRY_SCHEMA_VERSION, type CheckState, type TelemetryEnvelope } from "../shared/protocol.js";

type AgentConfig = {
  deviceId: string;
  key: string;
  endpoint: string;
  intervalMs: number;
  diskPath: string;
  checks: Array<{ name: string; url: string; timeoutMs: number }>;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadChecks(raw = process.env.OPSATLAS_CHECKS): AgentConfig["checks"] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 8) throw new Error("OPSATLAS_CHECKS must be an array with at most eight entries");
  return value.map((item) => {
    if (typeof item !== "object" || item === null) throw new Error("Invalid check configuration");
    const check = item as Record<string, unknown>;
    if (typeof check.name !== "string" || !/^[a-z0-9][a-z0-9 ._-]{0,47}$/i.test(check.name)) throw new Error("Invalid check name");
    if (typeof check.url !== "string") throw new Error("Invalid check URL");
    const url = new URL(check.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Checks support only HTTP and HTTPS");
    const timeoutMs = check.timeoutMs === undefined ? 4000 : Number(check.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 15_000) throw new Error("Check timeout must be 250–15000 ms");
    return { name: check.name, url: url.toString(), timeoutMs };
  });
}

export function loadAgentConfig(): AgentConfig {
  const intervalMs = Number(process.env.OPSATLAS_INTERVAL_MS ?? "30000");
  if (!Number.isInteger(intervalMs) || intervalMs < 10_000 || intervalMs > 3_600_000) throw new Error("OPSATLAS_INTERVAL_MS must be 10000–3600000");
  const endpoint = new URL(process.env.OPSATLAS_ENDPOINT ?? "http://127.0.0.1:4318/api/v1/telemetry");
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error("OPSATLAS_ENDPOINT must use HTTP or HTTPS");
  return { deviceId: required("OPSATLAS_DEVICE_ID"), key: required("OPSATLAS_AGENT_KEY"), endpoint: endpoint.toString(), intervalMs, diskPath: process.env.OPSATLAS_DISK_PATH ?? process.cwd(), checks: loadChecks() };
}

type CpuSample = { idle: number; total: number };
function cpuSample(): CpuSample {
  return os.cpus().reduce((sum, cpu) => {
    const total = Object.values(cpu.times).reduce((value, time) => value + time, 0);
    return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
  }, { idle: 0, total: 0 });
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function cpuUsedPercent(): Promise<number> {
  const before = cpuSample();
  await delay(180);
  const after = cpuSample();
  const total = Math.max(1, after.total - before.total);
  return Number((100 - ((after.idle - before.idle) / total) * 100).toFixed(1));
}

async function diskUsedPercent(path: string): Promise<number> {
  const stats = await statfs(path);
  const total = stats.blocks * stats.bsize;
  const available = stats.bavail * stats.bsize;
  return total <= 0 ? 0 : Number((((total - available) / total) * 100).toFixed(1));
}

async function runCheck(check: AgentConfig["checks"][number]): Promise<TelemetryEnvelope["checks"][number]> {
  const startedAt = performance.now();
  let state: CheckState = "down";
  try {
    const response = await fetch(check.url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(check.timeoutMs) });
    const latencyMs = Math.round(performance.now() - startedAt);
    state = response.status < 500 ? (latencyMs > Math.min(2500, check.timeoutMs * 0.75) ? "degraded" : "up") : "down";
    return { name: check.name, state, latencyMs };
  } catch {
    return { name: check.name, state, latencyMs: Math.round(performance.now() - startedAt) };
  }
}

function platform(): TelemetryEnvelope["platform"] {
  const value = os.platform();
  return value === "linux" || value === "win32" || value === "darwin" ? value : "other";
}

export async function collectTelemetry(config: AgentConfig, sequence: number): Promise<TelemetryEnvelope> {
  const [cpu, disk, checks] = await Promise.all([cpuUsedPercent(), diskUsedPercent(config.diskPath), Promise.all(config.checks.map(runCheck))]);
  const usedMemory = os.totalmem() - os.freemem();
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    deviceId: config.deviceId,
    sentAt: new Date().toISOString(),
    sequence,
    platform: platform(),
    architecture: os.arch(),
    metrics: { cpuUsedPercent: cpu, memoryUsedPercent: Number(((usedMemory / os.totalmem()) * 100).toFixed(1)), diskUsedPercent: disk, uptimeSeconds: Math.round(os.uptime()) },
    checks,
  };
}

export async function sendTelemetry(config: AgentConfig, telemetry: TelemetryEnvelope): Promise<void> {
  const body = JSON.stringify(telemetry);
  const timestamp = Date.now().toString();
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OpsAtlas-Device": config.deviceId, "X-OpsAtlas-Timestamp": timestamp, "X-OpsAtlas-Signature": createTelemetrySignature(body, timestamp, config.key) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Control plane rejected telemetry with status ${response.status}`);
}

export async function runAgent(config = loadAgentConfig()): Promise<never> {
  let sequence = 0;
  for (;;) {
    try { await sendTelemetry(config, await collectTelemetry(config, sequence++)); process.stdout.write(`${new Date().toISOString()} telemetry accepted\n`); }
    catch (error) { process.stderr.write(`${new Date().toISOString()} telemetry delivery failed: ${error instanceof Error ? error.message : "unknown error"}\n`); }
    await delay(config.intervalMs);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await runAgent();
