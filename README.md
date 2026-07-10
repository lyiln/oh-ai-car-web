# OH AI Car Web

Browser control console and localhost-only TCP gateway for the OH AI car.

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
