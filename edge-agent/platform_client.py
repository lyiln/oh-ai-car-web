#!/usr/bin/env python3
"""Minimal HTTPS client for device credential APIs (telemetry + patrol)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


class PlatformClient:
    def __init__(self, base_url: str | None = None, credential: str | None = None) -> None:
        self.base_url = (base_url or os.environ["PLATFORM_API_URL"]).rstrip("/")
        self.credential = credential or os.environ["DEVICE_CREDENTIAL"]
        self._auth = f"Bearer {self.credential}"

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        timeout: float = 15,
    ) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode()
        headers = {"authorization": self._auth}
        if data is not None:
            headers["content-type"] = "application/json"
        request = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                return json.loads(raw.decode()) if raw else {}
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"{method} {path} failed ({error.code}): {detail}") from error

    def claim_next_patrol_task(self) -> dict[str, Any] | None:
        payload = self._request("GET", "/device/v1/patrol/tasks/next")
        task = payload.get("task")
        return task if isinstance(task, dict) else None

    def post_patrol_event(self, task_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/device/v1/patrol/tasks/{task_id}/events", event)

    def post_telemetry(self, points: list[dict[str, Any]]) -> dict[str, Any]:
        return self._request("POST", "/device/v1/telemetry", {"points": points})

    def upload_evidence(self, jpeg_bytes: bytes, kind: str = "evidence") -> str:
        """Upload JPEG to host platform and return a browser-reachable /api/evidence/... URL."""
        import base64

        payload = self._request(
            "POST",
            "/device/v1/evidence",
            {
                "jpegBase64": base64.b64encode(jpeg_bytes).decode("ascii"),
                "kind": kind,
            },
            timeout=60,
        )
        url = payload.get("url")
        if not isinstance(url, str) or not url.strip():
            raise RuntimeError(f"Evidence upload missing url: {payload}")
        return url.strip()
