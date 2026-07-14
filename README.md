# OH AI Car Web

Browser control console and localhost-only TCP gateway for the OH AI car.

> **Protocol warning:** The real-car packet format has not been confirmed.
> Read [PROTOCOL_STATUS.md](PROTOCOL_STATUS.md) before connecting a vehicle.

For agent-assisted work, start with [AGENTS.md](AGENTS.md) and
[AI_CONTEXT.md](AI_CONTEXT.md).

## Documentation

Use the [documentation map](docs/README.md) to choose current guides,
architecture, deployment, course delivery, or reference evidence. Product
requirements are indexed at [specs/README.md](specs/README.md); active plans,
reviews, and historical change reports are indexed at [tasks/README.md](tasks/README.md).

Course-level delivery status and evidence requirements are tracked in
[课程状态.md](课程状态.md); the group execution and taskbook mapping
are indexed at [docs/course/课程文档索引.md](docs/course/课程文档索引.md).

The repository contains the implemented vehicle management and trajectory
platform MVP. Start with the Chinese [project and backend guide](docs/architecture/vehicle-platform-overview.md), then use the
[deployment guide](docs/deployment/vehicle-platform.md). Its approved plan and
change record remain in [tasks/vehicle-fleet-platform-mvp-plan.md](tasks/vehicle-fleet-platform-mvp-plan.md)
and [tasks/change-report-vehicle-fleet-platform-mvp.md](tasks/change-report-vehicle-fleet-platform-mvp.md).

The repository now also vendors the key YOLO plate-recognition code under
`YOLOv5/oh-ai-car-YOLOv5`, so the local plate API and edge-agent can run
without requiring a separate sibling checkout by default.

## Development

```sh
npm install
npm run dev:frontend
PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway
```

The gateway listens on `http://127.0.0.1:8787` and WebSocket endpoint
`ws://127.0.0.1:8787/control`. The Vite development UI uses
`http://127.0.0.1:5173`.

The gateway requires `PLATFORM_API_URL` and validates a platform control lease
before it connects to a car; unleased direct-control mode is no longer exposed.

Run `npm test`, `npm run typecheck`, and `npm run build` before a review.

Real-car validation is manual. Read the active [real-car integration plan](tasks/real-car-doorstep-integration-plan.md)
and [validation record](docs/flows/web-control-real-car-validation.md) before connecting to a vehicle.

## Spec Kit

This repository tracks its own `.specify/` workflow and Codex skills under
`.agents/skills/`. With the Spec Kit CLI installed, run `specify check` from
this directory to verify the local setup. New requirements and plans belong
under `specs/`; no sibling OpenHarmony checkout is required.
