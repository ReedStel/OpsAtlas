import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createTelemetrySignature } from "../../.opsatlas-build/services/shared/protocol.js";
import { createControlPlane } from "../../.opsatlas-build/services/control-plane/server.js";

test("control plane authenticates an agent and protects dashboard state", async (context) => {
  const deviceId = "lab-linux-03";
  const agentKey = "integration-key-long-enough-to-use";
  const dashboardToken = "dashboard-test-token";
  const { server } = createControlPlane({ agentKeys: new Map([[deviceId, agentKey]]), dashboardToken });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const payload = { schemaVersion: 1, deviceId, sentAt: new Date().toISOString(), sequence: 7, platform: "linux", architecture: "x64", metrics: { cpuUsedPercent: 24, memoryUsedPercent: 48, diskUsedPercent: 91, uptimeSeconds: 1200 }, checks: [] };
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = createTelemetrySignature(body, timestamp, agentKey);
  const accepted = await fetch(`${base}/api/v1/telemetry`, { method: "POST", headers: { "content-type": "application/json", "x-opsatlas-device": deviceId, "x-opsatlas-timestamp": timestamp, "x-opsatlas-signature": signature }, body });
  assert.equal(accepted.status, 202);
  const replayed = await fetch(`${base}/api/v1/telemetry`, { method: "POST", headers: { "content-type": "application/json", "x-opsatlas-device": deviceId, "x-opsatlas-timestamp": timestamp, "x-opsatlas-signature": signature }, body });
  assert.equal(replayed.status, 409);
  const anonymous = await fetch(`${base}/api/v1/state`);
  assert.equal(anonymous.status, 401);
  const state = await fetch(`${base}/api/v1/state`, { headers: { authorization: `Bearer ${dashboardToken}` } });
  assert.equal(state.status, 200);
  const snapshot = await state.json();
  assert.equal(snapshot.devices[0].deviceId, deviceId);
  assert.equal(snapshot.incidents[0].rule, "disk-pressure");
});

test("control plane rejects a body changed after signing", async (context) => {
  const deviceId = "lab-linux-03";
  const agentKey = "integration-key-long-enough-to-use";
  const { server } = createControlPlane({ agentKeys: new Map([[deviceId, agentKey]]) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const timestamp = String(Date.now());
  const body = JSON.stringify({ deviceId, changed: true });
  const signature = createTelemetrySignature(JSON.stringify({ deviceId, changed: false }), timestamp, agentKey);
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/telemetry`, { method: "POST", headers: { "x-opsatlas-device": deviceId, "x-opsatlas-timestamp": timestamp, "x-opsatlas-signature": signature }, body });
  assert.equal(response.status, 401);
});

test("dashboard can issue a one-time enrollment and rotate the resulting key", async (context) => {
  const deviceId = "enrollment-node-01";
  const dashboardToken = "dashboard-enrollment-test-token";
  const { server } = createControlPlane({ dashboardToken });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const authorization = { authorization: `Bearer ${dashboardToken}`, "content-type": "application/json" };

  const issued = await fetch(`${base}/api/v1/enrollments`, { method: "POST", headers: authorization, body: JSON.stringify({ deviceId, ttlSeconds: 120 }) });
  assert.equal(issued.status, 201);
  const enrollment = await issued.json();
  assert.match(enrollment.token, /^oae_/);

  const enrolled = await fetch(`${base}/api/v1/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId, token: enrollment.token }) });
  assert.equal(enrolled.status, 201);
  const credential = await enrolled.json();
  assert.match(credential.agentKey, /^oa_/);

  const reused = await fetch(`${base}/api/v1/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId, token: enrollment.token }) });
  assert.equal(reused.status, 401);

  const rotated = await fetch(`${base}/api/v1/agents/${deviceId}/rotate`, { method: "POST", headers: authorization });
  assert.equal(rotated.status, 200);
  const replacement = await rotated.json();
  assert.notEqual(replacement.agentKey, credential.agentKey);

  const payload = { schemaVersion: 1, deviceId, sentAt: new Date().toISOString(), sequence: 1, platform: "linux", architecture: "x64", metrics: { cpuUsedPercent: 20, memoryUsedPercent: 30, diskUsedPercent: 40, uptimeSeconds: 900 }, checks: [] };
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const oldSignature = createTelemetrySignature(body, timestamp, credential.agentKey);
  const rejected = await fetch(`${base}/api/v1/telemetry`, { method: "POST", headers: { "x-opsatlas-device": deviceId, "x-opsatlas-timestamp": timestamp, "x-opsatlas-signature": oldSignature }, body });
  assert.equal(rejected.status, 401);

  const newSignature = createTelemetrySignature(body, timestamp, replacement.agentKey);
  const accepted = await fetch(`${base}/api/v1/telemetry`, { method: "POST", headers: { "x-opsatlas-device": deviceId, "x-opsatlas-timestamp": timestamp, "x-opsatlas-signature": newSignature }, body });
  assert.equal(accepted.status, 202);
});
