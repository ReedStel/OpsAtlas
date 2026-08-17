import type { TelemetryEnvelope } from "../shared/protocol.js";

export type IncidentSeverity = "critical" | "high" | "medium";

export type IncidentCandidate = {
  rule: "disk-pressure" | "memory-saturation" | "cpu-saturation" | "service-unavailable" | "stale-heartbeat";
  fingerprint?: string;
  severity: IncidentSeverity;
  title: string;
  detail: string;
};

export function evaluateTelemetry(telemetry: TelemetryEnvelope): IncidentCandidate[] {
  const incidents: IncidentCandidate[] = [];
  const { metrics } = telemetry;

  if (metrics.diskUsedPercent >= 90) {
    incidents.push({ rule: "disk-pressure", severity: "critical", title: "Storage threshold crossed", detail: `Disk usage is ${metrics.diskUsedPercent.toFixed(1)}%.` });
  } else if (metrics.diskUsedPercent >= 82) {
    incidents.push({ rule: "disk-pressure", severity: "medium", title: "Storage pressure rising", detail: `Disk usage is ${metrics.diskUsedPercent.toFixed(1)}%.` });
  }

  if (metrics.memoryUsedPercent >= 92) {
    incidents.push({ rule: "memory-saturation", severity: "critical", title: "Memory saturation", detail: `Memory usage is ${metrics.memoryUsedPercent.toFixed(1)}%.` });
  }

  if (metrics.cpuUsedPercent >= 95) {
    incidents.push({ rule: "cpu-saturation", severity: "high", title: "Sustained CPU pressure", detail: `CPU usage is ${metrics.cpuUsedPercent.toFixed(1)}%.` });
  }

  for (const check of telemetry.checks) {
    const fingerprint = `service-unavailable:${check.name.toLowerCase()}`;
    if (check.state === "down") incidents.push({ rule: "service-unavailable", fingerprint, severity: "high", title: `${check.name} unavailable`, detail: "The configured health check did not complete successfully." });
    if (check.state === "degraded") incidents.push({ rule: "service-unavailable", fingerprint, severity: "medium", title: `${check.name} degraded`, detail: `The configured health check took ${check.latencyMs ?? "an unknown number of"} ms.` });
  }

  return incidents;
}

export function evaluateHeartbeat(lastSeenMs: number, now = Date.now(), staleAfterMs = 120_000): IncidentCandidate | null {
  if (now - lastSeenMs <= staleAfterMs) return null;
  return { rule: "stale-heartbeat", severity: "high", title: "Heartbeat cadence degraded", detail: `No valid telemetry was received for ${Math.round((now - lastSeenMs) / 1000)} seconds.` };
}
