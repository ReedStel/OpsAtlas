# HTTP API

Default base URL: `http://127.0.0.1:4318`

Dashboard routes use `Authorization: Bearer <OPSATLAS_DASHBOARD_TOKEN>`. If no
dashboard token is configured, they are accepted only from loopback. Responses
are JSON with `Cache-Control: no-store`.

## Health

### `GET /healthz`

No authentication. Returns the version, persistence mode, and whether enrolled
credentials are durably encrypted.

## Telemetry

### `POST /api/v1/telemetry`

Agent-authenticated. Required headers:

- `X-OpsAtlas-Device`: registered device ID
- `X-OpsAtlas-Timestamp`: Unix epoch in milliseconds
- `X-OpsAtlas-Signature`: lowercase or uppercase hex HMAC-SHA256 of
  `timestamp + "." + exact_request_body`

The JSON body is a schema-v1 telemetry envelope and must not exceed 64 KiB. A
successful request returns `202 Accepted`. Replayed or non-increasing sequences
return `409 Conflict`.

## Dashboard state

### `GET /api/v1/state`

Returns the generated timestamp, latest device records, active incidents,
resolved incident history, and recent audit events.

### `GET /api/v1/events`

Server-sent event stream. Emits `state` events and comment heartbeats. The client
must support an Authorization header; the built-in browser console polls the
state route because native `EventSource` cannot set that header.

### `POST /api/v1/incidents/:id/ack`

Acknowledges an active incident and records an audit event. Returns `404` if the
incident is no longer active.

## Enrollment and keys

### `POST /api/v1/enrollments`

Dashboard-authenticated. Body:

```json
{ "deviceId": "demo-node-01", "ttlSeconds": 600 }
```

TTL must be 60–3600 seconds. Returns a device-bound one-time token. The token is
sensitive and will not be returned again.

### `POST /api/v1/enroll`

No dashboard bearer token; the one-time token is the credential. Body:

```json
{ "deviceId": "demo-node-01", "token": "oae_example" }
```

Returns an agent key once and consumes the token.

### `GET /api/v1/agents`

Lists credential metadata without returning keys.

### `POST /api/v1/agents/:deviceId/rotate`

Immediately replaces the accepted key and returns the new key once.

### `DELETE /api/v1/agents/:deviceId`

Revokes a managed credential. Static credentials supplied through
`OPSATLAS_AGENT_KEYS` must also be removed from that environment configuration.

## CORS

Requests with an `Origin` header are rejected unless that exact origin appears
in comma-separated `OPSATLAS_ALLOWED_ORIGINS`. Preflight allows only the methods
and headers used by this API. CLI and agent requests normally have no browser
Origin header.
