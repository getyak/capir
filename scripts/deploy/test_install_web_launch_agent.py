import importlib.util
import io
import json
import os
import plistlib
import shutil
import shlex
import signal
import subprocess
import tempfile
import time
from contextlib import ExitStack
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import urllib.error

spec = importlib.util.spec_from_file_location(
    "web_installer", Path(__file__).with_name("install-web-launch-agent.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class Response(io.BytesIO):
    status = 200


class ReadinessTests(unittest.TestCase):
    def probe(self, body=b'{"password-account":{}}', owned=True):
        opener = Mock()
        opener.open.return_value = Response(body)
        with patch.object(installer, "listeners_belong_to", return_value=owned) as owners:
            result = installer.probe_auth_readiness(opener, "test-job")
        return result, owners

    def test_password_provider_and_listener_ownership_are_both_required(self):
        self.assertEqual(self.probe()[0]["state"], "ready")
        self.assertEqual(self.probe(owned=False)[0]["state"], "listener_not_owned")
        missing, ownership = self.probe(b'{"google":{}}')
        self.assertEqual(missing["state"], "password_provider_missing")
        ownership.assert_not_called()

    def test_invalid_oversized_and_non_object_payloads_cannot_pass(self):
        for body in [b'not json', b'["password-account"]', b'null', b'\xff', b'x' * 65_537]:
            with self.subTest(body_size=len(body)):
                result, owners = self.probe(body)
                self.assertEqual(result["state"], "invalid_provider_payload")
                owners.assert_not_called()

    def test_response_read_is_bounded(self):
        response = Mock()
        response.status = 200
        response.read.return_value = b'{"password-account":{}}'
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        with patch.object(installer, "listeners_belong_to", return_value=True):
            self.assertEqual(installer.probe_auth_readiness(opener, "test")["state"], "ready")
        response.read.assert_called_once_with(65_537)

    def test_transport_and_http_failures_do_not_leak_error_body_or_url(self):
        secret = "PRIVATE_MARKER_MUST_NOT_BE_SAVED"
        errors = [
            (TimeoutError(secret), "timeout", None),
            (urllib.error.URLError(TimeoutError(secret)), "timeout", None),
            (urllib.error.URLError(secret), "transport_error", None),
            (ConnectionRefusedError(secret), "transport_error", None),
            (urllib.error.HTTPError("https://host/?token=" + secret, 503, secret, {},
                                    io.BytesIO(secret.encode())), "http_error", 503),
        ]
        for error, state, status in errors:
            with self.subTest(state=state):
                opener = Mock(); opener.open.side_effect = error
                report = installer.probe_auth_readiness(opener, "test")
                self.assertEqual(report["state"], state)
                self.assertEqual(report.get("http_status"), status)
                self.assertNotIn(secret, json.dumps(report))

    def test_transient_failure_history_is_bounded_and_success_stops_probing(self):
        outcomes = [{"state": "transport_error"}, {"state": "listener_not_owned", "http_status": 200},
                    {"state": "ready", "http_status": 200}]
        with patch.object(installer, "probe_auth_readiness", side_effect=outcomes) as probe, \
                patch.object(installer.time, "sleep"):
            report = installer.wait_auth_readiness(Mock(), "test")
        self.assertTrue(report["ready"])
        self.assertEqual(report["attempts"], 3)
        self.assertEqual(probe.call_count, 3)
        self.assertEqual(report["counts"], {"transport_error": 1, "listener_not_owned": 1, "ready": 1})

    def test_exhaustion_preserves_the_existing_45_probe_failure_gate(self):
        with patch.object(installer, "probe_auth_readiness", return_value={"state": "password_provider_missing"}) as probe, \
                patch.object(installer.time, "sleep"):
            report = installer.wait_auth_readiness(Mock(), "test")
        self.assertFalse(report["ready"])
        self.assertEqual(probe.call_count, 45)
        self.assertEqual(report["attempts"], 45)
        self.assertEqual(report["counts"], {"password_provider_missing": 45})


class CutoverCredentialTests(unittest.TestCase):
    def activation(self, credential_exit, pending=False):
        # Only launchd/Git metadata is simulated. The real checkout scripts
        # invoke a synthetic Infisical executable; no credentials or network.
        with tempfile.TemporaryDirectory(prefix="capri-cutover-fixture-") as directory:
            home = Path(directory).resolve()
            candidate = home / "candidate"; old = home / "old"; old.mkdir()
            binary = home / "bin"; binary.mkdir()
            state = home / "Library/Application Support/Talent Signal/web"; state.mkdir(parents=True)
            agents = home / "Library/LaunchAgents"; agents.mkdir(parents=True)
            current = state / "current"; current.symlink_to(old)
            plist = agents / "com.talentsignal.web.plist"
            old_plist = plistlib.dumps({"Label": "com.talentsignal.web", "fixture": "previous"})
            plist.write_bytes(old_plist)
            previous = {"revision": "a" * 40, "buildID": "old-fixture", "release": str(old), "port": 3000}
            (state / "active-release.json").write_text(json.dumps(previous))
            if pending:
                (state / "preflight-last.json").write_text(json.dumps({
                    "ready": False, "cleanup_pending": True, "owned_process_group": 987654321}))
            build = candidate / "apps/web/.next"; build.mkdir(parents=True)
            receipt = {"revision": "b" * 40, "buildID": "candidate-fixture"}
            (build / "BUILD_ID").write_text(receipt["buildID"])
            (build / "talent-signal-release.json").write_text(json.dumps(receipt))
            source_root = Path(__file__).resolve().parents[2]
            for relative in ["scripts/deploy/web-local.sh", "scripts/infisical/run.sh"]:
                target = candidate / relative; target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source_root / relative, target); target.chmod(0o700)
            invoked = home / "credential-check-invoked"
            real_node = shutil.which("node")
            self.assertIsNotNone(real_node)
            for name, body in {
                "node": "#!/bin/sh\nexec " + shlex.quote(real_node) + " \"$@\"\n",
                "pnpm": "#!/bin/sh\nexit 0\n",
                "tailscale": "#!/bin/sh\nprintf '%s\\n' " + shlex.quote(json.dumps({"BackendState": "Running", "Self": {"DNSName": "fixture.tail.ts.net."}})) + "\n",
                "infisical": '#!/bin/sh\ntouch "' + str(invoked) + '"\necho PRIVATE_CREDENTIAL_MARKER >&2\n' + (
                    'exit ' + str(credential_exit) + '\n' if credential_exit else
                    'while [ "$1" != "--" ]; do shift; done\nshift\nexport AUTH_SECRET=synthetic-only AUTH_URL=https://fixture.tail.ts.net:10443 TALENT_SIGNAL_BACKEND_URL=http://127.0.0.1:1\nexec "$@"\n')
            }.items():
                f = binary / name; f.write_text(body); f.chmod(0o700)
            events = []
            def metadata_run(*args, check=True, **kwargs):
                if args[:2] == ("git", "-C"):
                    out = receipt["revision"] + "\n" if args[-2:] == ("rev-parse", "HEAD") else ""
                    return subprocess.CompletedProcess(args, 0, out, "")
                if args[0] == "launchctl": return subprocess.CompletedProcess(args, 0, "pid = 9999\n", "")
                raise AssertionError("Unexpected metadata command: " + repr(args))
            def stop(*args, **kwargs):
                events.append("stop")
                self.assertTrue(invoked.exists(), "Fresh credential producer must run before stopping the old service")
            sock = Mock(); sock.__enter__ = Mock(return_value=sock); sock.__exit__ = Mock(return_value=False)
            sock.connect_ex.return_value = 0
            with ExitStack() as stack:
                stack.enter_context(patch.object(installer.Path, "home", return_value=home))
                stack.enter_context(patch.object(installer.sys, "platform", "darwin"))
                stack.enter_context(patch.object(installer.sys, "argv", ["installer", str(candidate)]))
                stack.enter_context(patch.object(installer, "run", side_effect=metadata_run))
                stack.enter_context(patch.object(installer, "bootout", side_effect=stop))
                bootstrap = stack.enter_context(patch.object(installer, "bootstrap"))
                stack.enter_context(patch.object(installer, "listeners_belong_to", return_value=True))
                stack.enter_context(patch.object(installer.socket, "socket", return_value=sock))
                stack.enter_context(patch.object(installer.shutil, "which", side_effect=lambda name: str(binary / name)))
                stack.enter_context(patch.object(installer, "wait_auth_readiness", return_value={"ready": True}))
                if pending:
                    stack.enter_context(patch.object(installer, "process_group_exists", return_value=True))
                stack.enter_context(patch.dict(os.environ, {
                    "TS_WEB_INFISICAL_INJECTED": "true", "AUTH_SECRET": "stale-caller-value",
                    "INFISICAL_TOKEN": "stale-caller-token"}))
                if credential_exit or pending:
                    with self.assertRaisesRegex(RuntimeError, "cleanup is pending" if pending else "runtime configuration"):
                        installer.main()
                    self.assertEqual(events, [])
                    bootstrap.assert_not_called()
                    self.assertEqual(current.resolve(), old)
                    self.assertEqual(plist.read_bytes(), old_plist)
                    self.assertEqual(json.loads((state / "active-release.json").read_text()), previous)
                    report = json.loads((state / "preflight-last.json").read_text())
                    self.assertFalse(report["ready"])
                    self.assertNotIn("PRIVATE_CREDENTIAL_MARKER", json.dumps(report))
                    if pending:
                        self.assertFalse(invoked.exists(), "Do not overlap a still-running previous probe")
                else:
                    installer.main()
                    self.assertEqual(events, ["stop"])
                    bootstrap.assert_called_once()
                    self.assertEqual(current.resolve(), candidate)
                    self.assertEqual(json.loads((state / "active-release.json").read_text())["revision"], receipt["revision"])

    def test_revoked_runtime_credentials_leave_existing_service_and_release_untouched(self):
        self.activation(43)

    def test_valid_runtime_credentials_are_checked_before_cutover(self):
        self.activation(0)

    def test_pending_probe_group_blocks_another_configuration_request(self):
        self.activation(0, pending=True)

    def test_configuration_timeout_terminates_only_its_own_probe_group(self):
        with tempfile.TemporaryDirectory(prefix="capri-probe-timeout-") as directory:
            root = Path(directory).resolve()
            script = root / "scripts/deploy/web-local.sh"
            script.parent.mkdir(parents=True)
            script.write_text('#!/bin/sh\nsleep 30\n')
            script.chmod(0o700)
            real_killpg = os.killpg
            real_popen = subprocess.Popen
            owned = []
            def start(*args, **kwargs):
                process = real_popen(*args, **kwargs)
                owned.append(process.pid)
                return process
            with patch.object(installer.subprocess, "Popen", side_effect=start), \
                    patch.object(installer.os, "killpg", wraps=real_killpg) as terminate:
                report = installer.check_runtime_configuration(root, "/usr/bin:/bin", timeout_seconds=0.2)
            self.assertFalse(report["ready"])
            self.assertEqual(report["state"], "configuration_timeout")
            self.assertNotIn("cleanup_pending", report)
            self.assertEqual(len(owned), 1)
            self.assertEqual([call.args for call in terminate.call_args_list if call.args[1] != 0],
                             [(owned[0], signal.SIGTERM)])

    def test_exited_probe_leader_does_not_hide_a_descendant_still_cleaning_up(self):
        with tempfile.TemporaryDirectory(prefix="capri-probe-descendant-") as directory:
            root = Path(directory).resolve()
            script = root / "scripts/deploy/web-local.sh"; script.parent.mkdir(parents=True)
            ready = root / "child-ready"
            child = ("import signal,time;from pathlib import Path\n"
                     "def stop(*_):\n time.sleep(0.8)\n raise SystemExit(0)\n"
                     "signal.signal(signal.SIGTERM,stop)\n"
                     "Path(" + repr(str(ready)) + ").write_text('ready')\n"
                     "time.sleep(30)\n")
            script.write_text('#!/bin/sh\n' + shlex.quote(installer.sys.executable) +
                              ' -c ' + shlex.quote(child) + ' &\nwait\n')
            script.chmod(0o700)
            real_popen = subprocess.Popen
            owned = []
            def start(*args, **kwargs):
                process = real_popen(*args, **kwargs); owned.append(process)
                deadline = time.monotonic() + 5
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), "Synthetic descendant must be ready before the timeout")
                return process
            try:
                with patch.object(installer.subprocess, "Popen", side_effect=start):
                    report = installer.check_runtime_configuration(
                        root, "/usr/bin:/bin", timeout_seconds=0.05, cleanup_timeout_seconds=0.1)
                self.assertFalse(report["ready"])
                self.assertTrue(report["cleanup_pending"])
                self.assertEqual(report["owned_process_group"], owned[0].pid)
                self.assertIsNotNone(owned[0].poll(), "The leader is gone while its descendant remains")
            finally:
                # The synthetic child handles TERM and exits naturally. Do not
                # use SIGKILL or touch any process outside this created group.
                if owned:
                    deadline = time.monotonic() + 5
                    while installer.process_group_exists(owned[0].pid) and time.monotonic() < deadline:
                        time.sleep(0.05)
                    self.assertFalse(installer.process_group_exists(owned[0].pid))


if __name__ == "__main__":
    unittest.main()
