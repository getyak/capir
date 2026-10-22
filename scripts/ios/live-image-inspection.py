#!/usr/bin/env python3
"""Pause an opt-in native image test for local visual inspection.

Run with a private, registered artifact directory. Inspect selected-image.png,
then copy inspection-challenge.private to inspection-approved.private to allow
exactly that screenshot. Never approve an uninspected or personal image.
"""

import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import sys


def main():
    root = Path(sys.argv[1]).resolve(strict=True)
    if not root.is_dir():
        raise SystemExit("Expected an existing private artifact directory")
    nonce = secrets.token_hex(32)
    approved = root / "inspection-approved.private"
    challenge_path = root / "inspection-challenge.private"
    approved.unlink(missing_ok=True)
    challenge_path.unlink(missing_ok=True)
    challenge = None

    def private_write(path, data):
        with open(path, "wb", opener=lambda p, flags: os.open(p, flags, 0o600)) as output:
            output.write(data)
        path.chmod(0o600)

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def allowed(self):
            return self.path == "/image-inspection" and secrets.compare_digest(
                self.headers.get("X-IOS-Test-Nonce", ""), nonce
            )

        def reply(self, status, data):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())

        def do_POST(self):
            nonlocal challenge
            if not self.allowed():
                return self.reply(403, {})
            # Every upload invalidates any prior approval, including the same PNG.
            challenge = None
            approved.unlink(missing_ok=True)
            challenge_path.unlink(missing_ok=True)
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.reply(400, {})
            if not 0 < size < 5_000_000:
                return self.reply(413, {})
            data = self.rfile.read(size)
            if len(data) != size or not data.startswith(bytes.fromhex("89504e470d0a1a0a")):
                return self.reply(400, {})
            private_write(root / "selected-image.png", data)
            challenge = nonce + ":" + hashlib.sha256(data).hexdigest() + ":" + secrets.token_hex(16)
            private_write(challenge_path, challenge.encode())
            self.reply(200, {"confirmed": False})

        def do_GET(self):
            if not self.allowed():
                return self.reply(403, {})
            confirmed = challenge is not None and approved.exists() and secrets.compare_digest(
                approved.read_text(), challenge
            )
            self.reply(200, {"confirmed": confirmed})

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    server.timeout = 10
    private_write(root / "inspection-config.private.json", json.dumps({
        "url": f"http://127.0.0.1:{server.server_port}/image-inspection", "nonce": nonce
    }).encode())
    private_write(root / "inspection-server.pid", str(os.getpid()).encode())
    print("Loopback image inspection ready", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
