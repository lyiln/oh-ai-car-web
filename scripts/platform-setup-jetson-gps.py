#!/usr/bin/env python3
"""Platform setup: login, ensure vehicle for Jetson, rotate device credential."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8788"
ORIGIN = "http://127.0.0.1:5173"
JETSON_HOST = "10.82.66.179"


class Session:
    def __init__(self) -> None:
        self.cookie = ""

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict | list | str]:
        data = None if body is None else json.dumps(body).encode()
        headers = {"Origin": ORIGIN, "Content-Type": "application/json"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw_cookie = resp.headers.get("Set-Cookie")
                if raw_cookie:
                    self.cookie = raw_cookie.split(";", 1)[0]
                text = resp.read().decode()
                return resp.status, json.loads(text) if text else {}
        except urllib.error.HTTPError as err:
            text = err.read().decode()
            try:
                parsed = json.loads(text) if text else {}
            except json.JSONDecodeError:
                parsed = text
            return err.code, parsed


def main() -> int:
    username = sys.argv[1] if len(sys.argv) > 1 else "admin"
    password = sys.argv[2] if len(sys.argv) > 2 else "admin123"
    session = Session()
    status, payload = session.request("POST", "/api/auth/login", {"username": username, "password": password})
    print("login", status, payload)
    if status >= 400:
        return 1

    status, vehicles = session.request("GET", "/api/vehicles")
    print("vehicles", status, json.dumps(vehicles, ensure_ascii=False, indent=2))
    if status >= 400:
        return 1

    vehicle_list = vehicles.get("vehicles", []) if isinstance(vehicles, dict) else []
    target = next((v for v in vehicle_list if v.get("host") == JETSON_HOST or v.get("code") == "jetson-01"), None)
    if not target:
        status, created = session.request(
            "POST",
            "/api/vehicles",
            {
                "code": "jetson-01",
                "name": "Jetson巡检车",
                "host": JETSON_HOST,
                "tcpPort": 6000,
                "videoPort": 6500,
                "description": "Yahboom Jetson Orin Nano",
            },
        )
        print("create_vehicle", status, created)
        if status >= 400:
            return 1
        target = created.get("vehicle") if isinstance(created, dict) else None
    if not target or not target.get("id"):
        print("no vehicle id")
        return 1

    vehicle_id = target["id"]
    print("vehicle_id", vehicle_id)

    status, cred = session.request("POST", f"/api/vehicles/{vehicle_id}/device-credentials", {})
    print("credential", status, json.dumps(cred, ensure_ascii=False, indent=2))
    if status >= 400:
        return 1

    token = cred.get("credential", {}).get("token") if isinstance(cred, dict) else None
    if not token:
        print("missing token")
        return 1

    # Write local secrets file (gitignored via .env pattern if under scripts/.local)
    out = {
        "vehicleId": vehicle_id,
        "host": JETSON_HOST,
        "platformApiUrl": "http://10.82.66.59:8788",
        "deviceCredential": token,
        "devLanIp": "10.82.66.59",
    }
    path = "scripts/.local-jetson-gps.json"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print("wrote", path)
    print("DEVICE_CREDENTIAL=", token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
