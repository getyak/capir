#!/usr/bin/env python3
"""Activate a prebuilt, committed Web release with launchd and rollback on failure."""
import json
import fcntl
import os
from pathlib import Path
import plistlib
import re
import signal
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


def run(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def bootstrap(domain, plist, target, check=True):
    # bootout can return before launchd finishes removing the old registration.
    # Retry only the transient EIO while this exact job is still absent.
    for attempt in range(5):
        result = run("launchctl", "bootstrap", domain, str(plist), check=False)
        if result.returncode != 5 or run("launchctl", "print", target, check=False).returncode == 0:
            break
        if attempt < 4:
            time.sleep(1)
    if check:
        result.check_returncode()
    return result


def bootout(target, check=True):
    result = run("launchctl", "bootout", target, check=check)
    # A job can remain registered in its terminating state after bootout returns.
    for _ in range(120):
        if run("launchctl", "print", target, check=False).returncode != 0:
            return result
        time.sleep(0.25)
    raise RuntimeError("Previous Web job did not finish unloading; refusing activation")


def listeners_belong_to(target):
    listeners = run("lsof", "-nP", "-t", "-iTCP:3000", "-sTCP:LISTEN", check=False).stdout.split()
    job = run("launchctl", "print", target, check=False)
    match = re.search(r"^\s*pid = (\d+)\s*$", job.stdout, re.MULTILINE)
    if not listeners or not match:
        return False
    owner = match.group(1)
    for listener in set(listeners):
        seen = set()
        while listener != owner:
            if listener in seen or listener in ("", "0", "1"):
                return False
            seen.add(listener)
            listener = run("ps", "-o", "ppid=", "-p", listener, check=False).stdout.strip()
    return True


def probe_auth_readiness(opener, target):
    """Return bounded categories only; never retain URLs, bodies or exception text."""
    try:
        with opener.open("http://127.0.0.1:3000/api/auth/providers", timeout=2) as response:
            status = response.status
            if status != 200:
                return {"state": "http_error", "http_status": status}
            body = response.read(65_537)
            if len(body) > 65_536:
                return {"state": "invalid_provider_payload", "http_status": status}
            providers = json.loads(body)
            if not isinstance(providers, dict):
                return {"state": "invalid_provider_payload", "http_status": status}
            if "password-account" not in providers:
                return {"state": "password_provider_missing", "http_status": status}
            if not listeners_belong_to(target):
                return {"state": "listener_not_owned", "http_status": status}
            return {"state": "ready", "http_status": status}
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        return {"state": "http_error", "http_status": status}
    except (TimeoutError, socket.timeout):
        return {"state": "timeout"}
    except urllib.error.URLError as error:
        return {"state": "timeout" if isinstance(error.reason, TimeoutError) else "transport_error"}
    except (ValueError, UnicodeError):
        return {"state": "invalid_provider_payload"}
    except OSError:
        return {"state": "transport_error"}


def wait_auth_readiness(opener, target, attempts=45):
    started = time.monotonic()
    counts = {}
    last = {"state": "not_probed"}
    for attempt in range(1, attempts + 1):
        last = probe_auth_readiness(opener, target)
        counts[last["state"]] = counts.get(last["state"], 0) + 1
        if last["state"] == "ready":
            break
        time.sleep(1)
    return {"ready": last["state"] == "ready", "attempts": attempt,
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "counts": counts, "last": last}


def process_group_exists(group):
    try:
        os.killpg(group, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def check_runtime_configuration(release, path, timeout_seconds=30, cleanup_timeout_seconds=5):
    """Fetch through the real launcher producer before changing the live job.

    Caller-injected secrets must not mask a revoked Keychain login: launchd
    receives PATH, not the installer's AUTH/INFISICAL/TALENT_SIGNAL values.
    Discard all child output rather than retaining credentials or error bodies.
    """
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(("AUTH_", "INFISICAL_", "TALENT_SIGNAL_"))
                   and key != "TS_WEB_INFISICAL_INJECTED"}
    environment["PATH"] = path
    started = time.monotonic()
    try:
        process = subprocess.Popen([str(release / "scripts/deploy/web-local.sh"), "check"],
                                   cwd=release, env=environment,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError:
        return {"ready": False, "state": "configuration_unavailable"}
    try:
        code = process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + cleanup_timeout_seconds
        while True:
            process.poll()  # Reap the leader, but do not mistake it for all descendants.
            if not process_group_exists(process.pid):
                return {"ready": False, "state": "configuration_timeout"}
            if time.monotonic() >= deadline:
                return {"ready": False, "state": "configuration_timeout", "cleanup_pending": True,
                        "owned_process_group": process.pid}
            time.sleep(0.05)
    return {"ready": code == 0, "state": "ready" if code == 0 else "configuration_unavailable",
            "exit_code": code, "elapsed_seconds": round(time.monotonic() - started, 3)}


def main():
    if sys.platform != "darwin" or len(sys.argv) != 2:
        raise SystemExit("Usage on macOS: install-web-launch-agent.py BUILT_RELEASE_ROOT")
    release = Path(sys.argv[1]).resolve(strict=True)
    if not (release / "apps/web/.next/BUILD_ID").is_file():
        raise SystemExit("Build the release before activation")
    if run("git", "-C", str(release), "status", "--porcelain").stdout:
        raise SystemExit("Use a clean committed release before activation")
    revision = run("git", "-C", str(release), "rev-parse", "HEAD").stdout.strip()
    receipt = json.loads((release / "apps/web/.next/talent-signal-release.json").read_text())
    build_id = (release / "apps/web/.next/BUILD_ID").read_text().strip()
    if receipt != {"revision": revision, "buildID": build_id}:
        raise SystemExit("Build receipt does not match the source revision and production build")
    home = Path.home()
    state = home / "Library/Application Support/Talent Signal/web"
    logs = home / "Library/Logs/Talent Signal/web"
    agents = home / "Library/LaunchAgents"
    for directory in (state, logs, agents):
        directory.mkdir(parents=True, exist_ok=True)
    state.chmod(0o700)
    logs.chmod(0o700)
    lock = (state / "install.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    current = state / "current"
    if current.exists() and not current.is_symlink():
        raise SystemExit("Refusing to replace a non-symlink current release")
    label = "com.talentsignal.web"
    domain = f"gui/{os.getuid()}"
    target = f"{domain}/{label}"
    plist = agents / f"{label}.plist"
    loaded = run("launchctl", "print", target, check=False).returncode == 0
    with socket.socket() as sock:
        if sock.connect_ex(("127.0.0.1", 3000)) == 0:
            if not loaded or not listeners_belong_to(target):
                raise SystemExit("Port 3000 belongs to another process; leave it running")
    old_release = os.readlink(current) if current.is_symlink() else None
    old_plist = plist.read_bytes() if plist.exists() else None
    binary_dirs = [str(Path(shutil.which(name) or name).resolve().parent)
                   for name in ("node", "pnpm", "infisical")]
    path = ":".join(dict.fromkeys(binary_dirs + [str(home / ".local/bin"),
                     "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]))
    preflight_path = state / "preflight-last.json"
    if preflight_path.exists():
        previous_preflight = json.loads(preflight_path.read_text())
        if previous_preflight.get("cleanup_pending"):
            group = previous_preflight.get("owned_process_group")
            if type(group) is not int or group <= 1 or process_group_exists(group):
                lock.close()
                raise RuntimeError("Previous runtime configuration probe cleanup is pending; existing service was left unchanged")
    preflight = check_runtime_configuration(release, path)
    preflight_path.write_text(json.dumps({"revision": revision, "buildID": build_id,
                                          **preflight}, indent=2) + "\n")
    preflight_path.chmod(0o600)
    if not preflight["ready"]:
        lock.close()
        raise RuntimeError("Web runtime configuration is unavailable; existing service and release were left unchanged")
    config = {
        "Label": label,
        "ProgramArguments": [str(current / "scripts/deploy/web-local.sh"), "start"],
        "WorkingDirectory": str(current),
        "EnvironmentVariables": {"PATH": path},
        "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 10,
        "StandardOutPath": str(logs / "stdout.log"),
        "StandardErrorPath": str(logs / "stderr.log"),
    }
    temporary = state / f"current-{os.getpid()}"
    try:
        if loaded:
            bootout(target)
        temporary.symlink_to(release, target_is_directory=True)
        temporary.replace(current)
        plist.write_bytes(plistlib.dumps(config))
        plist.chmod(0o600)
        bootstrap(domain, plist, target)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        readiness = wait_auth_readiness(opener, target)
        diagnostic = state / "readiness-last.json"
        diagnostic.write_text(json.dumps({"revision": revision, "buildID": build_id,
                                          **readiness}, indent=2) + "\n")
        diagnostic.chmod(0o600)
        if readiness["ready"]:
            (state / "active-release.json").write_text(json.dumps({
                "revision": revision, "buildID": build_id,
                "release": str(release), "port": 3000,
            }, indent=2) + "\n")
            print(f"Resident Web ready on port 3000 at revision {revision}")
            return
        last = readiness["last"]
        raise RuntimeError(f"Web authentication readiness failed: {last['state']} "
                           f"after {readiness['attempts']} probes; "
                           "inspect readiness-last.json and launchd logs")
    except BaseException:
        unload_error = None
        try:
            bootout(target, check=False)
        except Exception as error:
            unload_error = error
        current.unlink(missing_ok=True)
        if old_release:
            current.symlink_to(old_release, target_is_directory=True)
        if old_plist is not None:
            plist.write_bytes(old_plist)
            if loaded and unload_error is None:
                bootstrap(domain, plist, target, check=False)
        else:
            plist.unlink(missing_ok=True)
        if unload_error is not None:
            print(f"Restored previous release configuration, but the Web job could not unload: {unload_error}", file=sys.stderr)
        raise
    finally:
        temporary.unlink(missing_ok=True)
        lock.close()


if __name__ == "__main__":
    main()
