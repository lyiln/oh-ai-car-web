# Jetson Yahboom X3 Environment Baseline

Observed by read-only SSH discovery on 2026-07-12 and 2026-07-14. This is the
local-development contract for the real-car integration, not proof that a listed
topic or service is active on the vehicle.

## Confirmed platform and hardware

| Area | Evidence-backed value | Local-development implication |
| --- | --- | --- |
| Target | `jetson@172.20.10.13`, `wlan0` `172.20.10.13/28` | Use this only as an operator-provided lab target; do not hard-code it into application defaults. |
| OS | Ubuntu 20.04.5, L4T R35.3.1, aarch64 | Any repair proposal must be compatible with this JetPack generation. |
| Vehicle stack | Yahboom X3 launch and driver sources in `/home/jetson/code/yahboomcar_ws` | Treat X3 as a source-level indication until the physical asset label is checked. |
| Sensors | `/dev/rplidar` → CP2102 `/dev/ttyUSB0`; Orbbec USB IDs `001/011` and `001/013`; `/dev/video0`, `/dev/video1` | Device presence does not establish the ROS topic names, calibration, or container mapping after a replug. |
| Runtime state | Host has no `/opt/ros`, `ros2` executable or ROS graph; stopped `icar/ros-foxy:1.0.2` and `yahboomtechnology/ros-foxy:5.0.1` containers are present | Docker is the candidate ROS runtime; do not claim it is runnable until a separately approved container start proves it. |
| TCP/video services | `6500` listens on all interfaces; `6000` binds only to legacy `10.82.66.179` | Do not infer reachability from the current WLAN address or protocol compatibility. |

## Source-level interface candidates

These names come from the X3 source and must be re-checked from the live graph
after runtime recovery.

| Interface | Candidate type / relation | Status |
| --- | --- | --- |
| `cmd_vel` | `geometry_msgs/Twist`, consumed directly by `Mcnamu_driver_X3` | Safety-critical; never publish during discovery. |
| `vel_raw` | `geometry_msgs/Twist`, published by the driver | Source-level only. |
| `odom_raw` | `nav_msgs/Odometry`, produced by base-node code from `vel_raw` | Source-level only. |
| `/odom` | Expected by RTAB-Map localization launch | Source-level only; bridge/remap unknown. |
| `voltage` | `std_msgs/Float32`, from driver battery-voltage reading | Requires an approved voltage-to-percent calibration before platform's 20% gate can use it. |
| `/camera/color/image_raw` | RGB input expected by RTAB-Map launch | Source-level only. |
| `/camera/depth/image_raw` | Depth input expected by RTAB-Map launch | Source-level only. |
| `map` / `odom` / `base_footprint` | Global, odometry and base frames in navigation parameters | TF chain is not runtime-confirmed. |

## Navigation and map state

The workspace contains RTAB-Map localization launches and DWA/TEB parameter
files with Nav2-style settings. The host does **not** establish an executable
Nav2 installation because its ROS 2 runtime is missing; the vendor Docker
images are only a candidate runtime until started and inspected. Scheduler
development must not choose an action API until stage 1.5 selects one of these
paths:

1. Restore ROS 2 and Nav2, then use `NavigateToPose` after lifecycle checks.
2. Retain the existing RTAB-Map navigation stack and define an explicit,
   separately reviewed goal/cancel/status adapter.

Candidate maps are under `yahboomcar_nav/maps`, but the inspected
`yahboomcar.yaml` points at a missing `/root/yahboomcar_ros2_ws/...` PGM path.
No `mapVersion` is currently valid for platform assignment.

## Local development before stage 1.5

- Keep the platform scheduler unimplemented and use fake device events in tests.
- Model `cmd_vel` as a forbidden output; tests may verify that no raw speed
  command is produced by the platform or gateway.
- Treat `voltage`, camera inputs, laser scan, odometry, map and lifecycle data
  as optional/unavailable. Do not synthesize a battery percentage or physical
  zero-velocity assertion from source code.
- Use the existing API contracts and unit/integration tests for Web work only.
  Hardware-facing adapter work begins only after the correct Docker container,
  map, emergency stop and selected navigation interface are evidenced.

## Stage 1.5 evidence needed

1. A supported ROS 2 runtime whose setup file has no missing prefixes.
2. Live graph, topic types, TF tree and lifecycle state with drivetrain disabled.
3. One loadable map YAML/PGM pair and a version identifier.
4. Physical emergency-stop location, operator, and zero-velocity observation
   procedure.
5. Battery-voltage calibration or another authoritative percentage source.
