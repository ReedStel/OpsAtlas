import type { TelemetryEnvelope } from "../shared/protocol.js";
import { evaluateHeartbeat, evaluateTelemetry, type IncidentCandidate, type IncidentSeverity } from "./rules.js";

export type DeviceRecord = {
  deviceId: string;
  lastSeen: string;
  state: "healthy" | "watch" | "critical";
  telemetry: TelemetryEnvelope;
};

export type IncidentRecord = IncidentCandidate & {
  id: string;
  deviceId: string;
  openedAt: string;
  updatedAt: string;
  acknowledged: boolean;
};

function stateFor(incidents: IncidentCandidate[]): DeviceRecord["state"] {
  if (incidents.some((incident) => incident.severity === "critical")) return "critical";
  if (incidents.length > 0) return "watch";
  return "healthy";
}

export class ControlPlaneStore {
  readonly devices = new Map<string, DeviceRecord>();
  readonly incidents = new Map<string, IncidentRecord>();

  ingest(telemetry: TelemetryEnvelope, receivedAt = new Date()): { device: DeviceRecord; incidents: IncidentRecord[] } {
    const candidates = evaluateTelemetry(telemetry);
    const timestamp = receivedAt.toISOString();
    const device: DeviceRecord = { deviceId: telemetry.deviceId, lastSeen: timestamp, state: stateFor(candidates), telemetry };
    this.devices.set(telemetry.deviceId, device);

    const activeRules = new Set(candidates.map((candidate) => candidate.rule));
    for (const [id, incident] of this.incidents) {
      if (incident.deviceId === telemetry.deviceId && incident.rule !== "stale-heartbeat" && !activeRules.has(incident.rule)) this.incidents.delete(id);
    }

    for (const candidate of candidates) this.upsertIncident(telemetry.deviceId, candidate, timestamp);
    this.incidents.delete(`${telemetry.deviceId}:stale-heartbeat`);
    return { device, incidents: this.forDevice(telemetry.deviceId) };
  }

  sweepStale(now = new Date()): IncidentRecord[] {
    const changed: IncidentRecord[] = [];
    for (const device of this.devices.values()) {
      const candidate = evaluateHeartbeat(Date.parse(device.lastSeen), now.getTime());
      if (!candidate) continue;
      device.state = "watch";
      changed.push(this.upsertIncident(device.deviceId, candidate, now.toISOString()));
    }
    return changed;
  }

  acknowledge(id: string): IncidentRecord | null {
    const incident = this.incidents.get(id);
    if (!incident) return null;
    incident.acknowledged = true;
    incident.updatedAt = new Date().toISOString();
    return incident;
  }

  snapshot() {
    return { generatedAt: new Date().toISOString(), devices: [...this.devices.values()], incidents: [...this.incidents.values()] };
  }

  private forDevice(deviceId: string): IncidentRecord[] {
    return [...this.incidents.values()].filter((incident) => incident.deviceId === deviceId);
  }

  private upsertIncident(deviceId: string, candidate: IncidentCandidate, timestamp: string): IncidentRecord {
    const id = `${deviceId}:${candidate.rule}`;
    const existing = this.incidents.get(id);
    const record: IncidentRecord = existing
      ? { ...existing, ...candidate, updatedAt: timestamp }
      : { ...candidate, id, deviceId, openedAt: timestamp, updatedAt: timestamp, acknowledged: false };
    this.incidents.set(id, record);
    return record;
  }
}

export function highestSeverity(incidents: IncidentRecord[]): IncidentSeverity | null {
  if (incidents.some((incident) => incident.severity === "critical")) return "critical";
  if (incidents.some((incident) => incident.severity === "high")) return "high";
  if (incidents.some((incident) => incident.severity === "medium")) return "medium";
  return null;
}
