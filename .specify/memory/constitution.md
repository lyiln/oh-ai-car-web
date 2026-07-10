# OH AI Car Web Constitution

## Core Principles

### I. Independent Workspace

The repository must build, test, document, and evolve without a sibling car
source checkout. Source snapshots may be retained as documentation evidence,
but runtime imports and build steps may only use this repository.

### II. Protocol Evidence Before Assumption

TCP packet changes require documented source evidence and automated encoder
tests. When evidence conflicts or real-car behavior is unknown, record the
conflict prominently and do not present either interpretation as confirmed.

### III. Local Operator Safety

The gateway binds to localhost unless a separately approved feature changes
the security model. Movement must stop on release, cancellation, browser blur,
or gateway disconnect; browser clients never send raw TCP commands.

### IV. Shared Contract Ownership

The WebSocket contract, shared command types, encoder behavior, and tests move
together. A contract example must not silently diverge from the implementation.

### V. Verifiable Delivery

Protocol unit tests, fake TCP gateway tests, and frontend interaction tests are
required before review. Real-car claims require a manually recorded result and
must not be inferred from local tests.

## Development Workflow

Use the repository-local Spec Kit skills for new work. Update the relevant
specification, plan, tasks, and decision records whenever a public command,
protocol rule, or safety behavior changes.

## Governance

This constitution governs future feature work. Amendments require a documented
reason, affected-contract review, and updated validation evidence.

**Version**: 1.0.0 | **Ratified**: 2026-07-10 | **Last Amended**: 2026-07-10
