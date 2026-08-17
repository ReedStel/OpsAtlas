import { chmod, mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createTelemetrySignature, isValidDeviceId, TELEMETRY_SCHEMA_VERSION, type CheckState, type TelemetryEnvelope } from "../shared/protocol.js";

export type AgentConfig = {
  deviceId: string;
  key?: string;
  enrollmentToken?: string;
  endpoint: string;
  intervalMs: number;
  diskPath: string;
  statePath: string;
  checks: Array<{ name: string; url: string; timeoutMs: number }>;
};

export type AgentState = {
  schemaVersion: 1;
  deviceId: string;
  nextSequence: number;
  agentKey?: string;
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
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Checks support only HTTP and HTTPS");
    const timeoutMs = check.timeoutMs === undefined ? 4000 : Number(check.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 15_000) throw new Error("Check timeout must be 250–15000 ms");
    return { name: check.name, url: url.toString(), timeoutMs };
  });
}

export function loadAgentConfig(): AgentConfig {
  const intervalMs = Number(process.env.OPSATLAS_INTERVAL_MS ?? "30000");
  if (!Number.isInteger(intervalMs) || intervalMs < 10_000 || intervalMs > 3_600_000) throw new Error("OPSATLAS_INTERVAL_MS must be 10000–3600000");
  const endpoint = new URL(process.env.OPSATLAS_ENDPOINT ?? "http://127.0.0.1:4318/api/v1/telemetry");
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("OPSATLAS_ENDPOINT must use HTTP or HTTPS");
  const deviceId = required("OPSATLAS_DEVICE_ID");
  if (!isValidDeviceId(deviceId)) throw new Error("OPSATLAS_DEVICE_ID must be 3–64 letters, numbers, dots, underscores, or hyphens");
  return {
    deviceId,
    key: process.env.OPSATLAS_AGENT_KEY?.trim() || undefined,
    enrollmentToken: process.env.OPSATLAS_ENROLLMENT_TOKEN?.trim() || undefined,
    endpoint: endpoint.toString(),
    intervalMs,
    diskPath: process.env.OPSATLAS_DISK_PATH ?? process.cwd(),
    statePath: resolve(process.env.OPSATLAS_STATE_PATH ?? ".opsatlas-agent-state.json"),
    checks: loadChecks(),
  };
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

export async function sendTelemetry(config: AgentConfig, key: string, telemetry: TelemetryEnvelope): Promise<void> {
  const body = JSON.stringify(telemetry);
  const timestamp = Date.now().toString();
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OpsAtlas-Device": config.deviceId, "X-OpsAtlas-Timestamp": timestamp, "X-OpsAtlas-Signature": createTelemetrySignature(body, timestamp, key) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Control plane rejected telemetry with status ${response.status}`);
}

export async function loadAgentState(config: AgentConfig): Promise<AgentState> {
  try {
    const decoded: unknown = JSON.parse(await readFile(config.statePath, "utf8"));
    if (typeof decoded !== "object" || decoded === null) throw new Error("state is not an object");
    const state = decoded as Partial<AgentState>;
    if (state.schemaVersion !== 1 || state.deviceId !== config.deviceId || !Number.isSafeInteger(state.nextSequence) || Number(state.nextSequence) < 0) throw new Error("state does not match this agent");
    if (state.agentKey !== undefined && (typeof state.agentKey !== "string" || state.agentKey.length < 24)) throw new Error("stored agent key is invalid");
    return state as AgentState;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw new Error(`Unable to read agent state: ${error instanceof Error ? error.message : "unknown error"}`);
    return { schemaVersion: 1, deviceId: config.deviceId, nextSequence: 0 };
  }
}

export async function saveAgentState(config: AgentConfig, state: AgentState): Promise<void> {
  await mkdir(dirname(config.statePath), { recursive: true, mode: 0o700 });
  const temporary = `${config.statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, config.statePath);
  await chmod(config.statePath, 0o600);
}

function enrollmentEndpoint(telemetryEndpoint: string): string {
  const url = new URL(telemetryEndpoint);
  url.pathname = "/api/v1/enroll";
  url.search = "";
  return url.toString();
}

export async function enrollAgent(config: AgentConfig, token: string): Promise<string> {
  const response = await fetch(enrollmentEndpoint(config.endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: config.deviceId, token }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Agent enrollment failed with status ${response.status}`);
  const decoded = await response.json() as { agentKey?: unknown };
  if (typeof decoded.agentKey !== "string" || decoded.agentKey.length < 24) throw new Error("Enrollment response did not contain a valid agent key");
  return decoded.agentKey;
}

async function resolveAgentKey(config: AgentConfig, state: AgentState): Promise<{ key: string; state: AgentState }> {
  if (config.key) return { key: config.key, state: { ...state, agentKey: undefined } };
  if (state.agentKey) return { key: state.agentKey, state };
  if (!config.enrollmentToken) throw new Error("Set OPSATLAS_AGENT_KEY, provide OPSATLAS_ENROLLMENT_TOKEN, or retain an enrolled state file");
  const agentKey = await enrollAgent(config, config.enrollmentToken);
  const enrolledState = { ...state, agentKey };
  await saveAgentState(config, enrolledState);
  return { key: agentKey, state: enrolledState };
}

export async function runAgent(config = loadAgentConfig()): Promise<never> {
  let state = await loadAgentState(config);
  const resolved = await resolveAgentKey(config, state);
  const key = resolved.key;
  state = resolved.state;

  for (;;) {
    const sequence = state.nextSequence;
    try {
      const telemetry = await collectTelemetry(config, sequence);
      state = { ...state, nextSequence: sequence + 1 };
      await saveAgentState(config, state);
      await sendTelemetry(config, key, telemetry);
      process.stdout.write(`${new Date().toISOString()} telemetry accepted\n`);
    } catch (error) {
      process.stderr.write(`${new Date().toISOString()} telemetry delivery failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    }
    await delay(config.intervalMs);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await runAgent();
