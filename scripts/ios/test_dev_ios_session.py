#!/usr/bin/env python3
"""Focused tests for dev-ios-session.py.

Every simulator interaction is a subprocess fake placed first on PATH, so these
tests never create, boot, shut down, or inspect a real Simulator. The only real
external tools used are `shlock` (to prove actual two-process exclusion) and
`ps` (to prove real ancestor and process-group behavior).
"""

from __future__ import annotations

import json
import importlib.util
import os
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dev-ios-session.py")


class LifecycleRaceTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("dev_ios_lifecycle_test", SCRIPT)
        self.runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runner)

    def test_release_cannot_delete_successor_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = os.path.join(directory, "test.lock")
            metadata = self.runner.session_metadata_path(lock)
            with open(lock, "w") as handle:
                handle.write(str(os.getpid()))
            with open(metadata, "w") as handle:
                json.dump({"pid": os.getpid()}, handle)
            real_unlink = os.unlink

            def handoff(path):
                real_unlink(path)
                if path == lock:
                    with open(lock, "w") as handle:
                        handle.write(str(os.getpid() + 1))
                    with open(metadata, "w") as handle:
                        json.dump({"pid": os.getpid() + 1}, handle)

            with mock.patch.object(self.runner.os, "unlink", side_effect=handoff):
                self.runner.release_lock(lock)
            with open(metadata) as handle:
                self.assertEqual(json.load(handle)["pid"], os.getpid() + 1)

    def test_teardown_retains_lock_until_exit_is_known(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = os.path.join(directory, "test.lock")
            metadata = self.runner.session_metadata_path(lock)
            with open(lock, "w") as handle:
                handle.write(str(os.getpid()))
            with open(metadata, "w") as handle:
                json.dump({"pid": os.getpid()}, handle)
            snapshots = iter([[111], [111], self.runner.SessionError("ps unavailable"), [111], []])

            def inspect(_pgid):
                self.assertTrue(os.path.exists(lock))
                self.assertTrue(os.path.exists(metadata))
                result = next(snapshots)
                if isinstance(result, Exception):
                    raise result
                return result

            with mock.patch.object(self.runner, "process_group_members", side_effect=inspect) as inspection, \
                 mock.patch.object(self.runner, "signal_process_group") as sent, \
                 mock.patch.object(self.runner.time, "monotonic", side_effect=[0, 1, 100, 200, 300]), \
                 mock.patch.object(self.runner.time, "sleep"), \
                 mock.patch.object(self.runner, "log"):
                self.runner.teardown_process_group(111)
                self.assertEqual(inspection.call_count, 5)
                self.assertIn(mock.call(111, signal.SIGKILL), sent.call_args_list)
            self.runner.release_lock(lock)
            self.assertFalse(os.path.exists(lock))
            self.assertFalse(os.path.exists(metadata))

    def test_process_inspection_failures_are_not_empty_groups(self):
        for result in [OSError("unavailable"),
                       subprocess.CompletedProcess([], 1, stdout=""),
                       subprocess.CompletedProcess([], 0, stdout="not process data")]:
            with self.subTest(result=result):
                kwargs = {"side_effect": result} if isinstance(result, Exception) else {"return_value": result}
                with mock.patch.object(self.runner.subprocess, "run", **kwargs):
                    with self.assertRaises(self.runner.SessionError):
                        self.runner.process_group_members(111)
SHLOCK = "/usr/bin/shlock"

PRIMARY = "11111111-1111-1111-1111-111111111111"
COMPACT = "22222222-2222-2222-2222-222222222222"
IPAD = "33333333-3333-3333-3333-333333333333"
FORGED_PID = "2147483"
RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-26-5"

FAKE_XCRUN = """#!__PYTHON__
import json
import os
import sys

base = os.environ["FAKE_SIMCTL_DIR"]
args = sys.argv[1:]
with open(os.path.join(base, "xcrun.log"), "a", encoding="utf-8") as handle:
    handle.write(" ".join(args) + "\\n")


def read_devices():
    with open(os.path.join(base, "devices.json"), encoding="utf-8") as handle:
        return json.load(handle)


def write_devices(data):
    with open(os.path.join(base, "devices.json"), "w", encoding="utf-8") as handle:
        json.dump(data, handle)


if args[:4] == ["simctl", "list", "devices", "available"]:
    counter_path = os.path.join(base, "inventory.count")
    count = 0
    if os.path.exists(counter_path):
        with open(counter_path, encoding="utf-8") as handle:
            count = int(handle.read().strip() or "0")
    count += 1
    with open(counter_path, "w", encoding="utf-8") as handle:
        handle.write(str(count))
    fail_after = os.environ.get("FAKE_XCRUN_INVENTORY_FAIL_AFTER", "")
    if fail_after and count > int(fail_after):
        sys.stderr.write("fake inventory failure\\n")
        sys.exit(3)
    raw = os.environ.get("FAKE_XCRUN_INVENTORY_RAW")
    if raw is not None:
        print(raw)
        sys.exit(0)
    print(json.dumps(read_devices()))
    sys.exit(0)
if args[:2] == ["simctl", "shutdown"]:
    if os.environ.get("FAKE_XCRUN_SHUTDOWN_FAIL") == "1":
        sys.stderr.write("fake shutdown failure\\n")
        sys.exit(3)
    if os.environ.get("FAKE_XCRUN_SHUTDOWN_NOOP") != "1":
        data = read_devices()
        for entries in data.get("devices", {}).values():
            for device in entries:
                if device.get("udid") == args[2]:
                    device["state"] = "Shutdown"
        write_devices(data)
    sys.exit(0)
sys.stderr.write("unsupported xcrun invocation: " + " ".join(args) + "\\n")
sys.exit(2)
"""

FAKE_PGREP = """#!__PYTHON__
import os
import sys

raw = os.environ.get("FAKE_XCODEBUILD_PIDS", "").strip()
if raw:
    print("\\n".join(part.strip() for part in raw.split(",") if part.strip()))
    sys.exit(0)
sys.exit(1)
"""

SET_STATE = """#!__PYTHON__
import json
import os
import sys

path = os.path.join(os.environ["FAKE_SIMCTL_DIR"], "devices.json")
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)
for entries in data.get("devices", {}).values():
    for device in entries:
        if device.get("udid") == sys.argv[1]:
            device["state"] = "Booted"
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle)
"""

OWNER_DRIVER = """#!__PYTHON__
import json
import os
import subprocess
import sys

lock = os.environ["OWNER_LOCK"]
owner = os.getpid()
udid = os.environ["OWNER_DEVICE"]
profile = os.environ.get("OWNER_PROFILE", "primary")
session_id = os.environ.get("OWNER_SESSION_ID", "testsession")
with open(lock, "w", encoding="utf-8") as handle:
    handle.write(str(owner) + "\\n")
metadata = {
    "pid": owner,
    "lock_file": lock,
    "udid": udid,
    "profile": profile,
    "reason": os.environ.get("OWNER_REASON", ""),
    "session_id": session_id,
    "borrowed": os.environ.get("OWNER_BORROWED", "false") == "true",
}
temporary = lock + ".session.json.tmp"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump(metadata, handle)
os.replace(temporary, lock + ".session.json")

env = dict(os.environ)
env.update(
    {
        "IOS_AUTOMATION_LOCK_HELD": "true",
        "DEV_IOS_SESSION_PID": str(owner),
        "DEV_IOS_SESSION_ID": session_id,
        "IOS_AUTOMATION_LOCK_FILE": lock,
        "IOS_SIMULATOR_ID": os.environ.get("OWNER_CHILD_DEVICE") or udid,
        "DEV_IOS_PROFILE": os.environ.get("OWNER_CHILD_PROFILE") or profile,
        "DEV_IOS_REASON": os.environ.get("OWNER_CHILD_REASON", ""),
    }
)
result = subprocess.run(sys.argv[1:], env=env)
sys.exit(result.returncode)
"""

LOCK_HOLDER = """#!__PYTHON__
import json
import os
import time

lock = os.environ["OWNER_LOCK"]
owner = os.getpid()
metadata = {
    "pid": owner,
    "lock_file": lock,
    "udid": os.environ["OWNER_DEVICE"],
    "profile": os.environ.get("OWNER_PROFILE", "primary"),
    "reason": "",
    "session_id": os.environ.get("OWNER_SESSION_ID", "testsession"),
    "borrowed": False,
}
with open(lock, "w", encoding="utf-8") as handle:
    handle.write(str(owner) + "\\n")
time.sleep(float(os.environ.get("OWNER_METADATA_DELAY", "0")))
with open(lock + ".session.json", "w", encoding="utf-8") as handle:
    json.dump(metadata, handle)
print("ready", flush=True)
time.sleep(60)
"""

GRANDCHILD_LEADER = """#!__PYTHON__
import os
import subprocess
import sys
import time

grandchild_code = (
    "import os, pathlib, signal, time;"
    "signal.signal(signal.SIGTERM, lambda *_: pathlib.Path(os.environ['GRANDCHILD_TERM_MARKER']).touch());"
    "pathlib.Path(os.environ['GRANDCHILD_READY_MARKER']).write_text('ready');"
    "pathlib.Path(os.environ['GRANDCHILD_MARKER']).write_text('up');"
    "time.sleep(60)"
)
grandchild = subprocess.Popen([sys.executable, "-c", grandchild_code], env=os.environ)
deadline = time.monotonic() + 5
while not os.path.exists(os.environ["GRANDCHILD_READY_MARKER"]) and time.monotonic() < deadline:
    time.sleep(0.01)
if not os.path.exists(os.environ["GRANDCHILD_READY_MARKER"]):
    sys.exit(1)
with open(os.environ["GRANDCHILD_PID_FILE"], "w", encoding="utf-8") as handle:
    handle.write(str(grandchild.pid))
sys.exit(0)
"""


@unittest.skipUnless(os.path.exists(SHLOCK), "requires macOS /usr/bin/shlock")
class DevIOSSessionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.mkdtemp(prefix="dev-ios-session-test.")
        self.addCleanup(shutil.rmtree, self.temp, ignore_errors=True)
        self.bin_dir = os.path.join(self.temp, "bin")
        os.makedirs(self.bin_dir)
        self.allowlist = os.path.join(self.temp, "simulator-allowlist.tsv")
        self.lock_file = os.path.join(self.temp, "automation.lock")
        self.metadata_file = self.lock_file + ".session.json"
        self.devices_file = os.path.join(self.temp, "devices.json")
        self.xcrun_log = os.path.join(self.temp, "xcrun.log")
        self._write_executable("xcrun", FAKE_XCRUN)
        self._write_executable("pgrep", FAKE_PGREP)
        self.set_state_helper = self._write_executable("set_state.py", SET_STATE)
        self.owner_driver = self._write_executable("owner_driver.py", OWNER_DRIVER)
        self.lock_holder = self._write_executable("lock_holder.py", LOCK_HOLDER)
        self.grandchild_leader = self._write_executable("grandchild_leader.py", GRANDCHILD_LEADER)
        self.write_allowlist()
        self.write_devices()

    # -- fixture helpers ---------------------------------------------------

    def _write_executable(self, name, content):
        path = os.path.join(self.bin_dir, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content.replace("__PYTHON__", sys.executable))
        os.chmod(path, 0o755)
        return path

    def write_allowlist(self, entries=None):
        if entries is None:
            entries = [
                (PRIMARY, "Primary iPhone"),
                (COMPACT, "Compact iPhone"),
                (IPAD, "iPad"),
            ]
        with open(self.allowlist, "w", encoding="utf-8") as handle:
            for udid, label in entries:
                handle.write(f"{udid}\t{label}\n")

    def write_devices(self, states=None, omit=(), unavailable=(), omit_availability=()):
        states = states or {}
        specs = [
            (PRIMARY, "primary", "iPhone 17 Pro"),
            (COMPACT, "compact", "iPhone SE (3rd generation)"),
            (IPAD, "ipad", "iPad Pro 11-inch (M5)"),
        ]
        entries = []
        for udid, key, name in specs:
            if udid in omit:
                continue
            device = {
                "udid": udid,
                "name": name,
                "state": states.get(key, "Shutdown"),
            }
            if udid not in omit_availability:
                device["isAvailable"] = udid not in unavailable
            entries.append(device)
        payload = {"devices": {RUNTIME: entries}}
        with open(self.devices_file, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        with open(self.xcrun_log, "w", encoding="utf-8"):
            pass
        counter_path = os.path.join(self.temp, "inventory.count")
        if os.path.exists(counter_path):
            os.unlink(counter_path)

    def env(self, **overrides):
        env = dict(os.environ)
        env["PATH"] = self.bin_dir + os.pathsep + env.get("PATH", "")
        env["DEV_IOS_ALLOWLIST"] = self.allowlist
        env["IOS_AUTOMATION_LOCK_FILE"] = self.lock_file
        env["FAKE_SIMCTL_DIR"] = self.temp
        for key in (
            "DEV_IOS_PROFILE",
            "DEV_IOS_REASON",
            "IOS_SIMULATOR_ID",
            "SIMULATOR_UDID",
            "IOS_AUTOMATION_LOCK_HELD",
            "DEV_IOS_SESSION_PID",
            "DEV_IOS_SESSION_ID",
            "DEV_IOS_BORROWED",
            "FAKE_XCODEBUILD_PIDS",
            "FAKE_XCRUN_SHUTDOWN_FAIL",
            "FAKE_XCRUN_SHUTDOWN_NOOP",
            "FAKE_XCRUN_INVENTORY_FAIL_AFTER",
            "FAKE_XCRUN_INVENTORY_RAW",
        ):
            env.pop(key, None)
        for key, value in overrides.items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        return env

    def run_session(self, args, timeout=60, **overrides):
        return subprocess.run(
            [sys.executable, SCRIPT, *args],
            env=self.env(**overrides),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
        )

    def run_under_owner(self, command, timeout=60, **overrides):
        env = self.env(OWNER_LOCK=self.lock_file, **overrides)
        return subprocess.run(
            command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout
        )

    def xcrun_calls(self):
        if not os.path.exists(self.xcrun_log):
            return []
        with open(self.xcrun_log, encoding="utf-8") as handle:
            return [line.split() for line in handle if line.strip()]

    def lock_owner(self):
        try:
            with open(self.lock_file, encoding="utf-8") as handle:
                return handle.readline().strip()
        except OSError:
            return None

    def wait_until(self, predicate, deadline=15.0):
        end = time.monotonic() + deadline
        while time.monotonic() < end:
            if predicate():
                return True
            time.sleep(0.05)
        return False

    @staticmethod
    def close_process(process):
        for stream in (process.stdout, process.stderr):
            if stream is not None:
                stream.close()

    @staticmethod
    def process_exists(pid):
        completed = subprocess.run(
            ["ps", "-o", "stat=", "-p", str(pid)],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
        stat = completed.stdout.strip()
        return bool(stat) and not stat.startswith("Z")

    def shutdown_calls(self):
        return [call for call in self.xcrun_calls() if call[:2] == ["simctl", "shutdown"]]

    # -- selection ---------------------------------------------------------

    def test_select_primary_ignores_booted_secondary(self):
        self.write_devices({"compact": "Booted", "ipad": "Booted"})
        result = self.run_session(["select"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), PRIMARY)

    def test_secondary_profiles_require_reason(self):
        for profile, udid in (("compact", COMPACT), ("ipad", IPAD)):
            with self.subTest(profile=profile):
                denied = self.run_session(["select", "--profile", profile])
                self.assertEqual(denied.returncode, 2)
                self.assertIn("requires a nonempty", denied.stderr)
                allowed = self.run_session(["select", "--profile", profile, "--reason", "focused check"])
                self.assertEqual(allowed.returncode, 0, allowed.stderr)
                self.assertEqual(allowed.stdout.strip(), udid)

    def test_env_profile_and_reason_select_secondary(self):
        result = self.run_session(
            ["select"], DEV_IOS_PROFILE="ipad", DEV_IOS_REASON="iPad split-view check"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), IPAD)

        missing_reason = self.run_session(["select"], DEV_IOS_PROFILE="compact")
        self.assertEqual(missing_reason.returncode, 2)
        self.assertIn("requires a nonempty", missing_reason.stderr)

    def test_explicit_device_must_match_profile(self):
        by_flag = self.run_session(["select", "--profile", "primary", "--udid", COMPACT])
        self.assertEqual(by_flag.returncode, 2)
        self.assertIn("Unexpected device mismatch", by_flag.stderr)

        secondary = self.run_session(
            ["select", "--profile", "compact", "--udid", IPAD, "--reason", "x"]
        )
        self.assertEqual(secondary.returncode, 2)
        self.assertIn("Unexpected device mismatch", secondary.stderr)

        by_env = self.run_session(["select"], IOS_SIMULATOR_ID=COMPACT)
        self.assertEqual(by_env.returncode, 2)
        self.assertIn("Unexpected device mismatch", by_env.stderr)

    def test_select_is_read_only(self):
        result = self.run_session(["select"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(self.lock_owner())
        self.assertEqual(self.shutdown_calls(), [])

    def test_unknown_profile_fails(self):
        result = self.run_session(["select", "--profile", "watch"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("Unknown iOS session profile", result.stderr)

    def test_duplicate_allowlist_label_fails(self):
        self.write_allowlist([(PRIMARY, "Primary iPhone"), (IPAD, "Primary iPhone")])
        result = self.run_session(["select"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("Duplicate simulator allowlist label", result.stderr)

    def test_missing_allowlist_role_fails(self):
        self.write_allowlist([(PRIMARY, "Primary iPhone")])
        result = self.run_session(["select", "--profile", "ipad", "--reason", "x"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("no entry labelled", result.stderr)

    def test_missing_allowlist_file_fails(self):
        os.unlink(self.allowlist)
        result = self.run_session(["select"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("allowlist not found", result.stderr)

    def test_selected_device_must_be_available_on_ios(self):
        self.write_devices(omit=(PRIMARY,))
        missing = self.run_session(["select"])
        self.assertEqual(missing.returncode, 2)
        self.assertIn("not available on an iOS runtime", missing.stderr)

        self.write_devices(unavailable=(PRIMARY,))
        unavailable = self.run_session(["select"])
        self.assertEqual(unavailable.returncode, 2)
        self.assertIn("not available on an iOS runtime", unavailable.stderr)

    def test_missing_availability_field_is_not_available(self):
        self.write_devices(omit_availability=(PRIMARY,))
        result = self.run_session(["select"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("not available on an iOS runtime", result.stderr)

    def test_malformed_simctl_shape_fails_clearly(self):
        result = self.run_session(["select"], FAKE_XCRUN_INVENTORY_RAW='{"devices": "not-a-map"}')
        self.assertEqual(result.returncode, 2)
        self.assertIn("unexpected JSON shape", result.stderr)

    def test_allowlist_role_family_mismatch_fails(self):
        self.write_allowlist(
            [(IPAD, "Primary iPhone"), (COMPACT, "Compact iPhone"), (PRIMARY, "iPad")]
        )
        result = self.run_session(["select"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("Unexpected device mismatch", result.stderr)

    # -- run refusals and lifecycle ---------------------------------------

    def test_run_refuses_other_booted_device(self):
        self.write_devices({"compact": "Booted"})
        result = self.run_session(["run", "--timeout", "5", "--", "true"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("Refusing to start", result.stderr)
        self.assertIsNone(self.lock_owner())
        self.assertEqual(self.shutdown_calls(), [])

    def test_run_refuses_unrelated_xcodebuild(self):
        result = self.run_session(
            ["run", "--timeout", "5", "--", "true"], FAKE_XCODEBUILD_PIDS=FORGED_PID
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("unrelated xcodebuild", result.stderr)
        self.assertIsNone(self.lock_owner())

    def test_run_leaves_borrowed_device_running(self):
        self.write_devices({"primary": "Booted"})
        result = self.run_session(["run", "--timeout", "5", "--", "true"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Borrowed-device warning", result.stderr)
        self.assertEqual(self.shutdown_calls(), [])

    def test_run_shuts_down_device_it_booted(self):
        result = self.run_session(
            ["run", "--timeout", "5", "--", sys.executable, self.set_state_helper, PRIMARY]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.shutdown_calls(), [["simctl", "shutdown", PRIMARY]])
        boot_calls = [call for call in self.xcrun_calls() if call[:2] == ["simctl", "boot"]]
        self.assertEqual(boot_calls, [])
        for call in self.xcrun_calls():
            self.assertNotIn("all", call)

    def test_child_failure_exit_code_preserved_and_lock_released(self):
        result = self.run_session(
            ["run", "--timeout", "5", "--", sys.executable, "-c", "import sys; sys.exit(65)"]
        )
        self.assertEqual(result.returncode, 65)
        self.assertIsNone(self.lock_owner())

    def test_child_failure_still_shuts_down_owned_device(self):
        child = (
            "import subprocess, sys; "
            "subprocess.run([sys.executable, sys.argv[1], sys.argv[2]], check=True); "
            "sys.exit(65)"
        )
        result = self.run_session(
            ["run", "--timeout", "5", "--", sys.executable, "-c", child, self.set_state_helper, PRIMARY]
        )
        self.assertEqual(result.returncode, 65)
        self.assertEqual(self.shutdown_calls(), [["simctl", "shutdown", PRIMARY]])

    def test_run_exports_session_environment(self):
        keys = [
            "IOS_SIMULATOR_ID",
            "SIMULATOR_UDID",
            "DEV_IOS_SESSION_PID",
            "DEV_IOS_SESSION_ID",
            "DEV_IOS_PROFILE",
            "DEV_IOS_REASON",
            "DEV_IOS_BORROWED",
            "IOS_AUTOMATION_LOCK_FILE",
            "IOS_AUTOMATION_LOCK_HELD",
        ]
        code = "import json, os, sys; print(json.dumps({k: os.environ.get(k) for k in sys.argv[1:]}))"
        result = self.run_session(
            [
                "run",
                "--profile",
                "compact",
                "--reason",
                "keyboard",
                "--timeout",
                "5",
                "--",
                sys.executable,
                "-c",
                code,
                *keys,
            ]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(payload["IOS_SIMULATOR_ID"], COMPACT)
        self.assertEqual(payload["SIMULATOR_UDID"], COMPACT)
        self.assertEqual(payload["DEV_IOS_PROFILE"], "compact")
        self.assertEqual(payload["DEV_IOS_REASON"], "keyboard")
        self.assertEqual(payload["DEV_IOS_BORROWED"], "false")
        self.assertEqual(payload["IOS_AUTOMATION_LOCK_FILE"], self.lock_file)
        self.assertEqual(payload["IOS_AUTOMATION_LOCK_HELD"], "true")
        self.assertTrue(payload["DEV_IOS_SESSION_ID"].strip())
        self.assertTrue(payload["DEV_IOS_SESSION_PID"].strip().isdigit())

    # -- cleanup failure surfacing ----------------------------------------

    def test_shutdown_failure_is_reported_when_child_succeeds(self):
        result = self.run_session(
            ["run", "--timeout", "5", "--", sys.executable, self.set_state_helper, PRIMARY],
            FAKE_XCRUN_SHUTDOWN_FAIL="1",
        )
        self.assertEqual(result.returncode, 70, result.stderr)
        self.assertIn("cleanup failed", result.stderr)
        self.assertIn(PRIMARY, result.stderr)

    def test_shutdown_readback_failure_is_reported(self):
        result = self.run_session(
            ["run", "--timeout", "5", "--", sys.executable, self.set_state_helper, PRIMARY],
            FAKE_XCRUN_SHUTDOWN_NOOP="1",
        )
        self.assertEqual(result.returncode, 70, result.stderr)
        self.assertIn("did not take effect", result.stderr)

    def test_closeout_inventory_failure_is_reported(self):
        result = self.run_session(
            ["run", "--timeout", "5", "--", sys.executable, self.set_state_helper, PRIMARY],
            FAKE_XCRUN_INVENTORY_FAIL_AFTER="2",
        )
        self.assertEqual(result.returncode, 70, result.stderr)
        self.assertIn("could not verify simulator state", result.stderr)

    def test_child_failure_is_preserved_when_cleanup_also_fails(self):
        child = (
            "import subprocess, sys; "
            "subprocess.run([sys.executable, sys.argv[1], sys.argv[2]], check=True); "
            "sys.exit(65)"
        )
        result = self.run_session(
            ["run", "--timeout", "5", "--", sys.executable, "-c", child, self.set_state_helper, PRIMARY],
            FAKE_XCRUN_SHUTDOWN_FAIL="1",
        )
        self.assertEqual(result.returncode, 65)
        self.assertIn("cleanup failed", result.stderr)

    # -- lock behavior -----------------------------------------------------

    def test_two_process_lock_exclusion(self):
        first = subprocess.Popen(
            [
                sys.executable,
                SCRIPT,
                "run",
                "--timeout",
                "5",
                "--",
                sys.executable,
                "-c",
                "import time; time.sleep(30)",
            ],
            env=self.env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            self.assertTrue(self.wait_until(lambda: self.lock_owner() == str(first.pid)))
            second = self.run_session(["run", "--timeout", "1", "--", "true"])
            self.assertEqual(second.returncode, 75, second.stderr)
            self.assertIn("Timed out", second.stderr)
        finally:
            first.send_signal(signal.SIGTERM)
            try:
                first.wait(timeout=20)
            except subprocess.TimeoutExpired:
                first.kill()
                first.wait(timeout=10)
            self.close_process(first)
        self.assertIsNone(self.lock_owner())
        self.assertFalse(os.path.exists(self.metadata_file))

    def test_stale_lock_is_reclaimed(self):
        with open(self.lock_file, "w", encoding="utf-8") as handle:
            handle.write("999999\n")
        # shlock only reclaims a lock file older than its current ctime second.
        time.sleep(1.3)
        result = self.run_session(["run", "--timeout", "5", "--", "true"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(self.lock_owner())

    def test_legacy_lock_without_metadata_is_not_treated_as_a_session(self):
        # A foreign shlock holder without owned metadata must never be mistaken
        # for a valid session, must not have its lock released, and must not have
        # metadata invented for it.
        holder = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"], env=self.env()
        )
        try:
            with open(self.lock_file, "w", encoding="utf-8") as handle:
                handle.write(str(holder.pid) + "\n")
            is_owner = self.run_session(["is-owner", "--profile", "primary"])
            self.assertEqual(is_owner.returncode, 1)
            self.assertEqual(is_owner.stdout.strip(), "false")
            run = self.run_session(
                ["run", "--timeout", "30", "--", "true"],
                IOS_AUTOMATION_LOCK_HELD="true",
                DEV_IOS_SESSION_PID=str(holder.pid),
                DEV_IOS_SESSION_ID="legacy",
                IOS_SIMULATOR_ID=PRIMARY,
                DEV_IOS_PROFILE="primary",
            )
            self.assertEqual(run.returncode, 2, run.stderr)
            self.assertEqual(self.lock_owner(), str(holder.pid))
            self.assertFalse(os.path.exists(self.metadata_file))
        finally:
            holder.terminate()
            holder.wait(timeout=10)

    def test_signal_during_lock_wait_exits_without_deadlock(self):
        holder = subprocess.Popen(
            [
                sys.executable,
                SCRIPT,
                "run",
                "--timeout",
                "5",
                "--",
                sys.executable,
                "-c",
                "import time; time.sleep(30)",
            ],
            env=self.env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        waiter = None
        try:
            self.assertTrue(self.wait_until(lambda: self.lock_owner() == str(holder.pid)))
            waiter = subprocess.Popen(
                [sys.executable, SCRIPT, "run", "--timeout", "30", "--", "true"],
                env=self.env(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            time.sleep(0.7)
            waiter.send_signal(signal.SIGTERM)
            self.assertEqual(waiter.wait(timeout=15), 143)
            self.assertEqual(self.lock_owner(), str(holder.pid))
        finally:
            if waiter is not None:
                if waiter.poll() is None:
                    waiter.kill()
                    waiter.wait(timeout=10)
                self.close_process(waiter)
            holder.send_signal(signal.SIGTERM)
            try:
                holder.wait(timeout=20)
            except subprocess.TimeoutExpired:
                holder.kill()
                holder.wait(timeout=10)
            self.close_process(holder)

    def test_signal_cleanup_releases_lock(self):
        marker = os.path.join(self.temp, "child-started")
        child = (
            "import os, pathlib, time; "
            "pathlib.Path(os.environ['CHILD_MARKER']).write_text('started'); "
            "time.sleep(30)"
        )
        process = subprocess.Popen(
            [sys.executable, SCRIPT, "run", "--timeout", "5", "--", sys.executable, "-c", child],
            env=self.env(CHILD_MARKER=marker),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            self.assertTrue(self.wait_until(lambda: os.path.exists(marker)))
            time.sleep(0.3)
            process.send_signal(signal.SIGTERM)
            returncode = process.wait(timeout=20)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)
            self.close_process(process)
        self.assertEqual(returncode, 143)
        self.assertIsNone(self.lock_owner())
        self.assertEqual(self.shutdown_calls(), [])

    def test_grandchild_teardown_keeps_lock_until_group_empty(self):
        marker = os.path.join(self.temp, "grandchild-marker")
        ready_marker = os.path.join(self.temp, "grandchild-ready-marker")
        term_marker = os.path.join(self.temp, "grandchild-term-marker")
        pid_file = os.path.join(self.temp, "grandchild.pid")
        first = subprocess.Popen(
            [
                sys.executable,
                SCRIPT,
                "run",
                "--timeout",
                "5",
                "--",
                sys.executable,
                self.grandchild_leader,
            ],
            env=self.env(
                GRANDCHILD_MARKER=marker,
                GRANDCHILD_READY_MARKER=ready_marker,
                GRANDCHILD_TERM_MARKER=term_marker,
                GRANDCHILD_PID_FILE=pid_file,
            ),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            self.assertTrue(self.wait_until(lambda: os.path.exists(pid_file)))
            with open(pid_file, encoding="utf-8") as handle:
                grandchild_pid = int(handle.read().strip())
            # Wait until teardown has signaled the lingering descendant and
            # confirmed it is still alive. The marker removes a scheduler race
            # where a fast runner could let the leader exit after the lock
            # assertion was already satisfied.
            self.assertTrue(self.wait_until(lambda: os.path.exists(term_marker)))
            self.assertTrue(self.process_exists(grandchild_pid))
            second = self.run_session(["run", "--timeout", "1", "--", "true"], timeout=30)
            self.assertEqual(second.returncode, 75, second.stderr)
            self.assertEqual(first.wait(timeout=60), 0)
            self.assertFalse(self.process_exists(grandchild_pid), "grandchild survived teardown")
            self.assertIsNone(self.lock_owner())
        finally:
            if first.poll() is None:
                first.kill()
                first.wait(timeout=10)
            self.close_process(first)

    # -- nested session ownership -----------------------------------------

    def test_top_level_compact_run_exports_reason_for_nested_is_owner(self):
        # Mirrors check.sh: a compact session's child rebuilds the is-owner call
        # from DEV_IOS_REASON, so the wrapper must export the normalized reason.
        child = (
            "import os, subprocess, sys;"
            " reason = os.environ.get('DEV_IOS_REASON', '');"
            " args = [sys.executable, sys.argv[1], 'is-owner', '--profile', 'compact'];"
            " args += ['--reason', reason] if reason else [];"
            " sys.exit(subprocess.run(args).returncode)"
        )
        result = self.run_session(
            [
                "run",
                "--profile",
                "compact",
                "--reason",
                "keyboard",
                "--timeout",
                "5",
                "--",
                sys.executable,
                "-c",
                child,
                SCRIPT,
            ]
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_nested_is_owner_accepts_reason_supplied_only_on_cli(self):
        result = self.run_under_owner(
            [
                sys.executable,
                self.owner_driver,
                sys.executable,
                SCRIPT,
                "is-owner",
                "--profile",
                "compact",
                "--udid",
                COMPACT,
                "--reason",
                "keyboard",
            ],
            OWNER_DEVICE=COMPACT,
            OWNER_PROFILE="compact",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "true")

    def test_nested_run_reuses_owner_lock_without_releasing_it(self):
        marker = os.path.join(self.temp, "nested-marker")
        child = "import os, pathlib; pathlib.Path(os.environ['NESTED_MARKER']).write_text('ran')"
        result = self.run_under_owner(
            [
                sys.executable,
                self.owner_driver,
                sys.executable,
                SCRIPT,
                "run",
                "--",
                sys.executable,
                "-c",
                child,
            ],
            OWNER_DEVICE=PRIMARY,
            OWNER_PROFILE="primary",
            NESTED_MARKER=marker,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Joining the active iOS session", result.stderr)
        self.assertTrue(os.path.exists(marker))
        self.assertIsNotNone(self.lock_owner())

    def test_nested_run_rejects_device_change_via_cli(self):
        marker = os.path.join(self.temp, "nested-should-not-run")
        child = "import os, pathlib; pathlib.Path(os.environ['NESTED_MARKER']).write_text('ran')"
        result = self.run_under_owner(
            [
                sys.executable,
                self.owner_driver,
                sys.executable,
                SCRIPT,
                "run",
                "--profile",
                "compact",
                "--udid",
                COMPACT,
                "--reason",
                "attempt device change",
                "--",
                sys.executable,
                "-c",
                child,
            ],
            OWNER_DEVICE=PRIMARY,
            OWNER_PROFILE="primary",
            NESTED_MARKER=marker,
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("does not match the active session", result.stderr)
        self.assertFalse(os.path.exists(marker))

    def test_nested_run_rejects_changed_id_profile_and_reason_together(self):
        marker = os.path.join(self.temp, "nested-should-not-run")
        child = "import os, pathlib; pathlib.Path(os.environ['NESTED_MARKER']).write_text('ran')"
        started = time.monotonic()
        result = self.run_under_owner(
            [
                sys.executable,
                self.owner_driver,
                sys.executable,
                SCRIPT,
                "run",
                "--",
                sys.executable,
                "-c",
                child,
            ],
            OWNER_DEVICE=PRIMARY,
            OWNER_PROFILE="primary",
            OWNER_CHILD_DEVICE=COMPACT,
            OWNER_CHILD_PROFILE="compact",
            OWNER_CHILD_REASON="changed together",
            NESTED_MARKER=marker,
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("does not match the active session", result.stderr)
        self.assertFalse(os.path.exists(marker))
        # An inconsistent nested session must fail rather than wait on its own lock.
        self.assertLess(time.monotonic() - started, 10.0)

    def test_copied_forged_session_env_is_rejected_without_waiting(self):
        holder = subprocess.Popen(
            [sys.executable, self.lock_holder],
            env=self.env(OWNER_LOCK=self.lock_file, OWNER_DEVICE=PRIMARY, OWNER_PROFILE="primary", OWNER_METADATA_DELAY="0.2"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            # The lock is written before the metadata. Wait for the fixture's
            # explicit post-metadata barrier instead of racing that gap.
            ready, _, _ = select.select([holder.stdout], [], [], 15.0)
            self.assertTrue(ready, "lock holder did not become ready")
            self.assertEqual(holder.stdout.readline().strip(), "ready")
            owner = self.lock_owner()
            with open(self.metadata_file, encoding="utf-8") as handle:
                session_id = json.load(handle)["session_id"]
            started = time.monotonic()
            result = self.run_session(
                ["run", "--profile", "primary", "--timeout", "30", "--", "true"],
                IOS_AUTOMATION_LOCK_HELD="true",
                DEV_IOS_SESSION_PID=owner,
                DEV_IOS_SESSION_ID=session_id,
                IOS_SIMULATOR_ID=PRIMARY,
                DEV_IOS_PROFILE="primary",
            )
            elapsed = time.monotonic() - started
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn("metadata is missing or inconsistent", result.stderr)
            self.assertLess(elapsed, 10.0)
            self.assertEqual(self.lock_owner(), owner)
        finally:
            holder.terminate()
            holder.wait(timeout=10)
            self.close_process(holder)

    def test_is_owner_true_inside_owned_session(self):
        result = self.run_under_owner(
            [sys.executable, self.owner_driver, sys.executable, SCRIPT, "is-owner", "--profile", "primary"],
            OWNER_DEVICE=PRIMARY,
            OWNER_PROFILE="primary",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "true")

    def test_is_owner_false_outside_session(self):
        result = self.run_session(["is-owner", "--profile", "primary"])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.strip(), "false")

    def test_is_owner_false_for_forged_pid(self):
        result = self.run_session(
            ["is-owner", "--profile", "primary"],
            IOS_AUTOMATION_LOCK_HELD="true",
            DEV_IOS_SESSION_PID=FORGED_PID,
            DEV_IOS_SESSION_ID="forged",
            IOS_SIMULATOR_ID=PRIMARY,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.strip(), "false")

    # -- CLI contract ------------------------------------------------------

    def test_run_requires_command_after_separator(self):
        result = self.run_session(["run"])
        self.assertEqual(result.returncode, 64)
        self.assertIn("requires an explicit command", result.stderr)

    def test_timeout_must_be_integer(self):
        result = self.run_session(["run", "--timeout", "abc", "--", "true"])
        self.assertEqual(result.returncode, 64)
        self.assertIn("--timeout must be an integer", result.stderr)


if __name__ == "__main__":
    unittest.main()
