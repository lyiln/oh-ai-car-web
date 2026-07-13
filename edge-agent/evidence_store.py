#!/usr/bin/env python3
"""Save JPEG evidence locally and expose HTTP URLs for the platform."""
from __future__ import annotations

import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class EvidenceStore:
    def __init__(self, root: Path, public_base_url: str) -> None:
        self.root = root
        self.public_base_url = public_base_url.rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)

    def save_jpeg(self, data: bytes, prefix: str = "evidence") -> str:
        name = f"{prefix}-{uuid.uuid4().hex[:12]}.jpg"
        path = self.root / name
        path.write_bytes(data)
        return f"{self.public_base_url}/{name}"

    def start_server(self, host: str, port: int) -> ThreadingHTTPServer:
        root = self.root

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                name = Path(self.path.lstrip("/")).name
                file_path = root / name
                if not file_path.is_file() or file_path.parent.resolve() != root.resolve():
                    self.send_response(404)
                    self.end_headers()
                    return
                body = file_path.read_bytes()
                self.send_response(200)
                self.send_header("content-type", "image/jpeg")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _format: str, *_args: object) -> None:
                return

        server = ThreadingHTTPServer((host, port), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server


def default_store() -> EvidenceStore:
    root = Path(os.environ.get("EVIDENCE_DIR", "evidence-cache"))
    base = os.environ.get("EVIDENCE_PUBLIC_BASE_URL", "http://127.0.0.1:8089/evidence")
    return EvidenceStore(root, base)
