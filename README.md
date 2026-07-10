# OH AI Car Web

Browser control console and localhost-only TCP gateway for the OH AI car.

> **Protocol warning:** The real-car packet format has not been confirmed.
> Read [PROTOCOL_STATUS.md](PROTOCOL_STATUS.md) before connecting a vehicle.

For agent-assisted work, start with [AGENTS.md](AGENTS.md) and
[AI_CONTEXT.md](AI_CONTEXT.md).

Course-level delivery status and evidence requirements are tracked in
[课程状态.md](课程状态.md); the group execution and taskbook mapping
are indexed at [docs/course/课程文档索引.md](docs/course/课程文档索引.md).

The repository contains the implemented vehicle management and trajectory
platform MVP. Start with the Chinese [project and backend guide](docs/architecture/vehicle-platform-overview.md), then use the
[deployment guide](docs/deployment/vehicle-platform.md). Its approved plan and
change record remain in [tasks/vehicle-fleet-platform-mvp-plan.md](tasks/vehicle-fleet-platform-mvp-plan.md)
and [tasks/change-report-vehicle-fleet-platform-mvp.md](tasks/change-report-vehicle-fleet-platform-mvp.md).

## Development

```sh
npm install
npm run dev:gateway
npm run dev:frontend
```

The gateway listens on `http://127.0.0.1:8787` and WebSocket endpoint
`ws://127.0.0.1:8787/control`. The Vite development UI uses
`http://127.0.0.1:5173`.

Run `npm test`, `npm run typecheck`, and `npm run build` before a review.

Real-car validation is manual. Read `specs/001-web-control-gateway/quickstart.md`
before connecting to a vehicle.

## Spec Kit

This repository tracks its own `.specify/` workflow and Codex skills under
`.agents/skills/`. With the Spec Kit CLI installed, run `specify check` from
this directory to verify the local setup. New requirements and plans belong
under `specs/`; no sibling OpenHarmony checkout is required.
