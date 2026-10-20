import importlib.util
import io
import json
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


if __name__ == "__main__":
    unittest.main()
