import assert from "node:assert/strict";
import test from "node:test";
import { createTelemetrySignature, parseTelemetryEnvelope, verifyTelemetrySignature } from "../../.opsatlas-build/services/shared/protocol.js";

const sample = {
  schemaVersion: 1,
  deviceId: "lab-linux-03",
  sentAt: "2026-08-17T03:00:00.000Z",
  sequence: 41,
  platform: "linux",
  architecture: "x64",
  metrics: { cpuUsedPercent: 24.5, memoryUsedPercent: 51.2, diskUsedPercent: 44.1, uptimeSeconds: 90210 },
  checks: [{ name: "public status", state: "up", latencyMs: 48 }],
};

test("accepts a fresh HMAC signature and rejects tampering", () => {
  const body = JSON.stringify(sample);
  const key = "test-key-long-enough-for-hmac-only";
  const now = Date.now();
  const timestamp = String(now);
  const signature = createTelemetrySignature(body, timestamp, key);
  assert.equal(verifyTelemetrySignature(body, timestamp, signature, key, now), true);
  assert.equal(verifyTelemetrySignature(`${body} `, timestamp, signature, key, now), false);
  assert.equal(verifyTelemetrySignature(body, timestamp, "0".repeat(64), key, now), false);
});

test("rejects signatures outside the permitted clock window", () => {
  const body = JSON.stringify(sample);
  const key = "test-key-long-enough-for-hmac-only";
  const now = Date.now();
  const timestamp = String(now - 301_000);
  const signature = createTelemetrySignature(body, timestamp, key);
  assert.equal(verifyTelemetrySignature(body, timestamp, signature, key, now), false);
});

test("parses bounded telemetry and rejects unbounded identifiers", () => {
  assert.deepEqual(parseTelemetryEnvelope(sample), sample);
  assert.throws(() => parseTelemetryEnvelope({ ...sample, deviceId: "../../bad-device" }), /deviceId/);
  assert.throws(() => parseTelemetryEnvelope({ ...sample, checks: Array.from({ length: 9 }, (_, index) => ({ name: `check ${index}`, state: "up" })) }), /checks list/);
});
