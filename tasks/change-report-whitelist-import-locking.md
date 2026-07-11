# Whitelist Import and Patrol Snapshot Locking Change Report

## Source plan

Implements the approved 2026-07-12 repair plan for the FR-002 whitelist-import/patrol-start race.

## Changed behavior

- Added migration `006-whitelist-live-version-locking`. It marks historical duplicate live whitelist rows as snapshots and enforces at most one live row per vehicle with a partial unique index.
- `POST /api/whitelist` and `POST /api/whitelist/import` now lock the selected vehicle and write through one database transaction.
- Whitelist imports still report per-row request-validation errors, but all valid rows commit together or roll back together on a database error.
- `POST /api/patrol/start` now selects, validates and copies the active whitelist only after acquiring the same vehicle lock.

## Regression coverage

- A deterministic integration test blocks an import on a whitelist-entry row after it has acquired the vehicle lock. Patrol start must wait, and its snapshot must contain the complete committed import.
- A concurrent first-write test verifies that two white-list writes create only one live whitelist for a vehicle.

## Validation status

- `npm run typecheck`: passed.
- Full unit/integration validation must be run in an environment that allows localhost listeners and provides a Docker-compatible container runtime. The sandbox blocks gateway listeners and Testcontainers.

## Operational risk and rollback

The migration changes existing duplicate live whitelist rows to snapshots, retaining their entries and task references. Rollback after deployment should remove the unique index only after confirming no application version still relies on the transaction-locking contract; restoring duplicate rows is intentionally not automated.
