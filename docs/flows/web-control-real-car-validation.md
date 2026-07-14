# Web Control Real-Car Validation

Status: Stage 1 read-only discoveries performed on 2026-07-12 and 2026-07-14.
Unit and fake-TCP tests do not prove vehicle behavior; no movement, Nav2 goal,
TCP command, Docker start or `/cmd_vel` publication was sent during these
discoveries.

Doorstep-response Web stage 0 is complete at commit `7ebcabc`. This does not
authorize physical motion. Complete the stage 1 inventory below before writing
or starting the ROS response scheduler.

## Stage 1 Environment Inventory (Read-only)

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

## Stage 1 Discovery Result

The Jetson is reachable and has connected RPLidar, Orbbec depth and two video
devices. Its **host** is not a runnable ROS/Nav2 environment: `/opt/ros` is
absent, `ros2` is unavailable and no ROS process, graph or Nav2 lifecycle node
was active. Vendor ROS Foxy Docker images, source workspaces and stopped
containers are available; that is a candidate runtime, not proof that ROS/Nav2
can start. The source contains a Yahboom X3 bringup and RTAB-Map/DWA/TEB
configuration, including Nav2-style parameters, but the candidate map YAMLs
still contain a stale `/root/...` image path.

Do not proceed to the response scheduler, simulator, or any physical-motion
stage. First obtain approval for a separate non-motion Docker-runtime and
architecture check: verify the current USB mappings, start the selected vendor
container, select an exact map and repair its paths, then prove the live graph,
lifecycle, topics, battery conversion and hardware emergency stop while the
drivetrain remains disabled.

Stage 1 permits only network reachability, ROS graph/topic/type inspection,
Nav2 lifecycle inspection, configuration-file reading, video-page loading and
device-credential authentication. Do not publish `/cmd_vel`, send a Nav2 goal,
or send movement packets during this inventory.

Before testing, ensure the vehicle has a clear stopping area and an operator
can immediately stop power or motion. Validate the connection, each button
direction and Stop/Brake, rocker release, explicit Disconnect, reconnect to a
new target, gateway exit, wheel reset, media commands, tracking toggle, and
direct video URL. Record the target IP, observed packet behavior, browser
video result, any TCP response, and whether the vehicle stopped after each
disconnect path. A loaded iframe is not proof that the video stream is healthy.
