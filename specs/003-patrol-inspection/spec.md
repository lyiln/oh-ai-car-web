# Feature Specification: Patrol Inspection

**Feature Branch**: `003-patrol-inspection`
**Created**: 2026-07-11
**Status**: Approved

## User Scenarios & Testing

### User Story 1 - Configure a repeatable route (Priority: P1)

An administrator imports a Nav2 waypoint YAML file, reviews its ordered 3-8
waypoints and configures an optional camera-frame no-parking ROI per waypoint.

**Independent Test**: An administrator can import a valid route and an invalid
route is rejected without creating a partial route.

### User Story 2 - Run and monitor a patrol (Priority: P1)

An operator starts one route for an authorised vehicle and sees scheduler
status, waypoint progress and actual GPS track. The vehicle-side scheduler
claims the task and reports lifecycle events using its device credential.

**Independent Test**: A simulated scheduler can claim, update and complete a
task; another task for the same vehicle is refused while it is active.

### User Story 3 - Review plates and report results (Priority: P1)

Property staff imports the owner/visitor whitelist, reviews evidence-backed
plate observations and downloads a task report.

**Independent Test**: A qualified observation is classified, deduplicated by
task/plate/waypoint/30-minute window and appears in the report.

## Requirements

- **FR-001**: Routes are immutable versioned YAML imports with 3-8 named
  waypoints and 8-10 second dwell times.
- **FR-002**: A patrol task snapshots its route and whitelist version and only
  one task may be active per vehicle.
- **FR-003**: Only authorised users can view a vehicle's patrol data; only an
  administrator configures routes, ROI and whitelists.
- **FR-004**: Scheduler APIs use the existing per-vehicle device credential;
  browser clients cannot submit scheduler events.
- **FR-005**: Recognition confidence below the task's immutable review-threshold
  snapshot (default `0.75`) is pending review. Other plates are classified as
  registered private, visitor or suspected external.
- **FR-006**: No-parking is an independent tag when a vehicle box intersects
  the selected waypoint's camera-frame ROI.
- **FR-007**: Reports contain task metadata, completion state, counts by
  result, evidence links and a property follow-up list.

## Assumptions

- YAML is maintained by the Nav2 team and imported by the Web platform.
- Autonomous motion and manual takeover are coordinated by the vehicle-side
  scheduler; this feature does not change the TCP control protocol.
- PostgreSQL remains the system of record.
- The dedupe window is snapshotted with the task (default 30 minutes); an
  administrator may change only the default used by future tasks.
