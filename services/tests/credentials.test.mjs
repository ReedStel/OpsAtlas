import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentCredentialRegistry } from "../../.opsatlas-build/services/control-plane/credentials.js";
import { SqlitePersistence } from "../../.opsatlas-build/services/control-plane/persistence.js";

test("enrollment tokens are one-time and encrypted credentials survive restart", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "opsatlas-credentials-"));
  const databasePath = join(directory, "opsatlas.db");
  const secret = "test-only-credential-encryption-key-32-plus";
  context.after(() => rm(directory, { recursive: true, force: true }));

  const firstPersistence = new SqlitePersistence(databasePath);
  const firstRegistry = new AgentCredentialRegistry({ persistence: firstPersistence, credentialSecret: secret });
  const enrollment = firstRegistry.issueEnrollment("enrolled-node-01", 120);
  const enrolled = firstRegistry.enroll("enrolled-node-01", enrollment.token);
  assert.match(enrolled.agentKey, /^oa_/);
  assert.throws(() => firstRegistry.enroll("enrolled-node-01", enrollment.token), /invalid or expired/);
  firstPersistence.close();

  const secondPersistence = new SqlitePersistence(databasePath);
  const secondRegistry = new AgentCredentialRegistry({ persistence: secondPersistence, credentialSecret: secret });
  assert.equal(secondRegistry.get("enrolled-node-01"), enrolled.agentKey);
  assert.equal(Object.hasOwn(secondRegistry.list()[0], "key"), false);
  const rotated = secondRegistry.rotate("enrolled-node-01");
  assert.ok(rotated);
  assert.notEqual(rotated.agentKey, enrolled.agentKey);
  secondPersistence.close();

  const finalPersistence = new SqlitePersistence(databasePath);
  const finalRegistry = new AgentCredentialRegistry({ persistence: finalPersistence, credentialSecret: secret });
  assert.equal(finalRegistry.get("enrolled-node-01"), rotated.agentKey);
  assert.equal(finalRegistry.revoke("enrolled-node-01"), true);
  assert.equal(finalRegistry.get("enrolled-node-01"), undefined);
  finalPersistence.close();
});
