# Changelog

## 1.0.0 — 2026-08-18

- added durable SQLite fleet, incident, history, and audit storage
- added one-time agent enrollment, encrypted credential persistence, rotation,
  revocation, and metadata listing
- persisted agent sequence state to prevent replay across restarts
- connected the console to the protected live API with an explicit demo fallback
- added incident acknowledgement against the live control plane
- added hardened container volumes and a dependency-free admin CLI
- expanded the service/security suite from eight to twelve tests
- documented setup, API behaviour, architecture, privacy boundaries, and threats
