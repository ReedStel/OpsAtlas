# Threat model

## Assets

- agent signing keys and dashboard tokens
- operational health signals
- incident state and acknowledgement history
- proprietary source code and product design

## Primary threats and controls

| Threat | Current control | Remaining work |
| --- | --- | --- |
| Forged telemetry | Per-device HMAC signature | Add managed enrolment and rotation |
| Replayed payload | Five-minute timestamp window and in-memory sequence check | Add per-device sequence persistence |
| Oversized input | 64 KiB hard limit | Add reverse-proxy limits and rate limiting |
| Browser data theft | Token gate, origin allowlist, no-store | Add user sessions and role checks |
| Sensitive collection | Narrow fixed schema, explicit checks | Add automated privacy regression tests |
| Source-code redistribution | Private repository and proprietary licence | Use counsel-reviewed customer terms |
| State loss | Explicit in-memory MVP | Add encrypted durable storage and backups |

## Trust assumptions

The host running an agent and the process environment holding its key are
trusted. System clocks are accurate within five minutes. TLS termination is
required before traffic crosses an untrusted network. The current service is a
portfolio-grade MVP, not a hardened multitenant platform.
