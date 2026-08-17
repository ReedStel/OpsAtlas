import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadAgentState, saveAgentState } from "../../.opsatlas-build/services/agent/agent.js";

test("agent sequence and enrolled key are stored atomically with private permissions", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "opsatlas-agent-state-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const config = {
    deviceId: "state-node-01",
    endpoint: "http://127.0.0.1:4318/api/v1/telemetry",
    intervalMs: 30_000,
    diskPath: directory,
    statePath: join(directory, "nested", "agent-state.json"),
    checks: [],
  };

  assert.deepEqual(await loadAgentState(config), { schemaVersion: 1, deviceId: config.deviceId, nextSequence: 0 });
  const state = { schemaVersion: 1, deviceId: config.deviceId, nextSequence: 42, agentKey: "oa_test-agent-key-long-enough-to-store" };
  await saveAgentState(config, state);
  assert.deepEqual(await loadAgentState(config), state);
  assert.equal((await stat(config.statePath)).mode & 0o777, 0o600);

  await assert.rejects(() => loadAgentState({ ...config, deviceId: "different-node" }), /does not match this agent/);
});
