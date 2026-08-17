import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuditEventRecord, DeviceRecord, IncidentRecord } from "./store.js";

type CredentialRow = {
  deviceId: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
  createdAt: string;
  rotatedAt: string | null;
};

type SqlRow = Record<string, string | number | null>;

function databaseLocation(location: string): string {
  if (location === ":memory:") return location;
  const absolute = resolve(location);
  mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  return absolute;
}

function parseJson<T>(value: unknown): T {
  if (typeof value !== "string") throw new Error("Persisted JSON value is invalid");
  return JSON.parse(value) as T;
}

export class SqlitePersistence {
  readonly database: DatabaseSync;

  constructor(readonly location: string) {
    const resolvedLocation = databaseLocation(location);
    this.database = new DatabaseSync(resolvedLocation);
    if (resolvedLocation !== ":memory:") chmodSync(resolvedLocation, 0o600);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;");
    if (location !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        last_seen TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('healthy', 'watch', 'critical')),
        telemetry_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL,
        device_id TEXT NOT NULL,
        rule TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium')),
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        acknowledged INTEGER NOT NULL CHECK (acknowledged IN (0, 1)),
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
        resolved_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS active_incident_dedupe
        ON incidents(dedupe_key) WHERE status = 'open';
      CREATE INDEX IF NOT EXISTS incident_history_order
        ON incidents(updated_at DESC);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        detail_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS audit_order ON audit_events(occurred_at DESC);

      CREATE TABLE IF NOT EXISTS agent_credentials (
        device_id TEXT PRIMARY KEY,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        rotated_at TEXT
      ) STRICT;
    `);
  }

  loadDevices(): DeviceRecord[] {
    const rows = this.database.prepare("SELECT device_id, last_seen, state, telemetry_json FROM devices ORDER BY device_id").all() as SqlRow[];
    return rows.map((row) => ({
      deviceId: String(row.device_id),
      lastSeen: String(row.last_seen),
      state: String(row.state) as DeviceRecord["state"],
      telemetry: parseJson<DeviceRecord["telemetry"]>(row.telemetry_json),
    }));
  }

  loadIncidents(status: IncidentRecord["status"]): IncidentRecord[] {
    const rows = this.database.prepare(`
      SELECT id, dedupe_key, device_id, rule, severity, title, detail, opened_at,
             updated_at, acknowledged, status, resolved_at
      FROM incidents WHERE status = ? ORDER BY updated_at DESC LIMIT 250
    `).all(status) as SqlRow[];
    return rows.map((row) => ({
      id: String(row.id),
      dedupeKey: String(row.dedupe_key),
      deviceId: String(row.device_id),
      rule: String(row.rule) as IncidentRecord["rule"],
      severity: String(row.severity) as IncidentRecord["severity"],
      title: String(row.title),
      detail: String(row.detail),
      openedAt: String(row.opened_at),
      updatedAt: String(row.updated_at),
      acknowledged: Number(row.acknowledged) === 1,
      status: String(row.status) as IncidentRecord["status"],
      ...(row.resolved_at ? { resolvedAt: String(row.resolved_at) } : {}),
    }));
  }

  loadAuditEvents(): AuditEventRecord[] {
    const rows = this.database.prepare(`
      SELECT id, occurred_at, actor, action, target, detail_json
      FROM audit_events ORDER BY occurred_at DESC LIMIT 250
    `).all() as SqlRow[];
    return rows.map((row) => ({
      id: String(row.id),
      occurredAt: String(row.occurred_at),
      actor: String(row.actor),
      action: String(row.action),
      target: String(row.target),
      detail: parseJson<Record<string, string | number | boolean | null>>(row.detail_json),
    }));
  }

  saveDevice(device: DeviceRecord): void {
    this.database.prepare(`
      INSERT INTO devices(device_id, last_seen, state, telemetry_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        state = excluded.state,
        telemetry_json = excluded.telemetry_json
    `).run(device.deviceId, device.lastSeen, device.state, JSON.stringify(device.telemetry));
  }

  saveIncident(incident: IncidentRecord): void {
    this.database.prepare(`
      INSERT INTO incidents(
        id, dedupe_key, device_id, rule, severity, title, detail, opened_at,
        updated_at, acknowledged, status, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        severity = excluded.severity,
        title = excluded.title,
        detail = excluded.detail,
        updated_at = excluded.updated_at,
        acknowledged = excluded.acknowledged,
        status = excluded.status,
        resolved_at = excluded.resolved_at
    `).run(
      incident.id,
      incident.dedupeKey,
      incident.deviceId,
      incident.rule,
      incident.severity,
      incident.title,
      incident.detail,
      incident.openedAt,
      incident.updatedAt,
      incident.acknowledged ? 1 : 0,
      incident.status,
      incident.resolvedAt ?? null,
    );
  }

  saveAuditEvent(event: AuditEventRecord): void {
    this.database.prepare(`
      INSERT INTO audit_events(id, occurred_at, actor, action, target, detail_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.id, event.occurredAt, event.actor, event.action, event.target, JSON.stringify(event.detail));
  }

  loadCredentialRows(): CredentialRow[] {
    const rows = this.database.prepare(`
      SELECT device_id, nonce, ciphertext, auth_tag, created_at, rotated_at
      FROM agent_credentials ORDER BY device_id
    `).all() as SqlRow[];
    return rows.map((row) => ({
      deviceId: String(row.device_id),
      nonce: String(row.nonce),
      ciphertext: String(row.ciphertext),
      authTag: String(row.auth_tag),
      createdAt: String(row.created_at),
      rotatedAt: row.rotated_at ? String(row.rotated_at) : null,
    }));
  }

  saveCredential(row: CredentialRow): void {
    this.database.prepare(`
      INSERT INTO agent_credentials(device_id, nonce, ciphertext, auth_tag, created_at, rotated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        nonce = excluded.nonce,
        ciphertext = excluded.ciphertext,
        auth_tag = excluded.auth_tag,
        rotated_at = excluded.rotated_at
    `).run(row.deviceId, row.nonce, row.ciphertext, row.authTag, row.createdAt, row.rotatedAt);
  }

  deleteCredential(deviceId: string): void {
    this.database.prepare("DELETE FROM agent_credentials WHERE device_id = ?").run(deviceId);
  }

  close(): void {
    this.database.close();
  }
}
