import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHeartbeat, evaluateTelemetry } from "../../.opsatlas-build/services/control-plane/rules.js";
import { ControlPlaneStore } from "../../.opsatlas-build/services/control-plane/store.js";

function telemetry(overrides = {}) {
  return {
    schemaVersion: 1,
    deviceId: "field-win-07",
    sentAt: new Date().toISOString(),
    sequence: 1,
    platform: "win32",
    architecture: "x64",
    metrics: { cpuUsedPercent: 31, memoryUsedPercent: 48, diskUsedPercent: 40, uptimeSeconds: 7000, ...overrides },
    checks: [],
  };
}

test("raises deterministic incidents at documented thresholds", () => {
  const incidents = evaluateTelemetry(telemetry({ diskUsedPercent: 94, memoryUsedPercent: 93 }));
  assert.deepEqual(incidents.map((item) => item.rule), ["disk-pressure", "memory-saturation"]);
  assert.ok(incidents.every((item) => item.severity === "critical"));
});

test("marks late heartbeats but permits the boundary", () => {
  const now = Date.now();
  assert.equal(evaluateHeartbeat(now - 120_000, now), null);
  assert.equal(evaluateHeartbeat(now - 120_001, now)?.rule, "stale-heartbeat");
});

test("resolves an incident when the next sample is healthy", () => {
  const store = new ControlPlaneStore();
  store.ingest(telemetry({ diskUsedPercent: 94 }));
  assert.equal(store.snapshot().incidents.length, 1);
  store.ingest(telemetry({ diskUsedPercent: 40 }));
  assert.equal(store.snapshot().incidents.length, 0);
});
