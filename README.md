# OH AI Car Web

Browser control console and localhost-only TCP gateway for the OH AI car.

> **Protocol warning:** The real-car packet format has not been confirmed.
> Read [PROTOCOL_STATUS.md](PROTOCOL_STATUS.md) before connecting a vehicle.

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
