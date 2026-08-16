# Architecture notes

OpsAtlas separates collection, decision-making, and presentation so each trust
boundary can stay small.

## Node agent

The agent reads coarse resource percentages and explicit HTTP health checks. It
serialises a versioned envelope and authenticates the exact bytes with
HMAC-SHA256. A millisecond timestamp is included in the signature input so the
control plane can reject stale replays. The device ID and key are supplied by
the operator; no identity is inferred from the host.

## Control plane

The server accepts no telemetry body larger than 64 KiB. It validates the
device, timestamp, signature, sequence, schema, numeric bounds, check count, and
string shape before changing state. Incident rules are deterministic functions rather
than opaque scoring. Dashboard state requires a bearer token when configured;
without one, it is available only from the loopback interface.

Current state is in memory by design for this milestone. A durable store should
be added behind the existing `ControlPlaneStore` interface, with retention and
tenant boundaries decided before deployment.

## Console

The console is a responsive React interface. Its current adapter uses fictional
demo data so it is safe to show without a running control plane. The future live
adapter will consume the protected state endpoint and SSE stream; secrets must
remain server-side and must never be bundled into browser code.

## Deliberate non-features

- no network or port discovery
- no file or process collection
- no remote shell or script execution
- no automatic remediation
- no hidden behavioural analytics

These constraints reduce the blast radius of an agent compromise and make the
collection boundary easy to explain during a security review.
