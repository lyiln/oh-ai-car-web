# Vehicle Platform Deployment

1. Copy `.env.example` to `.env` and replace every secret. Create a Web (JS API)
   key and security code in AMap; keep the security code in `.env` only.
   Docker enables `VITE_PLATFORM_ENABLED`; the existing local v1 development
   interface remains the default when that build-time flag is absent.
   Set `PLATFORM_PUBLIC_ORIGIN` to the exact browser entry URL (for example,
   `https://cars.example.edu`). It is required in production and is used to
   restrict CORS and Cookie-authenticated write requests. Use
   `PLATFORM_ALLOWED_ORIGINS` only for additional trusted development origins.
   Set `BOOTSTRAP_ADMIN_EMAIL` to a mailbox that can receive administrator
   login codes, and configure all `SMTP_*` values for a controlled SMTP
   account. SMTP credentials and codes stay in the backend runtime; neither
   is exposed to the browser.
2. Start the local smoke-test platform with `docker compose up --build`. The first start runs the
   SQL migration and creates the configured bootstrap administrator exactly once.
   Compose requires the bootstrap email and SMTP variables so a newly created
   administrator can use email OTP login.
3. Open `http://<server>:8080` and sign in. Create vehicle records, assign
   operators, and rotate device credentials through the administrator API
   described in [the project guide](../architecture/vehicle-platform-overview.md#后端-api-索引).
   Store each returned one-time credential on the ROS2 companion computer as
   `DEVICE_CREDENTIAL`.
4. Run `PLATFORM_API_URL=http://<server>:8080 DEVICE_CREDENTIAL=<credential>
   python3 telemetry_agent.py` in a ROS2 environment with `/gps/fix` available.
5. On each operator machine, run the local gateway with
   `PLATFORM_API_URL=http://<server>:8080 npm run dev:gateway`. The gateway then
   rejects control connections without a live platform lease.

The supplied Compose file explicitly runs the backend in development mode so
browser-based local HTTP smoke tests can use a non-secure Cookie. It is not a
production deployment definition. Production must terminate HTTPS and run with
`NODE_ENV=production`, a non-default `SESSION_SECRET` of at least 32 characters,
`COOKIE_SECURE=true`, and `PLATFORM_PUBLIC_ORIGIN` set; the backend refuses to
start if any of these gates is absent. Production also requires
`SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`; verify delivery to
the bootstrap administrator before enabling email-login-only operations. Do not
expose the local gateway beyond the operator machine. Run
`npm run test:integration --workspace=@oh-ai-car-web/backend` in a Docker-ready
environment before deployment; it starts a temporary PostGIS database and does
not use the deployment data volume.

Use `npm run test:deploy-live` to build the Compose stack, authenticate, verify
an authorised `/patrol/live` subscription through Nginx, and verify that an
unauthenticated connection closes with policy code 1008. It creates an isolated
Compose project and removes its containers and volumes when finished.
