# Security policy

OpsAtlas is a source-available portfolio project and has not had an independent
security audit. Do not use it to monitor production systems or expose the
control plane directly to the public internet.

## Report a vulnerability

Please report suspected vulnerabilities privately to the repository owner. Do
not open a public issue containing exploit details, credentials, host names,
telemetry payloads, or infrastructure information. A report should include the
affected commit, impact, safe reproduction steps, and any suggested mitigation.

## Operating expectations

- generate a separate random key for every agent;
- keep agent keys, the dashboard token, and the credential-encryption secret out
  of Git and logs;
- back up the SQLite database and encryption secret separately;
- terminate network traffic with TLS before leaving a trusted machine;
- keep `OPSATLAS_ALLOWED_ORIGINS` narrow;
- rotate a key immediately if its confidentiality is uncertain;
- run the control plane as an unprivileged user; and
- retain only the minimum telemetry required for an operational decision.

The agent intentionally has no discovery scan, file collection, process-list,
or remote-command capability.
