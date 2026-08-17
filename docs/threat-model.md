# Threat model

## Assets

- agent signing keys, enrollment tokens, and the dashboard bearer token
- the separate credential-encryption secret
- operational health signals and last accepted sequences
- incident state, acknowledgements, and audit history
- proprietary source code and visual design

## Threats and controls

| Threat | v1 control | Residual risk / next control |
| --- | --- | --- |
| Forged telemetry | Per-device HMAC-SHA256 key | A compromised endpoint key can impersonate that endpoint until rotation |
| Replayed payload | Five-minute timestamp window plus persisted monotonic sequence | Requires reasonably accurate clocks; add explicit clock-health reporting |
| Credential database theft | AES-256-GCM at rest with secret held outside SQLite | Environment/process compromise can still expose the secret |
| Enrollment token theft | 256-bit random, device-bound, one-time, 60–3600 second TTL, digest-only memory storage | Deliver tokens through a secure operator channel |
| Oversized or malformed input | 64 KiB limit and strict schema bounds | Add reverse-proxy request limits and rate limiting |
| Browser data theft | Bearer gate, exact origin allowlist, no-store, sessionStorage-only token | XSS or a malicious browser extension can read the session; add a backend session layer |
| Sensitive collection | Fixed narrow schema and explicit HTTP checks | Maintain privacy regression tests as the schema evolves |
| Remote execution abuse | No command, scripting, remediation, or discovery capability | Preserve this boundary during feature work |
| State loss or corruption | SQLite WAL plus atomic agent state writes | Add tested backup/restore and retention procedures |
| Privilege escalation in containers | Unprivileged runtime, read-only root, no-new-privileges | Use image signing and vulnerability scanning in a real deployment |
| Source misuse | Copyright notices and source-available licence | Public code can still be copied; legal terms are deterrence, not DRM |

## Trust assumptions

- The agent host and process environment are trusted.
- The control-plane host protects its environment and database directory.
- System clocks are accurate within five minutes.
- TLS termination exists before traffic crosses an untrusted network.
- Dashboard token holders are trusted operators.

## Out of scope for v1

OpsAtlas is single-operator and portfolio-grade. It does not provide tenant
isolation, role-based access, built-in TLS, distributed database replication,
request throttling, or a formal incident-export retention policy.
