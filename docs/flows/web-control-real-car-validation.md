# Web Control Real-Car Validation

Status: Stage 1 read-only discovery was performed on 2026-07-12 and 2026-07-14;
ROS/Nav2 container recovery and a guarded suspended-wheel/disabled-drive goal
test were completed on 2026-07-15. Unit and fake-TCP tests still do not prove
vehicle behavior, and the 2026-07-15 result is not a ground-driving acceptance.

Doorstep-response Web stage 0 is complete at commit `7ebcabc`. The Web single-goal
path is now connected to Nav2, but this does not authorize autonomous motion with
the wheels on the ground. The ROS response scheduler remains separate and
unimplemented.

## 2026-07-15 Guarded Navigation Record

Test preconditions supplied by the operator: wheels suspended or drive disabled,
a person on site, and emergency stop available. The test used the current vehicle
at `10.82.66.179`; secrets are intentionally omitted.

| Check | Observed result |
| --- | --- |
| Runtime architecture | Host has no ROS installation. ROS 2 Foxy/Nav2 runs in persistent Docker container `oh-ai-nav`; host Rosmaster-App was stopped to avoid serial/video contention. |
| ROS inputs | `/vel_raw`, `/odom_raw`, `/odom` about 25 Hz; `/scan` about 8.5 Hz. |
| Localization/navigation | `odom -> base_footprint`, `map -> base_footprint`, and `/navigate_to_pose` Action server observed. |
| Short goal within tolerance | About 0.15 m; Nav2 returned success without meaningful velocity output. |
| Motion-producing suspended-wheel goal | About 0.4 m; non-zero command reached about 0.22 m/s, then returned to zero; Nav2 returned success. |
| Platform result path | After the scheduler fix, a final goal progressed `queued -> navigating -> arrived`; Nav2 terminal status was `SUCCEEDED`. |

Two runtime faults were found and repaired: Fast DDS discovery was unstable on
the multi-NIC host until the single-container graph used `ROS_LOCALHOST_ONLY=1`,
and Foxy Action completion could remain pending when the Executor started before
the ActionClient/subscriptions were created. Current readiness also requires a
valid `map -> base_footprint` in the current supervisor lifetime.

Remaining Stage D evidence: wheels-on-ground low-speed/short-distance behavior,
map alignment accuracy, obstacle avoidance, stop distance, localization recovery,
cancel/emergency-stop response, and repeated-route reliability.

## Historical Stage 1 Environment Inventory (Read-only)

The table below preserves what was known before the 2026-07-15 container start.
Where it conflicts with the guarded navigation record or the
[current environment baseline](../architecture/jetson-yahboom-x3-environment-baseline.md),
the newer dated evidence takes precedence.

Fill every known value from actual commands or labels. Write `unknown` when a
value cannot be observed; do not guess.

| Item | Observed value | Evidence command/file | Status |
| --- | --- | --- | --- |
| Vehicle code/asset label | Yahboom X3 is indicated by workspace launch files; physical asset label not observed | `yahboomcar_bringup_X3_launch.py` | partial |
| Vehicle IP | `172.20.10.13/28` on `wlan0` | `ip -brief addr` over SSH | observed |
| TCP control port | Listener is bound only to legacy `10.82.66.179:6000`; reachability from current WLAN is untested | `ss -ltn` | partial |
| Video port/path | `6500` listens on all interfaces; `/dev/video0` and `/dev/video1` exist | `ss -ltn`, device listing | partial |
| Jetson model / OS / JetPack | aarch64, Ubuntu 20.04.5, L4T R35.3.1 (`t186ref`); exact commercial model unconfirmed | `uname -a`, `/etc/os-release`, `/etc/nv_tegra_release` | partial |
| ROS 2 distribution | Host runtime unavailable: `/opt/ros` absent and `ros2` not found. Stopped `icar/ros-foxy:1.0.2` and `yahboomtechnology/ros-foxy:5.0.1` Docker images/containers are available, but not started. | filesystem, Docker inventory, `install/setup.bash` | partial |
| Nav2 version and lifecycle state | no running ROS graph; no Nav2 lifecycle can be queried | `ps`, `ros2` availability | blocked |
| Map file and exact map version | candidate maps exist under `yahboomcar_nav/maps`; `yahboomcar.yaml` points to missing `/root/.../yahboomcar.pgm`, so no usable selected map/version | map YAML and file existence check | blocked |
| Global frame | source parameters use `map`, `odom`, `base_footprint`; not runtime-confirmed | `dwa_nav_params.yaml`, `lds_2d.lua` | partial |
| Localization pose topic | expected from RTAB-Map source, but no runtime topic exists | `rtabmap_localization_launch.py` | blocked |
| Velocity topic | driver subscribes `cmd_vel` (`geometry_msgs/Twist`); not runtime-confirmed | `Mcnamu_driver_X3.py` | partial |
| Odometry topic | base node source consumes `vel_raw` and publishes `odom_raw`; navigation source expects `/odom` | base/nav source search | partial |
| Battery topic/message | driver publishes `voltage` (`std_msgs/Float32`), not a percentage | `Mcnamu_driver_X3.py` | partial |
| RGB camera topic/message | RTAB-Map launch expects `/camera/color/image_raw`; no container graph observed | launch source, system devices | partial |
| Depth camera topic/message | RTAB-Map launch expects `/camera/depth/image_raw`; current Orbbec USB devices are `001/011`, `001/013` | launch source, `lsusb` | partial |
| Emergency-stop method | unknown; no estop service/configuration found in readable workspace | source/file search | blocked |
| Operator and physical safety observer | pending | test record | pending |
| Platform host reachable from vehicle | not tested; platform host was not provided | network inventory | pending |
| Clock synchronization | Jetson reports `2026-07-12T13:10:23+08:00`; host comparison not recorded | `date -Is` | partial |

## Historical Stage 1 Discovery Result

The Jetson is reachable and has connected RPLidar, Orbbec depth and two video
devices. Its **host** is not a runnable ROS/Nav2 environment: `/opt/ros` is
absent, `ros2` is unavailable and no ROS process, graph or Nav2 lifecycle node
was active. Vendor ROS Foxy Docker images, source workspaces and stopped
containers are available; that is a candidate runtime, not proof that ROS/Nav2
can start. The source contains a Yahboom X3 bringup and RTAB-Map/DWA/TEB
configuration, including Nav2-style parameters, but the candidate map YAMLs
still contain a stale `/root/...` image path.

This paragraph described the 2026-07-14 gate. The Docker-runtime and guarded
non-ground navigation check were subsequently completed on 2026-07-15 as
recorded above. It does not remove the Stage D ground-test gate or authorize the
doorstep-response scheduler.

At that historical Stage 1 gate, only network reachability, ROS graph/topic/type
inspection, Nav2 lifecycle inspection, configuration-file reading,
video-page loading and device-credential authentication were permitted. The
later guarded goal test used the separately stated 2026-07-15 safety conditions.

Before testing, ensure the vehicle has a clear stopping area and an operator
can immediately stop power or motion. Validate the connection, each button
direction and Stop/Brake, rocker release, explicit Disconnect, reconnect to a
new target, gateway exit, wheel reset, media commands, tracking toggle, and
direct video URL. Record the target IP, observed packet behavior, browser
video result, any TCP response, and whether the vehicle stopped after each
disconnect path. A loaded iframe is not proof that the video stream is healthy.
