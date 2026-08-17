#!/usr/bin/env node

const [command, deviceId, rawTtl] = process.argv.slice(2);
const base = (process.env.OPSATLAS_ENDPOINT ?? "http://127.0.0.1:4318").replace(/\/api\/v1\/telemetry\/?$/, "").replace(/\/$/, "");
const token = process.env.OPSATLAS_DASHBOARD_TOKEN?.trim();

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(`Usage:
  npm run admin -- agents
  npm run admin -- enrollment <device-id> [ttl-seconds]
  npm run admin -- rotate <device-id>
  npm run admin -- revoke <device-id>

Set OPSATLAS_DASHBOARD_TOKEN and optionally OPSATLAS_ENDPOINT first.
Enrollment and rotation output secrets once; store them securely.
`);
  process.exitCode = 1;
}

if (!token) {
  usage("OPSATLAS_DASHBOARD_TOKEN is required.");
} else {
  const routes = {
    agents: { method: "GET", path: "/api/v1/agents" },
    enrollment: { method: "POST", path: "/api/v1/enrollments", body: { deviceId, ttlSeconds: rawTtl === undefined ? 600 : Number(rawTtl) } },
    rotate: { method: "POST", path: `/api/v1/agents/${encodeURIComponent(deviceId ?? "")}/rotate` },
    revoke: { method: "DELETE", path: `/api/v1/agents/${encodeURIComponent(deviceId ?? "")}` },
  };
  const operation = routes[command];
  if (!operation || (command !== "agents" && !deviceId)) {
    usage("Unknown command or missing device ID.");
  } else {
    const response = await fetch(`${base}${operation.path}`, {
      method: operation.method,
      headers: { Authorization: `Bearer ${token}`, ...(operation.body ? { "Content-Type": "application/json" } : {}) },
      ...(operation.body ? { body: JSON.stringify(operation.body) } : {}),
    });
    const result = await response.json().catch(() => ({ error: "Response was not JSON" }));
    if (!response.ok) {
      process.stderr.write(`OpsAtlas returned HTTP ${response.status}: ${result.error ?? "request failed"}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  }
}
