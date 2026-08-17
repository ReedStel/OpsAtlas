import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqlitePersistence } from "../../.opsatlas-build/services/control-plane/persistence.js";
import { ControlPlaneStore } from "../../.opsatlas-build/services/control-plane/store.js";

function telemetry(sequence, diskUsedPercent) {
  return {
    schemaVersion: 1,
    deviceId: "persistence-node-01",
    sentAt: new Date().toISOString(),
    sequence,
    platform: "linux",
    architecture: "x64",
    metrics: { cpuUsedPercent: 22, memoryUsedPercent: 41, diskUsedPercent, uptimeSeconds: 8400 },
    checks: [],
  };
}

test("persists fleet state, incident lifecycle, and audit history across restarts", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "opsatlas-persistence-"));
  const databasePath = join(directory, "opsatlas.db");
  context.after(() => rm(directory, { recursive: true, force: true }));

  let now = new Date("2026-08-18T01:00:00.000Z");
  const firstPersistence = new SqlitePersistence(databasePath);
  const firstStore = new ControlPlaneStore({ persistence: firstPersistence, now: () => now });
  firstStore.ingest(telemetry(1, 96), now);
  const incidentId = firstStore.snapshot().incidents[0].id;
  firstStore.acknowledge(incidentId, "test-operator");
  firstPersistence.close();

  const secondPersistence = new SqlitePersistence(databasePath);
  const secondStore = new ControlPlaneStore({ persistence: secondPersistence, now: () => now });
  assert.equal(secondStore.snapshot().devices[0].deviceId, "persistence-node-01");
  assert.equal(secondStore.snapshot().incidents[0].acknowledged, true);
  assert.ok(secondStore.snapshot().auditEvents.some((event) => event.action === "incident.acknowledged"));

  now = new Date("2026-08-18T01:01:00.000Z");
  secondStore.ingest(telemetry(2, 40), now);
  secondPersistence.close();

  const finalPersistence = new SqlitePersistence(databasePath);
  const finalSnapshot = new ControlPlaneStore({ persistence: finalPersistence, now: () => now }).snapshot();
  assert.equal(finalSnapshot.incidents.length, 0);
  assert.equal(finalSnapshot.incidentHistory[0].status, "resolved");
  assert.ok(finalSnapshot.auditEvents.some((event) => event.action === "incident.resolved"));
  finalPersistence.close();
});
