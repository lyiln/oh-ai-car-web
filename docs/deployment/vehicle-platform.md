# Vehicle Platform Deployment

1. Copy `.env.example` to `.env` and replace every secret. Create a Web (JS API)
   key and security code in AMap; keep the security code in `.env` only.
   Docker enables `VITE_PLATFORM_ENABLED`; the existing local v1 development
   interface remains the default when that build-time flag is absent.
   Set `PLATFORM_PUBLIC_ORIGIN` to the exact browser entry URL (for example,
   `https://cars.example.edu`). It is required in production and is used to
   restrict CORS and Cookie-authenticated write requests. Use
   `PLATFORM_ALLOWED_ORIGINS` only for additional trusted development origins.
2. Start the platform with `docker compose up --build`. The first start runs the
   SQL migration and creates the configured bootstrap administrator exactly once.
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

Do not expose the local gateway beyond the operator machine. Use HTTPS and set
`COOKIE_SECURE=true` before any non-local deployment. Run
`npm run test:integration --workspace=@oh-ai-car-web/backend` in a Docker-ready
environment before deployment; it starts a temporary PostGIS database and does
not use the deployment data volume.
