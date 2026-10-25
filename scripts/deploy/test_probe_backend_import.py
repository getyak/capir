"""Synthetic safety boundaries only: never invoke Docker, sudo, or mounts."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import os
import subprocess
import sys
import textwrap
import unittest
from unittest.mock import patch

SPEC = importlib.util.find_spec('probe_backend_import')
if SPEC:
    import probe_backend_import as probe


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(SPEC, 'disposable import probe is not implemented')
        self.env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                    'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'ARM64',
                    'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}

    def test_workflow_exact_double_label_gate_and_same_repository(self):
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/build-backend-image.yml').read_text()
        gate = textwrap.dedent(workflow.split("python3 - <<'PY'", 1)[1].split('\n          PY', 1)[0])
        cases = [
            (['backend-image'], 'owner/repo', 'pull_request', 'true', 'false'),
            (['backend-image', 'backend-import-probe'], 'owner/repo', 'pull_request', 'true', 'true'),
            (['backend-image', 'Backend-Import-Probe'], 'owner/repo', 'pull_request', 'true', 'false'),
            (['Backend-Image', 'backend-import-probe'], 'owner/repo', 'pull_request', 'false', 'false'),
            (['backend-image', 'backend-import-probe'], 'fork/repo', 'pull_request', 'false', 'false'),
            (['backend-import-probe'], 'owner/repo', 'pull_request', 'false', 'false'),
            ([], 'owner/repo', 'workflow_dispatch', 'true', 'false'),
        ]
        for labels, repo, event_name, built, imported in cases:
            with self.subTest(labels=labels, repo=repo, event=event_name), tempfile.TemporaryDirectory() as tmp:
                event = Path(tmp) / 'event.json'
                output = Path(tmp) / 'output'
                event.write_text(json.dumps({'pull_request': {'head': {'repo': {'full_name': repo}, 'sha': 'a' * 40},
                                         'labels': [{'name': label} for label in labels]}}))
                result = subprocess.run([sys.executable, '-c', gate], capture_output=True, text=True,
                    env={**os.environ, 'GITHUB_EVENT_PATH': str(event), 'GITHUB_OUTPUT': str(output),
                         'GITHUB_REPOSITORY': 'owner/repo', 'EVENT_NAME': event_name, 'EVENT_SOURCE_REVISION': 'b' * 40})
                self.assertEqual(result.returncode, 0, result.stderr)
                values = dict(line.split('=', 1) for line in output.read_text().splitlines())
                self.assertEqual(values['opted-in'], built)
                self.assertEqual(values['import-probe'], imported)

    def test_cli_refuses_local_execution_before_touching_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'proof'
            result = subprocess.run([sys.executable, str(Path(probe.__file__)), '/missing/archive.tar',
                '--revision', 'a' * 40, '--output', str(output), '--disposable-ci-opt-in'],
                capture_output=True, text=True, env={**os.environ, 'GITHUB_ACTIONS': 'false'})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('requires explicit disposable', result.stdout)
            self.assertFalse(output.exists())

    def test_cleanup_failure_cannot_be_reported_as_pass_or_detach_unowned_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            item = probe.Probe(Path(tmp) / 'archive', 'a' * 40, Path(tmp) / 'proof')
            item.report['status'] = 'passed'
            item.cid, item.owner, item.outer = 'a' * 64, 'backend-import-123-1-abc', ['docker']
            item.runner = FakeRunner({'Id': 'a' * 64, 'Config': {'Labels': {}}})
            item.mounted, item.loop = True, '/dev/loop7'
            item.cleanup()
            report = json.loads((item.output / 'proof.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertIn('failed', report['cleanup'])
            self.assertEqual(item.runner.removed, [])
            self.assertEqual(item.loop, '/dev/loop7')

    def test_local_and_self_hosted_never_reach_resource_creation(self):
        for key, value in [('GITHUB_ACTIONS', ''), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                           ('RUNNER_ARCH', 'X64'), ('GITHUB_RUN_ID', '../other')]:
            env = dict(self.env, **{key: value})
            with self.subTest(key=key), self.assertRaises(probe.ProbeError):
                probe.validate_environment(env, True, 'Linux', 'aarch64')
        with self.assertRaises(probe.ProbeError):
            probe.validate_environment(self.env, False, 'Linux', 'aarch64')
        probe.validate_environment(self.env, True, 'Linux', 'aarch64')

    def test_worker_cannot_add_a_host_socket_uncapped_volume_or_network(self):
        mounts = [{'Type': 'bind', 'Source': '/owned/fs' + suffix, 'Destination': dest, 'RW': True}
                  for suffix, dest in [('', '/proof'), ('/run', '/run'), ('/tmp', '/tmp'),
                                       ('/unused-docker', '/var/lib/docker'), ('/unused-containerd', '/var/lib/containerd')]]
        worker = {'Mounts': mounts, 'HostConfig': {'ReadonlyRootfs': True, 'NetworkMode': 'none',
                  'PortBindings': {}, 'LogConfig': {'Type': 'none'}, 'CgroupnsMode': 'private'},
                  'Config': {'Env': ['DOCKER_TMPDIR=/proof/tmp', 'TMPDIR=/proof/tmp']}}
        probe.validate_worker(worker, '/owned/fs')
        for mutation in ('socket', 'network', 'writable-root', 'cgroup', 'temp'):
            bad = copy.deepcopy(worker)
            if mutation == 'socket':
                bad['Mounts'].append({'Type': 'bind', 'Source': '/var/run/docker.sock',
                                     'Destination': '/var/run/docker.sock', 'RW': True})
            elif mutation == 'network':
                bad['HostConfig']['NetworkMode'] = 'host'
            elif mutation == 'cgroup':
                bad['HostConfig']['CgroupnsMode'] = 'host'
            elif mutation == 'writable-root':
                bad['HostConfig']['ReadonlyRootfs'] = False
            else:
                bad['Config']['Env'] = ['TMPDIR=/tmp']
            with self.subTest(mutation=mutation), self.assertRaises(probe.ProbeError):
                probe.validate_worker(bad, '/owned/fs')

    def test_uncertain_creation_never_attempts_cleanup_with_incomplete_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            item = probe.Probe(Path(tmp) / 'archive', 'a' * 40, Path(tmp) / 'proof')
            item.uncertain_resource = True
            item.cleanup()
            report = json.loads((item.output / 'proof.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertIn('unknown resources', report['cleanup'])

    def test_wrong_engine_or_snapshotter_rejected(self):
        version = {'Os': 'linux', 'Arch': 'arm64', 'Version': '29.5.2',
                   'Components': [{'Name': 'containerd', 'Version': 'v2.2.4'}]}
        info = {'OSType': 'linux', 'Architecture': 'aarch64', 'Driver': 'overlayfs',
                'DriverStatus': [['driver-type', 'io.containerd.snapshotter.v1']],
                'DockerRootDir': '/proof/docker'}
        probe.validate_engine(version, info)
        for field, value in [('Version', '28.0.4'), ('Arch', 'amd64')]:
            bad = dict(version, **{field: value})
            with self.assertRaises(probe.ProbeError):
                probe.validate_engine(bad, info)
        with self.assertRaises(probe.ProbeError):
            probe.validate_engine(version, dict(info, DriverStatus=[]))
        wrong_containerd = copy.deepcopy(version)
        wrong_containerd['Components'][0]['Version'] = '2.1.0'
        with self.assertRaises(probe.ProbeError):
            probe.validate_engine(wrong_containerd, info)

    def test_mount_flags_and_actual_device_must_match(self):
        good = {'target': '/tmp/owned/fs', 'source': '/dev/loop7', 'fstype': 'ext4',
                'options': 'rw,relatime'}
        probe.validate_mount(good, '/tmp/owned/fs', '/dev/loop7', 4096, 2147483648)
        for key, value in [('source', '/dev/sda1'), ('fstype', 'xfs'), ('options', 'rw,noatime')]:
            with self.assertRaises(probe.ProbeError):
                probe.validate_mount(dict(good, **{key: value}), '/tmp/owned/fs', '/dev/loop7', 4096, 2147483648)
        with self.assertRaises(probe.ProbeError):
            probe.validate_backing('/proof/docker', '/proof/docker', 9, 10)
        with self.assertRaises(probe.ProbeError):
            probe.validate_backing('/proof/docker', '/elsewhere', 10, 10)
        probe.validate_backing('/proof/docker', '/proof/docker', 10, 10)

    def test_source_hash_and_config_reinspection_fail_closed(self):
        actual = {'source_revision': 'a' * 40, 'platform': 'linux/arm64',
                  'oci_archive_sha256': 'b' * 64, 'image_config_digest': 'sha256:' + 'c' * 64,
                  'image_manifest_digest': 'sha256:' + 'd' * 64}
        probe.validate_artifact(actual, actual, 'a' * 40, 'b' * 64 + '  backend.oci.tar\n')
        for key in actual:
            bad = dict(actual, **{key: 'wrong'})
            with self.subTest(key=key), self.assertRaises(probe.ProbeError):
                probe.validate_artifact(actual, bad, 'a' * 40, 'b' * 64 + '  backend.oci.tar\n')
        with self.assertRaises(probe.ProbeError):
            probe.validate_artifact(actual, actual, 'a' * 40, 'e' * 64 + '  backend.oci.tar\n')

    def test_expected_optional_plugin_skip_is_not_a_daemon_error(self):
        benign = ('time="2026-10-26T08:00:00Z" level=info msg="skip loading plugin" '
                  'error="no scratch file generator: skip plugin" '
                  'id=io.containerd.snapshotter.v1.blockfile type=io.containerd.snapshotter.v1')
        probe.validate_logs(benign)
        # A known skip must not hide actual severity, required-overlayfs failure,
        # storage exhaustion, changed event identity or unrelated error fields.
        failures = [benign.replace('level=info', 'level=error'),
                    benign.replace('blockfile', 'overlayfs'),
                    benign.replace('no scratch file generator', 'no space left on device'),
                    benign.replace('no scratch file generator', 'ENOSPC'),
                    benign.replace('skip loading plugin', 'failed to load plugin'),
                    'level=info msg="unpack failed" error="write failed"',
                    'level=warning msg="failed to load plugin" error="permission denied"',
                    'Error processing tar file: unexpected EOF',
                    benign + '\nlevel=error msg="unpack failed"']
        for log in failures:
            with self.subTest(log=log), self.assertRaises(probe.ProbeError):
                probe.validate_logs(log)

    def test_dind_initialization_and_unix_only_daemon_are_in_actual_worker_command(self):
        item = probe.Probe(Path('/archive'), 'a' * 40, Path('/output'))
        item.outer, item.owner, item.fs = ['docker'], 'backend-import-123-1-abc', Path('/owned/fs')
        command = item.worker_command()
        self.assertIn('--cgroupns=private', command)
        self.assertNotIn('--cgroupns=host', command)
        script = command[command.index('-c') + 1]
        self.assertIn('exec /usr/local/bin/dind dockerd "$@"', script)
        self.assertEqual([x for x in command if x.startswith('--host=')],
                         ['--host=unix:///proof/docker.sock'])
        self.assertIn('--network=none', command)

    def test_actual_delegation_accepts_busybox_unknown_only_with_cgroup2_magic(self):
        item = probe.Probe(Path('/archive'), 'a' * 40, Path('/output'))
        item.outer, item.cid = ['docker'], 'a' * 64
        item.runner = DelegationRunner('63677270', 'UNKNOWN')
        with patch.object(probe.os, 'readlink', return_value='cgroup:[100]'):
            item.check_delegation()
        self.assertEqual(item.report['cgroup_filesystem']['statfs_type_hex'], '0x63677270')
        self.assertEqual(item.report['cgroup_filesystem']['statfs_type_label'], 'UNKNOWN')
        self.assertTrue(item.report['cgroup_delegation']['private_namespace_verified'])
        self.assertEqual(item.report['cgroup_delegation']['controllers_enabled'], ['cpu', 'memory', 'pids'])

    def test_actual_delegation_rejects_wrong_numeric_type_and_retains_observation(self):
        for magic, human, recorded in [('27e0eb', 'UNKNOWN', '0x27e0eb'),
                                       ('ef53', 'cgroup2fs', '0xef53'),
                                       ('UNKNOWN', 'UNKNOWN', None)]:
            with self.subTest(magic=magic):
                item = probe.Probe(Path('/archive'), 'a' * 40, Path('/output'))
                item.outer, item.cid = ['docker'], 'a' * 64
                item.runner = DelegationRunner(magic, human)
                with patch.object(probe.os, 'readlink', return_value='cgroup:[100]'), self.assertRaises(probe.ProbeError):
                    item.check_delegation()
                self.assertEqual(item.report['cgroup_filesystem']['statfs_type_hex'], recorded)
                self.assertNotIn('cgroup_delegation', item.report)
                self.assertEqual(item.runner.control_reads, [])

    def test_actual_delegation_still_rejects_shared_namespace_with_valid_magic(self):
        item = probe.Probe(Path('/archive'), 'a' * 40, Path('/output'))
        item.outer, item.cid = ['docker'], 'a' * 64
        item.runner = DelegationRunner('63677270', 'UNKNOWN')
        with patch.object(probe.os, 'readlink', return_value='cgroup:[200]'), self.assertRaises(probe.ProbeError):
            item.check_delegation()
        self.assertEqual(item.report['cgroup_filesystem']['statfs_type_hex'], '0x63677270')
        self.assertNotIn('cgroup_delegation', item.report)

    def test_cgroup_delegation_requires_private_namespace_and_all_runtime_controllers(self):
        probe.validate_delegation('cgroup:[100]', 'cgroup:[200]', 'cpu cpuset io memory pids',
                                  'cpu cpuset io memory pids', '0::/init\n')
        for host, worker, available, enabled, membership in [
            ('cgroup:[100]', 'cgroup:[100]', 'cpu memory pids', 'cpu memory pids', '0::/init'),
            ('cgroup:[100]', 'cgroup:[200]', 'cpu memory', 'cpu memory', '0::/init'),
            ('cgroup:[100]', 'cgroup:[200]', 'cpu memory pids', '', '0::/init'),
            ('cgroup:[100]', 'cgroup:[200]', 'cpu memory pids', 'cpu memory pids', '0::/'),
        ]:
            with self.subTest(enabled=enabled, membership=membership), self.assertRaises(probe.ProbeError):
                probe.validate_delegation(host, worker, available, enabled, membership)

    def test_load_zero_without_complete_unpack_is_rejected(self):
        good = 'REF TYPE DIGEST STATUS SIZE UNPACKED\nexample application/vnd.oci.image.manifest.v1+json sha256:abc complete (30/30) 1.2 GiB true\n'
        probe.validate_unpack(good, 1)
        for bad in [good.replace('complete (30/30)', 'incomplete (29/30)'),
                    good.replace(' true', ' false'), good.splitlines()[0], good + good.splitlines()[1] + '\n']:
            with self.subTest(bad=bad), self.assertRaises(probe.ProbeError):
                probe.validate_unpack(bad, 1)
        for log in ['Error unpacking image', 'level=error msg=failed', 'no space left on device', 'ENOSPC']:
            with self.assertRaises(probe.ProbeError):
                probe.validate_logs(log)

    def test_runtime_identity_rejects_wrong_source_and_config(self):
        artifact = {'image_config_digest': 'sha256:' + 'b' * 64, 'source_revision': 'a' * 40}
        image = {'Id': artifact['image_config_digest'], 'Os': 'linux', 'Architecture': 'arm64',
                 'Config': {'Labels': {'org.opencontainers.image.revision': 'a' * 40}}}
        probe.validate_image(image, artifact)
        with self.assertRaises(probe.ProbeError):
            probe.validate_image(dict(image, Id='sha256:' + 'c' * 64), artifact)
        image['Config']['Labels']['org.opencontainers.image.revision'] = 'd' * 40
        with self.assertRaises(probe.ProbeError):
            probe.validate_image(image, artifact)

    def test_cleanup_refuses_foreign_container_before_removal(self):
        runner = FakeRunner({'Id': 'a' * 64, 'Config': {'Labels': {'capir.import-probe.owner': 'foreign'}}})
        with self.assertRaises(probe.ProbeError):
            probe.remove_owned_container(runner, ['docker'], 'a' * 64, 'backend-import-123-1-abc')
        self.assertEqual(runner.removed, [])

    def test_cleanup_removes_only_exact_labeled_id(self):
        owner = 'backend-import-123-1-abc'
        runner = FakeRunner({'Id': 'a' * 64, 'Config': {'Labels': {'capir.import-probe.owner': owner}}})
        probe.remove_owned_container(runner, ['docker'], 'a' * 64, owner)
        self.assertEqual(runner.removed, ['a' * 64])

    def test_cleanup_refuses_foreign_loop_backing(self):
        with self.assertRaises(probe.ProbeError):
            probe.validate_loop({'loopdevices': [{'name': '/dev/loop7', 'back-file': '/tmp/other.img'}]}, '/dev/loop7', '/tmp/owned/disk.img')
        probe.validate_loop({'loopdevices': [{'name': '/dev/loop7', 'back-file': '/tmp/owned/disk.img'}]}, '/dev/loop7', '/tmp/owned/disk.img')


class DelegationRunner:
    """Only fixed read-only observations; no subprocess execution is possible."""
    def __init__(self, magic, human):
        self.magic, self.human = magic, human
        self.control_reads = []

    def run(self, argv, **kwargs):
        prefix = ['docker', 'exec', 'a' * 64]
        if argv == prefix + ['readlink', '/proc/1/ns/cgroup']:
            return 'cgroup:[200]\n'
        if argv == prefix + ['stat', '-f', '-c', '%T', '/sys/fs/cgroup']:
            return self.human + '\n'
        if argv == prefix + ['stat', '-f', '-c', '%t', '/sys/fs/cgroup']:
            return self.magic + '\n'
        reads = {'/sys/fs/cgroup/cgroup.controllers': 'cpu memory pids\n',
                 '/sys/fs/cgroup/cgroup.subtree_control': 'cpu memory pids\n',
                 '/proc/1/cgroup': '0::/init\n'}
        for path, value in reads.items():
            if argv == prefix + ['cat', path]:
                self.control_reads.append(path)
                return value
        raise AssertionError('unexpected command: ' + str(argv))


class FakeRunner:
    def __init__(self, container):
        self.container = container
        self.removed = []

    def run(self, argv, **kwargs):
        if argv[1:3] == ['container', 'inspect']:
            return json.dumps([self.container])
        if argv[1:4] == ['container', 'rm', '--force'] and argv[4:] == [self.container['Id']]:
            self.removed.append(argv[4])
            return argv[4]
        raise AssertionError('unexpected command: ' + str(argv))


if __name__ == '__main__':
    unittest.main()
