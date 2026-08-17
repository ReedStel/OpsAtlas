# Quick start

This guide creates a completely fictional local lab. Do not substitute real
workplace names, hosts, checks, credentials, or telemetry in a public fork.

## Requirements

- Node.js 22.13 or newer
- npm
- optional: Docker Compose v2

## 1. Install and verify

```bash
npm ci
npm run check
```

## 2. Configure the control plane

Use separate random values for the dashboard bearer token and credential
encryption secret. The examples below intentionally do not contain usable
secrets.

```bash
export OPSATLAS_HOST=127.0.0.1
export OPSATLAS_PORT=4318
export OPSATLAS_DATABASE_PATH=./data/opsatlas.db
export OPSATLAS_ALLOWED_ORIGINS=http://127.0.0.1:5173
export OPSATLAS_DASHBOARD_TOKEN='<generate at least 24 random characters>'
export OPSATLAS_CREDENTIAL_KEY='<generate at least 32 different random characters>'
```

Build and start it:

```bash
npm run build:services
npm run start:control
```

`GET /healthz` is unauthenticated and reports whether SQLite and durable
encrypted credentials are active. All operational state and admin routes
require the dashboard token (except on loopback when no token is configured).

## 3. Enroll an agent

In a second shell, export the same dashboard token and request a token tied to a
fictional device ID:

```bash
export OPSATLAS_DASHBOARD_TOKEN='<same dashboard token>'
npm run admin -- enrollment demo-node-01 600
```

The returned `oae_...` value expires after ten minutes and works once. Configure
the agent without putting it in a tracked file:

```bash
export OPSATLAS_DEVICE_ID=demo-node-01
export OPSATLAS_ENROLLMENT_TOKEN='<returned one-time token>'
export OPSATLAS_ENDPOINT=http://127.0.0.1:4318/api/v1/telemetry
export OPSATLAS_STATE_PATH=./data/demo-node-01-state.json
export OPSATLAS_DISK_PATH=.
export OPSATLAS_CHECKS='[]'
npm run start:agent
```

On first start the agent exchanges the token for an agent key and saves it to
the state file with `0600` permissions. Later starts can omit the enrollment
token while retaining that file.

## 4. Connect the console

Start the console in a third shell:

```bash
npm run dev
```

Open the Vite URL, select `DEMO DATA`, enter
`http://127.0.0.1:4318` and the dashboard token, then select `Connect live`.
The origin printed by Vite must appear exactly in `OPSATLAS_ALLOWED_ORIGINS`.

## Docker Compose

`compose.example.yml` runs a control plane and one agent with read-only root
filesystems and named volumes for the SQLite database and agent state.

```bash
export OPSATLAS_DASHBOARD_TOKEN='<random value>'
export OPSATLAS_CREDENTIAL_KEY='<different random value>'
export OPSATLAS_DEVICE_ID=demo-node-01
export OPSATLAS_ENROLLMENT_TOKEN='<one-time token from a running control plane>'
docker compose -f compose.example.yml up --build
```

The enrollment token must be issued against that control plane before starting
the agent. For a first Compose run, start `control-plane`, issue the token with
the CLI, then start `agent`.

## Key rotation

```bash
npm run admin -- rotate demo-node-01
```

Rotation invalidates the old key immediately and returns the replacement once.
Stop the agent, update its private state through your secret-management process,
then restart it. Static environment keys are a migration feature; manage those
by changing `OPSATLAS_AGENT_KEYS` and restarting the service.

## Safe network exposure

The default bind is loopback. Before using another interface:

- keep a dashboard token of at least 24 characters configured;
- terminate TLS at a trusted reverse proxy;
- allow only the console's exact HTTPS origin;
- add reverse-proxy rate and body-size limits;
- back up the SQLite database and encryption secret separately; and
- do not expose this portfolio build as a production monitoring service.
