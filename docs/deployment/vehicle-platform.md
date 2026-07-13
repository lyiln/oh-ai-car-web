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
   For Yahboom Jetson Orin Nano (ROS2 Foxy in Docker, optional mock GPS), see
   [jetson-gps-setup.md](./jetson-gps-setup.md).
5. On each operator machine, run the local gateway with
   `PLATFORM_API_URL=http://<server>:8080 npm run dev:gateway`. The gateway then
   rejects control connections without a live platform lease.

## Local three-process stack (HarmonyOS APP parity)

The HarmonyOS APP connects **directly** from the phone to car TCP `:6000` and
loads video at `http://{IP}:6500/index2`. The Web stack keeps the same car
protocol (`$01…#` packets, same ports) but inserts a **localhost gateway** for
browser safety:

| APP (`NetworkSettings` / remote) | Web (`/console`) |
|---|---|
| Enter car IP / TCP 6000 / video 6500 | Editable network panel on `/console` |
| Phone opens TCP to car | Operator PC gateway opens TCP to car |
| No auth | Platform lease + `PLATFORM_API_URL` on gateway |
| Video Web component → `:6500/index2` | Browser iframe → same URL |

**Requirement:** the operator PC must be on the **same LAN** as the car (same
condition as the phone when using the APP). The gateway initiates TCP from that
PC; the browser never speaks raw TCP.

For local development, run all three (see `npm run dev:stack`):

```bash
npm run dev:backend
npm run dev:frontend
# PowerShell:
$env:PLATFORM_API_URL="http://127.0.0.1:8788"; npm run dev:gateway
```

Then open `http://127.0.0.1:5173`, sign in, select a device, open **控制台**,
confirm or override IP/ports, and connect. The UI probes TCP before claiming
control and shows separate status for gateway / lease / car TCP.

Protocol encoding matches the retained ArkTS `CarEncode` evidence (Front =
`$011504011B#`). Real-car confirmation remains gated by
`PROTOCOL_STATUS.md` and `docs/flows/web-control-real-car-validation.md`.

Do not expose the local gateway beyond the operator machine. Use HTTPS and set
`COOKIE_SECURE=true` before any non-local deployment. Run
`npm run test:integration --workspace=@oh-ai-car-web/backend` in a Docker-ready
environment before deployment; it starts a temporary PostGIS database and does
not use the deployment data volume.
