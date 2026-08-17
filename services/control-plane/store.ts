import { randomUUID } from "node:crypto";
import type { TelemetryEnvelope } from "../shared/protocol.js";
import type { SqlitePersistence } from "./persistence.js";
import { evaluateHeartbeat, evaluateTelemetry, type IncidentCandidate, type IncidentSeverity } from "./rules.js";

export type DeviceRecord = {
  deviceId: string;
  lastSeen: string;
  state: "healthy" | "watch" | "critical";
  telemetry: TelemetryEnvelope;
};

export type IncidentRecord = Omit<IncidentCandidate, "fingerprint"> & {
  id: string;
  dedupeKey: string;
  deviceId: string;
  openedAt: string;
  updatedAt: string;
  acknowledged: boolean;
  status: "open" | "resolved";
  resolvedAt?: string;
};

export type AuditEventRecord = {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  target: string;
  detail: Record<string, string | number | boolean | null>;
};

type StoreOptions = {
  persistence?: SqlitePersistence;
  now?: () => Date;
};

function stateFor(incidents: IncidentRecord[] | IncidentCandidate[]): DeviceRecord["state"] {
  if (incidents.some((incident) => incident.severity === "critical")) return "critical";
  if (incidents.length > 0) return "watch";
  return "healthy";
}

function candidateKey(deviceId: string, candidate: IncidentCandidate): string {
  return `${deviceId}:${candidate.fingerprint ?? candidate.rule}`;
}

export class ControlPlaneStore {
  readonly devices = new Map<string, DeviceRecord>();
  readonly incidents = new Map<string, IncidentRecord>();
  readonly incidentHistory: IncidentRecord[] = [];
  readonly auditEvents: AuditEventRecord[] = [];
  private readonly activeByDedupeKey = new Map<string, string>();
  private readonly persistence?: SqlitePersistence;
  private readonly now: () => Date;

  constructor(options: StoreOptions = {}) {
    this.persistence = options.persistence;
    this.now = options.now ?? (() => new Date());
    for (const device of this.persistence?.loadDevices() ?? []) this.devices.set(device.deviceId, device);
    for (const incident of this.persistence?.loadIncidents("open") ?? []) {
      this.incidents.set(incident.id, incident);
      this.activeByDedupeKey.set(incident.dedupeKey, incident.id);
    }
    this.incidentHistory.push(...(this.persistence?.loadIncidents("resolved") ?? []));
    this.auditEvents.push(...(this.persistence?.loadAuditEvents() ?? []));
  }

  ingest(telemetry: TelemetryEnvelope, receivedAt = this.now()): { device: DeviceRecord; incidents: IncidentRecord[] } {
    const candidates = evaluateTelemetry(telemetry);
    const timestamp = receivedAt.toISOString();
    const currentKeys = new Set(candidates.map((candidate) => candidateKey(telemetry.deviceId, candidate)));

    for (const incident of this.forDevice(telemetry.deviceId)) {
      if (incident.rule !== "stale-heartbeat" && !currentKeys.has(incident.dedupeKey)) this.resolveIncident(incident, timestamp);
    }
    for (const candidate of candidates) this.upsertIncident(telemetry.deviceId, candidate, timestamp);

    const staleId = this.activeByDedupeKey.get(`${telemetry.deviceId}:stale-heartbeat`);
    if (staleId) {
      const stale = this.incidents.get(staleId);
      if (stale) this.resolveIncident(stale, timestamp);
    }

    const device: DeviceRecord = {
      deviceId: telemetry.deviceId,
      lastSeen: timestamp,
      state: stateFor(this.forDevice(telemetry.deviceId)),
      telemetry,
    };
    this.devices.set(telemetry.deviceId, device);
    this.persistence?.saveDevice(device);
    return { device, incidents: this.forDevice(telemetry.deviceId) };
  }

