# Jetson Stage 1 Read-only Connection Runbook

This runbook lets a later agent reproduce the 2026-07-12 and 2026-07-14
environment discoveries without changing the Yahboom car. It is for inventory
only, not for starting, repairing or controlling the vehicle.

## Connection

Target: `jetson@172.20.10.13` over the vehicle WLAN. Connect with a TTY so the
operator can provide the current password interactively:

```sh
ssh -tt -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 jetson@172.20.10.13
```

Do not store passwords, tokens or private keys in this repository. The
operator supplies the credential at connection time. If host-key verification
changes unexpectedly, stop and ask the operator to verify the physical vehicle
and network before accepting a new key.

## Non-negotiable Stage 1 boundary

Allowed: `hostname`, `uname`, `date`, `ip`, `ss`, `ls`, `find`, `cat`, `sed`,
`grep`, `ps`, `systemctl cat/list-units`, package listing, `docker images`,
`docker ps -a`, `docker inspect`, and ROS CLI *list/type* queries. Sourcing a
workspace setup file is permitted only to inspect whether it loads; it must not
start a launch file.

Never run `ros2 run`, `ros2 launch`, `ros2 topic pub`, navigation actions,
teleoperation, GPIO/serial writes, TCP control clients, `curl` requests that
change state, or commands that restart/stop services. Do not publish an empty
Twist as a “test”; that is still a control command.

## Read-only inventory sequence

Run these groups separately and record the output summary in
[`web-control-real-car-validation.md`](web-control-real-car-validation.md).

1. System and network: `hostname`, `uname -a`, `cat /etc/os-release`,
   `cat /etc/nv_tegra_release`, `date -Is`, `ip -brief addr`, and `ss -ltn`.
2. Runtime: `ls -ld /opt/ros <workspace>`, `command -v ros2`,
   `printenv ROS_DISTRO ROS_VERSION ROS_DOMAIN_ID`, and the workspace
   `install/setup.bash` error output. Also record Docker images, stopped
   containers, their bind/device mappings, and `run_docker*.sh` contents; do
   not start a container. When ROS is available, use only
   `ros2 node list`, `ros2 topic list -t`, `ros2 service list -t`,
   `ros2 action list -t`, and lifecycle state queries.
3. Workspace/configuration: locate launch files, map YAML/PGM pairs, navigation
   parameter files and the Yahboom X3 driver source. Verify every map YAML's
   `image:` path exists before treating it as a candidate map.
4. Hardware: inspect `/dev/video*`, `/dev/ttyUSB*`, `/dev/ttyACM*`, USB/systemd
   device listings and readable emergency-stop/battery configuration. Ask the
   on-site operator to identify the physical emergency stop; source searches do
   not prove its existence or effectiveness.

## Current known baseline

The current evidence is maintained in
[`../architecture/jetson-yahboom-x3-environment-baseline.md`](../architecture/jetson-yahboom-x3-environment-baseline.md).
At the time of the last discovery, the host ROS 2 runtime was not runnable, but
vendor ROS Foxy Docker images were present and stopped. Do not attempt ROS graph
commands or start a container until stage 1.5 has explicit approval.

## Handoff rule

Record only observed values, command paths and timestamps. Mark unavailable
values as `unknown` or `blocked`; never infer a real-car capability from source
code or a connected USB device. A later agent must read this runbook, the
validation record and the real-car plan before reconnecting.
