import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { isValidDeviceId } from "../shared/protocol.js";
import type { SqlitePersistence } from "./persistence.js";

type AgentCredential = {
  key: string;
  createdAt: string;
  rotatedAt: string | null;
  source: "environment" | "enrolled";
};

type Enrollment = {
  deviceId: string;
  expiresAt: number;
};

export type AgentMetadata = {
  deviceId: string;
  createdAt: string;
  rotatedAt: string | null;
  source: AgentCredential["source"];
};

type RegistryOptions = {
  initialKeys?: Map<string, string>;
  persistence?: SqlitePersistence;
  credentialSecret?: string;
  now?: () => Date;
};

function encryptionKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error("OPSATLAS_CREDENTIAL_KEY must contain at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newAgentKey(): string {
  return `oa_${randomBytes(32).toString("base64url")}`;
}

export class AgentCredentialRegistry {
  private readonly credentials = new Map<string, AgentCredential>();
  private readonly enrollments = new Map<string, Enrollment>();
  private readonly persistence?: SqlitePersistence;
  private readonly key?: Buffer;
  private readonly now: () => Date;

  constructor(options: RegistryOptions = {}) {
    this.persistence = options.persistence;
    this.now = options.now ?? (() => new Date());
    if (options.credentialSecret) this.key = encryptionKey(options.credentialSecret);

    const loadedAt = this.now().toISOString();
    for (const [deviceId, key] of options.initialKeys ?? []) {
      this.credentials.set(deviceId, { key, createdAt: loadedAt, rotatedAt: null, source: "environment" });
    }

    if (this.persistence && this.key) {
      for (const row of this.persistence.loadCredentialRows()) {
        this.credentials.set(row.deviceId, {
          key: this.decrypt(row.deviceId, row.nonce, row.ciphertext, row.authTag),
          createdAt: row.createdAt,
          rotatedAt: row.rotatedAt,
          source: "enrolled",
        });
      }
    }
  }

  get persistenceEnabled(): boolean {
    return Boolean(this.persistence && this.key);
  }

  get(deviceId: string): string | undefined {
    return this.credentials.get(deviceId)?.key;
  }

  list(): AgentMetadata[] {
    return [...this.credentials.entries()]
      .map(([deviceId, credential]) => ({
        deviceId,
        createdAt: credential.createdAt,
        rotatedAt: credential.rotatedAt,
        source: credential.source,
      }))
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  }

  issueEnrollment(deviceId: string, ttlSeconds = 600): { token: string; expiresAt: string } {
    if (!isValidDeviceId(deviceId)) throw new Error("Invalid deviceId");
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) throw new Error("Enrollment TTL must be 60–3600 seconds");
    this.removeExpiredEnrollments();
    const token = `oae_${randomBytes(32).toString("base64url")}`;
    const expiresAt = this.now().getTime() + ttlSeconds * 1000;
    this.enrollments.set(tokenDigest(token), { deviceId, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  enroll(deviceId: string, token: string): { agentKey: string; createdAt: string } {
    if (!isValidDeviceId(deviceId) || typeof token !== "string" || token.length > 128) throw new Error("Invalid enrollment request");
    this.removeExpiredEnrollments();
    const digest = tokenDigest(token);
    const enrollment = this.enrollments.get(digest);
    if (!enrollment || enrollment.deviceId !== deviceId) throw new Error("Enrollment token is invalid or expired");
    this.enrollments.delete(digest);
    const createdAt = this.now().toISOString();
    const agentKey = newAgentKey();
    this.credentials.set(deviceId, { key: agentKey, createdAt, rotatedAt: null, source: "enrolled" });
    this.persist(deviceId);
    return { agentKey, createdAt };
  }

  rotate(deviceId: string): { agentKey: string; rotatedAt: string } | null {
    const existing = this.credentials.get(deviceId);
    if (!existing) return null;
    const rotatedAt = this.now().toISOString();
    const agentKey = newAgentKey();
    this.credentials.set(deviceId, { ...existing, key: agentKey, rotatedAt, source: "enrolled" });
    this.persist(deviceId);
    return { agentKey, rotatedAt };
  }

  revoke(deviceId: string): boolean {
    const removed = this.credentials.delete(deviceId);
    if (removed) this.persistence?.deleteCredential(deviceId);
    return removed;
  }

  private removeExpiredEnrollments(): void {
    const now = this.now().getTime();
    for (const [digest, enrollment] of this.enrollments) {
      if (enrollment.expiresAt <= now) this.enrollments.delete(digest);
    }
  }

  private persist(deviceId: string): void {
    if (!this.persistence || !this.key) return;
    const credential = this.credentials.get(deviceId);
    if (!credential) return;
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(deviceId));
    const ciphertext = Buffer.concat([cipher.update(credential.key, "utf8"), cipher.final()]);
    this.persistence.saveCredential({
      deviceId,
      nonce: nonce.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      createdAt: credential.createdAt,
      rotatedAt: credential.rotatedAt,
    });
  }

  private decrypt(deviceId: string, nonce: string, ciphertext: string, authTag: string): string {
    if (!this.key) throw new Error("Credential encryption key is unavailable");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(nonce, "base64"));
    decipher.setAAD(Buffer.from(deviceId));
    decipher.setAuthTag(Buffer.from(authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  }
}
