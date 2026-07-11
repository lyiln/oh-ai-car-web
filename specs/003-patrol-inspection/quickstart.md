# Patrol Validation Quickstart

1. Start PostgreSQL and the backend, then log in as an administrator.
2. Create a vehicle, import a 3-waypoint YAML route and a whitelist CSV.
3. Create and start a patrol task as an authorised operator.
4. Use the vehicle device credential to claim the task and submit waypoint,
   observation and completion events.
5. Open the patrol page and verify the task progress, classified records and
   HTML report. Run `npm test`, `npm run typecheck`, and `npm run build`.