  sweepStale(now = this.now()): IncidentRecord[] {
    const changed: IncidentRecord[] = [];
    for (const device of this.devices.values()) {
      const candidate = evaluateHeartbeat(Date.parse(device.lastSeen), now.getTime());
      const dedupeKey = `${device.deviceId}:stale-heartbeat`;
      if (!candidate) {
        const activeId = this.activeByDedupeKey.get(dedupeKey);
        const incident = activeId ? this.incidents.get(activeId) : undefined;
        if (incident) {
          this.resolveIncident(incident, now.toISOString());
          device.state = stateFor(this.forDevice(device.deviceId));
          this.persistence?.saveDevice(device);
        }
      } else {
        const existed = this.activeByDedupeKey.has(dedupeKey);
        const incident = this.upsertIncident(device.deviceId, candidate, now.toISOString());
        device.state = stateFor(this.forDevice(device.deviceId));
        this.persistence?.saveDevice(device);
        if (!existed) changed.push(incident);
      }
    }
    return changed;
  }

  acknowledge(id: string, actor = "dashboard"): IncidentRecord | null {
    const incident = this.incidents.get(id);
    if (!incident) return null;
    if (!incident.acknowledged) {
      incident.acknowledged = true;
      incident.updatedAt = this.now().toISOString();
      this.persistence?.saveIncident(incident);
      this.recordAudit(actor, "incident.acknowledged", incident.id, { deviceId: incident.deviceId, rule: incident.rule });
    }
    return incident;
  }

  recordAudit(
    actor: string,
    action: string,
    target: string,
    detail: AuditEventRecord["detail"] = {},
    occurredAt = this.now(),
  ): AuditEventRecord {
    const event: AuditEventRecord = { id: randomUUID(), occurredAt: occurredAt.toISOString(), actor, action, target, detail };
    this.auditEvents.unshift(event);
    if (this.auditEvents.length > 250) this.auditEvents.length = 250;
    this.persistence?.saveAuditEvent(event);
    return event;
  }

  snapshot() {
    return {
      generatedAt: this.now().toISOString(),
      devices: [...this.devices.values()].sort((left, right) => left.deviceId.localeCompare(right.deviceId)),
      incidents: [...this.incidents.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      incidentHistory: this.incidentHistory.slice(0, 100),
      auditEvents: this.auditEvents.slice(0, 100),
    };
  }

  private forDevice(deviceId: string): IncidentRecord[] {
    return [...this.incidents.values()].filter((incident) => incident.deviceId === deviceId);
  }

  private upsertIncident(deviceId: string, candidate: IncidentCandidate, timestamp: string): IncidentRecord {
    const dedupeKey = candidateKey(deviceId, candidate);
    const existingId = this.activeByDedupeKey.get(dedupeKey);
    const existing = existingId ? this.incidents.get(existingId) : undefined;
    if (existing) {
      Object.assign(existing, {
        rule: candidate.rule,
        severity: candidate.severity,
        title: candidate.title,
        detail: candidate.detail,
        updatedAt: timestamp,
      });
      this.persistence?.saveIncident(existing);
      return existing;
    }

    const record: IncidentRecord = {
      id: randomUUID(),
      dedupeKey,
      deviceId,
      rule: candidate.rule,
      severity: candidate.severity,
      title: candidate.title,
      detail: candidate.detail,
      openedAt: timestamp,
      updatedAt: timestamp,
      acknowledged: false,
      status: "open",
    };
    this.incidents.set(record.id, record);
    this.activeByDedupeKey.set(dedupeKey, record.id);
    this.persistence?.saveIncident(record);
    this.recordAudit("system", "incident.opened", record.id, { deviceId, rule: record.rule, severity: record.severity }, new Date(timestamp));
    return record;
  }

  private resolveIncident(incident: IncidentRecord, timestamp: string): void {
    incident.status = "resolved";
    incident.resolvedAt = timestamp;
    incident.updatedAt = timestamp;
    this.incidents.delete(incident.id);
    this.activeByDedupeKey.delete(incident.dedupeKey);
    this.incidentHistory.unshift(incident);
    if (this.incidentHistory.length > 250) this.incidentHistory.length = 250;
    this.persistence?.saveIncident(incident);
    this.recordAudit("system", "incident.resolved", incident.id, { deviceId: incident.deviceId, rule: incident.rule }, new Date(timestamp));
  }
}

export function highestSeverity(incidents: IncidentRecord[]): IncidentSeverity | null {
  if (incidents.some((incident) => incident.severity === "critical")) return "critical";
  if (incidents.some((incident) => incident.severity === "high")) return "high";
  if (incidents.some((incident) => incident.severity === "medium")) return "medium";
  return null;
}
