# Agent Guide

## Read First

Before planning or editing, read these files in order:

1. `NEXT_SESSION.md` when it exists and contains an active handoff
2. `AI_CONTEXT.md`
3. `课程状态.md`
4. `docs/course/课程文档索引.md` when work affects group delivery or course evidence
5. `PROTOCOL_STATUS.md`
6. `.specify/memory/constitution.md`
7. The relevant file under `specs/001-web-control-gateway/`

## Repository Boundary

- This is the standalone Web repository. It must build, test, and evolve
  without a sibling OpenHarmony checkout.
- `docs/reference/` contains retained evidence only. Do not add runtime imports,
  build dependencies, or required local paths to the original car source.
- Do not copy ArkTS application code into this repository. Derive only the
  minimum documented protocol evidence needed for Web work.

## Protocol Safety: Non-Negotiable

- The `Front` button packet has conflicting evidence. Read
  `PROTOCOL_STATUS.md` before modifying any encoder, WebSocket contract, or
  real-car control behavior.
- `$011503011A#` and `$011504011B#` are both unverified by a physical car.
  The current encoder emits the latter only as a source-compatibility
  assumption.
- Never claim fake TCP tests prove real-car compatibility. Record controlled
  hardware observations in `docs/flows/web-control-real-car-validation.md`.
- Do not expose raw encoded TCP commands or arbitrary TCP passthrough to the
  browser. Keep the gateway localhost-only, verify the documented local browser
  Origins, and preserve the single-controller session rule unless a separately
  approved spec changes the security model.

## Development Workflow

- Use the repository-local Spec Kit skills in `.agents/skills/` for new
  feature work. Keep requirements in `specs/`, decisions in `docs/decisions/`,
  and actual delivery state in `tasks/`.
- When protocol evidence changes, update `PROTOCOL_STATUS.md`, the WebSocket
  contract, encoder tests, and the relevant decision record in the same change.
- For code changes, run `npm run typecheck`, `npm test`, and `npm run build`.
  Gateway tests use a fake local TCP server; do not substitute this for real-car
  validation.
- Treat iframe page load as browser-page availability only, not proof that the
  car video stream is working.
- Do not mark any course requirement complete without the executable evidence
  required by `课程状态.md` and its `docs/course/` checklists.
- Do not commit, push, reset, clean, or modify external source repositories
  unless the user explicitly requests it.
