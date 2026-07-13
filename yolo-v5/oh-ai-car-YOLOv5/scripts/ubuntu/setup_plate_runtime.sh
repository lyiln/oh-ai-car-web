#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-/home/ubuntu/member_d_plate_detection}"
VENV_DIR="${PROJECT_ROOT}/venv_ubuntu"

echo "[1/5] update apt metadata"
sudo apt-get update

echo "[2/5] install Ubuntu and ROS2 runtime dependencies"
sudo apt-get install -y \
  python3.8-venv \
  python3-pip \
  python3-colcon-common-extensions \
  ros-foxy-cv-bridge \
  ros-foxy-image-transport \
  ros-foxy-sensor-msgs \
  ros-foxy-std-msgs \
  ros-foxy-std-srvs

echo "[3/5] create python virtual environment"
python3 -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"

echo "[4/5] upgrade pip"
python -m pip install --upgrade pip

echo "[5/5] install python dependencies"
python -m pip install \
  opencv-python \
  paddleocr \
  torch \
  torchvision \
  torchaudio

echo "Runtime setup finished."
echo "Next:"
echo "  source /opt/ros/foxy/setup.bash"
echo "  source ${VENV_DIR}/bin/activate"
