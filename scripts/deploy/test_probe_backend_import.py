"""Synthetic safety boundaries only: never invoke Docker, sudo, or mounts."""
import copy
import hashlib
import io
import struct
import tarfile
from contextlib import ExitStack
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

    def test_official_runtime_staging_checks_archive_before_extracting(self):
        raw, specs = runtime_fixture()
        with tempfile.TemporaryDirectory() as tmp, runtime_inputs(raw, specs):
            result = probe.prepare_runtime_tools(Path(tmp))
            folder = Path(tmp) / 'runtime-tools'
            self.assertEqual(sorted(x.name for x in folder.iterdir()), ['containerd', 'containerd-shim-runc-v2', 'ctr'])
            self.assertEqual(result['binary_bytes'], sum(item['bytes'] for item in specs.values()))
            self.assertEqual((folder / 'containerd').stat().st_mode & 0o777, 0o555)
        for body in (raw + b'x', raw[:-1], bytes([raw[0] ^ 1]) + raw[1:]):
            with self.subTest(length=len(body)), tempfile.TemporaryDirectory() as tmp, runtime_inputs(raw, specs, body=body):
                with self.assertRaises(probe.ProbeError):
                    probe.prepare_runtime_tools(Path(tmp))
                self.assertFalse((Path(tmp) / 'runtime-tools/containerd').exists())

    def test_runtime_package_rejects_unexpected_members_links_and_wrong_elf(self):
        for change in ('unexpected-name', 'link', 'hardlink', 'duplicate', 'missing', 'wrong-arch', 'dynamic'):
            raw, specs = runtime_fixture(change)
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp, runtime_inputs(raw, specs):
                with self.assertRaises(probe.ProbeError):
                    probe.prepare_runtime_tools(Path(tmp))
        raw, specs = runtime_fixture()
        bad_specs = copy.deepcopy(specs)
        bad_specs['ctr']['sha256'] = '0' * 64
        with tempfile.TemporaryDirectory() as tmp, runtime_inputs(raw, bad_specs):
            with self.assertRaises(probe.ProbeError):
                probe.prepare_runtime_tools(Path(tmp))

    def test_runtime_package_rejects_untrusted_redirect_and_preexisting_output(self):
        raw, specs = runtime_fixture()
        with tempfile.TemporaryDirectory() as tmp, runtime_inputs(raw, specs, final_url='https://untrusted.invalid/package'):
            with self.assertRaises(probe.ProbeError):
                probe.prepare_runtime_tools(Path(tmp))
        with tempfile.TemporaryDirectory() as tmp, runtime_inputs(raw, specs):
            (Path(tmp) / 'runtime-tools').mkdir()
            (Path(tmp) / 'runtime-tools/containerd').write_text('preserve existing')
            with self.assertRaises((probe.ProbeError, FileExistsError)):
                probe.prepare_runtime_tools(Path(tmp))
            self.assertEqual((Path(tmp) / 'runtime-tools/containerd').read_text(), 'preserve existing')

    def test_actual_engine_failure_retains_observed_versions_without_private_details(self):
        item = probe.Probe(Path('/archive'), 'a' * 40, Path('/output'))
        version = {'Version': '29.5.2', 'GitCommit': '568f755', 'Os': 'linux', 'Arch': 'arm64',
                   'Components': [{'Name': 'containerd', 'Version': 'v2.2.3',
                    'Details': {'GitCommit': '77c84241c7cbdd9b4eca2591793e3d4f4317c590', 'Secret': 'DO_NOT_RETAIN'}}]}
        info = {'OSType': 'linux', 'Architecture': 'aarch64', 'Driver': 'overlayfs',
                'DriverStatus': [['driver-type', 'io.containerd.snapshotter.v1']], 'DockerRootDir': '/proof/docker'}
        with self.assertRaises(probe.ProbeError):
            item.check_engine(version, info)
        self.assertEqual(item.report['engine']['containerd'], 'v2.2.3')
        self.assertEqual(item.report['engine']['containerd_commit'], '77c84241c7cbdd9b4eca2591793e3d4f4317c590')
        self.assertEqual(item.report['engine']['driver'], 'overlayfs')
        self.assertFalse(item.report['engine']['validated'])
        self.assertNotIn('DO_NOT_RETAIN', json.dumps(item.report))
        version['Components'][0]['Version'] = 'v2.2.4'
        with self.assertRaises(probe.ProbeError):
            item.check_engine(version, info)
        version['Components'][0]['Details']['GitCommit'] = '193637f7ee8ae5f5aa5248f49e7baa3e6164966e'
        item.check_engine(version, info)
        self.assertTrue(item.report['engine']['validated'])
        version['Version'] = '29.5.2\nDO_NOT_RETAIN'
        with self.assertRaises(probe.ProbeError):
            item.check_engine(version, info)
        self.assertIsNone(item.report['engine']['docker'])
        self.assertNotIn('DO_NOT_RETAIN', json.dumps(item.report))

    def test_actual_runtime_hash_check_rejects_wrong_bound_file_or_running_process(self):
        for corrupt in ('file', 'process', None):
            item = probe.Probe(Path('/archive'), 'a' * 40, Path('/output'))
            item.outer, item.cid = ['docker'], 'a' * 64
            item.runner = RuntimeHashRunner(corrupt)
            if corrupt:
                with self.subTest(corrupt=corrupt), self.assertRaises(probe.ProbeError):
                    item.check_runtime_tools()
            else:
                item.check_runtime_tools()
                self.assertTrue(item.report['runtime_tools_verified'])

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
        mounts += [{'Type': 'bind', 'Source': '/owned/runtime-tools/' + name,
                    'Destination': '/usr/local/bin/' + name, 'RW': False}
                   for name in ('containerd', 'containerd-shim-runc-v2', 'ctr')]
        worker = {'Mounts': mounts, 'HostConfig': {'ReadonlyRootfs': True, 'NetworkMode': 'none',
                  'PortBindings': {}, 'LogConfig': {'Type': 'none'}, 'CgroupnsMode': 'private'},
                  'Config': {'Env': ['DOCKER_TMPDIR=/proof/tmp', 'TMPDIR=/proof/tmp']}}
        probe.validate_worker(worker, '/owned/fs')
        for mutation in ('socket', 'network', 'writable-root', 'cgroup', 'runtime-write', 'runtime-source', 'temp'):
            bad = copy.deepcopy(worker)
            if mutation == 'socket':
                bad['Mounts'].append({'Type': 'bind', 'Source': '/var/run/docker.sock',
                                     'Destination': '/var/run/docker.sock', 'RW': True})
            elif mutation == 'network':
                bad['HostConfig']['NetworkMode'] = 'host'
            elif mutation == 'runtime-write':
                bad['Mounts'][-1]['RW'] = True
            elif mutation == 'runtime-source':
                bad['Mounts'][-1]['Source'] = '/other/ctr'
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
                   'Components': [{'Name': 'containerd', 'Version': 'v2.2.4',
                                   'Details': {'GitCommit': '193637f7ee8ae5f5aa5248f49e7baa3e6164966e'}}]}
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
        runtime_mounts = [value for value in command if ',dst=/usr/local/bin/' in value]
        self.assertEqual(set(runtime_mounts), {
            'type=bind,src=/owned/runtime-tools/containerd,dst=/usr/local/bin/containerd,readonly',
            'type=bind,src=/owned/runtime-tools/containerd-shim-runc-v2,dst=/usr/local/bin/containerd-shim-runc-v2,readonly',
            'type=bind,src=/owned/runtime-tools/ctr,dst=/usr/local/bin/ctr,readonly'})

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
        fixture = ImageIdentityFixture()
        artifact, image = fixture.artifact, fixture.image
        probe.validate_image(image, artifact)
        with self.assertRaises(probe.ProbeError):
            probe.validate_image(dict(image, Id=artifact['image_config_digest']), artifact)
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


@unittest.skipUnless(importlib.util.find_spec('tomllib'), 'path checks require the CI Python 3.11+ TOML reader')
class PathProbeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.item = probe.Probe(Path('/archive'), 'a' * 40, Path(temporary.name) / 'output')
        self.item.fs = Path(temporary.name) / 'fs'
        self.item.outer, self.item.cid = ['docker'], 'a' * 64
        self.item.report['phase'] = 'nested-engine-startup'
        self.item.runner = PathRunner(self.item.fs)

    def test_actual_startup_defers_only_lazy_content_then_requires_post_import_backing(self):
        # Pinned containerd's NewStore has not created this directory yet.
        self.item.check_paths()
        self.assertIsNone(self.item.report['credited_paths']['content_and_ingest'])
        self.assertTrue(self.item.report['lazy_content_path']['initially_absent'])
        self.assertTrue(self.item.report['lazy_content_path']['parent_verified'])
        self.assertFalse(self.item.report['lazy_content_path']['post_import_verified'])
        self.item.report['phase'] = 'idle-stabilization'
        with self.assertRaises(probe.ProbeError):
            self.item.check_paths()
        self.item.runner.local(PathRunner.CONTENT).mkdir()
        self.item.check_paths()
        self.assertEqual(self.item.report['credited_paths']['content_and_ingest'], PathRunner.CONTENT)
        self.assertTrue(self.item.report['lazy_content_path']['post_import_verified'])

    def test_actual_startup_rejects_missing_required_plugin_and_retains_safe_path_role(self):
        self.item.runner.local(PathRunner.OVERLAY).rmdir()
        with self.assertRaises(probe.ProbeError):
            self.item.check_paths()
        self.assertEqual(self.item.report['path_check']['role'], 'snapshots')
        self.assertEqual(self.item.report['path_check']['operation'], 'device')
        self.assertFalse(self.item.report['path_check']['verified'])
        self.assertNotIn('credited_paths', self.item.report)

    def test_lazy_allowance_rejects_links_wrong_device_and_missing_parent(self):
        for mutation in ('link', 'device', 'parent', 'alias', 'unknown-path'):
            with self.subTest(mutation=mutation):
                with tempfile.TemporaryDirectory() as tmp:
                    item = probe.Probe(Path('/archive'), 'a' * 40, Path(tmp) / 'output')
                    item.fs, item.outer, item.cid = Path(tmp) / 'fs', ['docker'], 'a' * 64
                    item.report['phase'] = 'nested-engine-startup'
                    item.runner = PathRunner(item.fs)
                    if mutation == 'link':
                        item.runner.local(PathRunner.CONTENT).symlink_to(item.fs / 'tmp', target_is_directory=True)
                    elif mutation == 'device':
                        item.runner.local(PathRunner.CONTENT).mkdir()
                        item.runner.foreign_device = PathRunner.CONTENT
                    elif mutation == 'alias':
                        item.runner.foreign_device = '/var/lib/containerd'
                    elif mutation == 'unknown-path':
                        item.runner.config = item.runner.config.replace(PathRunner.ROOT, '/unknown/PRIVATE_PATH')
                    else:
                        item.runner.config = item.runner.config.replace(PathRunner.ROOT, '/proof/missing')
                    with self.assertRaises(probe.ProbeError):
                        item.check_paths()
                    self.assertNotIn('credited_paths', item.report)
                    self.assertNotIn('PRIVATE_PATH', json.dumps(item.report))


class RunnerObservationTests(unittest.TestCase):
    def test_failed_command_retains_only_bounded_metadata_and_survives_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            item = probe.Probe(Path('/archive'), 'a' * 40, Path(tmp) / 'output')
            item.runner = probe.Runner(Path(tmp))
            item.cid, item.owner, item.outer = 'a' * 64, 'backend-import-123-1-abc', ['docker']
            item.report.update({'phase': 'nested-engine-startup', 'substep': 'path-backing',
                                'path_check': {'role': 'content', 'operation': 'device', 'verified': False}})
            def failed(argv, **kwargs):
                if argv == ['docker', 'container', 'inspect', 'a' * 64]:
                    kwargs['stdout'].write(json.dumps([{'Id': 'a' * 64,
                        'Config': {'Labels': {'capir.import-probe.owner': 'backend-import-123-1-abc'}}}]).encode())
                    return subprocess.CompletedProcess(argv, 0)
                if argv == ['docker', 'container', 'rm', '--force', 'a' * 64]:
                    return subprocess.CompletedProcess(argv, 0)
                kwargs['stdout'].write(b'PRIVATE_STDERR_DO_NOT_RETAIN')
                return subprocess.CompletedProcess(argv, 23)
            with patch.object(probe.subprocess, 'run', side_effect=failed):
                with self.assertRaises(probe.ProbeError):
                    item.runner.run(['docker', 'PRIVATE_ARGV_DO_NOT_RETAIN'])
                item.cleanup()
            result = json.loads((item.output / 'proof.json').read_text())
            observed = result['failure_context']['command']
            self.assertEqual(observed['sequence'], 1)
            self.assertEqual(observed['outcome'], 'nonzero-exit')
            self.assertEqual(observed['exit_code'], 23)
            self.assertEqual(observed['output_bytes'], 28)
            self.assertEqual(result['failure_context']['path_check']['role'], 'content')
            self.assertNotIn('PRIVATE', json.dumps(result))
            self.assertEqual(result['cleanup'], 'passed')
            self.assertEqual(item.runner.last_command['outcome'], 'passed')
            self.assertEqual(item.runner.last_command['sequence'], 3)

    def test_actual_runner_distinguishes_timeout_output_limit_and_launch_failure(self):
        for case in ('timeout', 'output-limit', 'launch'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as tmp:
                runner = probe.Runner(Path(tmp))
                def failure(argv, **kwargs):
                    if case == 'timeout':
                        raise subprocess.TimeoutExpired(argv, 1, output=b'PRIVATE_OUTPUT')
                    if case == 'launch':
                        raise OSError(13, 'PRIVATE_ERROR')
                    kwargs['stdout'].write(b'x' * 32)
                    return subprocess.CompletedProcess(argv, 0)
                with patch.object(probe, 'OUTPUT_LIMIT', 32), patch.object(probe.subprocess, 'run', side_effect=failure):
                    with self.assertRaises(probe.ProbeError):
                        runner.run(['PRIVATE_PROGRAM'], timeout=1)
                self.assertEqual(runner.last_command['outcome'],
                                 {'timeout': 'timeout', 'output-limit': 'output-limit', 'launch': 'launch-error'}[case])
                self.assertNotIn('PRIVATE', json.dumps(runner.last_command))


class LogDiagnosisTests(unittest.TestCase):
    # These tests catch missing evidence, changed gate decisions, or untrusted
    # values escaping through classification; expectations are hand-derived.
    def reject(self, log, message='import or daemon error observed'):
        report = {}
        with self.assertRaises(probe.ProbeError) as raised:
            probe.validate_logs(log, report)
        self.assertEqual(str(raised.exception), message)
        observed = report['log_rejection']
        self.assertEqual(set(observed), {'line_index', 'line_index_clamped', 'branch', 'parse_state',
            'duplicate_fields', 'severity', 'plugin_class', 'message_class', 'error_class',
            'plugin_type_matches', 'skip_plugin_suffix'})
        allowed = {'hard-error-pattern', 'error-event', 'parse-error', 'duplicate-fields',
            'parsed', 'unparseable', 'omitted-bound', 'present', 'absent', 'unavailable',
            'trace', 'debug', 'info', 'warn', 'warning', 'error', 'fatal', 'panic', 'unknown',
            'optional', 'required', 'other-omitted', 'skip-loading-plugin', 'disk-full',
            'permission-denied', 'unpack-failure', 'unexpected-eof', 'context-cancelled', 'closed-file'}
        for value in observed.values():
            if isinstance(value, str):
                self.assertIn(value, allowed)
            else:
                self.assertIsInstance(value, (int, bool))
        return observed

    def test_first_rejected_event_retains_branch_and_one_based_line_index(self):
        cases = [
            ('notice ready\nlevel=error msg=failed', 'error-event', 'parsed', 'absent',
             'import or daemon error observed'),
            ('notice ready\nENOSPC', 'hard-error-pattern', 'parsed', 'absent',
             'import or daemon error observed'),
            ('notice ready\nerror="unterminated', 'parse-error', 'unparseable', 'unavailable',
             'unparseable error-bearing daemon log'),
            ('notice ready\nlevel=info error=x error=y', 'duplicate-fields', 'parsed', 'present',
             'ambiguous error-bearing daemon log'),
        ]
        for log, branch, parsing, duplicate, message in cases:
            with self.subTest(branch=branch):
                observed = self.reject(log + '\nlevel=error msg=second', message)
                self.assertEqual(observed['line_index'], 2)
                self.assertEqual(observed['branch'], branch)
                self.assertEqual(observed['parse_state'], parsing)
                self.assertEqual(observed['duplicate_fields'], duplicate)

    def test_line_index_is_bounded_and_existing_first_rejection_is_not_overwritten(self):
        with patch.object(probe, 'OUTPUT_LIMIT', 2):
            observed = self.reject('ready\nready\nlevel=error msg=failed')
        self.assertEqual(observed['line_index'], 2)
        self.assertTrue(observed['line_index_clamped'])
        report = {'log_rejection': observed}
        with self.assertRaises(probe.ProbeError):
            probe.validate_logs('ENOSPC', report)
        self.assertIs(report['log_rejection'], observed)

    def test_known_classes_do_not_change_error_severity_or_optional_plugin_gate(self):
        optional = ('level=info msg="skip loading plugin" error="unsupported: skip plugin" '
                    'id=io.containerd.snapshotter.v1.blockfile type=io.containerd.snapshotter.v1')
        for name in ('blockfile', 'btrfs', 'devmapper', 'erofs', 'zfs'):
            report = {}
            self.assertIsNone(probe.validate_logs(optional.replace('blockfile', name), report))
            self.assertEqual(report, {})
        for plugin in ('io.containerd.tracing.processor.v1.otlp', 'io.containerd.internal.v1.tracing'):
            report = {}
            probe.validate_logs(optional.replace('io.containerd.snapshotter.v1.blockfile', plugin)
                .replace('type=io.containerd.snapshotter.v1', 'type=' + plugin.rsplit('.', 1)[0]), report)
            self.assertEqual(report, {})
        for level in ('debug', 'trace', 'warning', 'warn', 'error', 'fatal', 'panic', 'PRIVATE_LEVEL'):
            with self.subTest(level=level):
                observed = self.reject(optional.replace('level=info', 'level=' + level))
                self.assertEqual(observed['severity'], 'unknown' if level == 'PRIVATE_LEVEL' else level)
                self.assertEqual(observed['plugin_class'], 'optional')
                self.assertEqual(observed['message_class'], 'skip-loading-plugin')
        observed = self.reject(optional.replace('blockfile', 'overlayfs'))
        self.assertEqual(observed['plugin_class'], 'required')
        observed = self.reject(optional.replace('blockfile', 'PRIVATE_COMPONENT'))
        self.assertEqual(observed['plugin_class'], 'other-omitted')
        observed = self.reject('Error processing tar file: unexpected EOF')
        self.assertEqual(observed['severity'], 'absent')
        self.assertEqual(observed['plugin_class'], 'absent')
        self.assertEqual(observed['message_class'], 'absent')

    def test_error_classes_are_allowlisted_without_waiving_rejections(self):
        for error, expected in (
            ('no space left on device', 'disk-full'), ('ENOSPC', 'disk-full'),
            ('permission denied', 'permission-denied'), ('EACCES', 'permission-denied'),
            ('failed to unpack', 'unpack-failure'), ('unpacking failed', 'unpack-failure'),
            ('unexpected EOF', 'unexpected-eof'), ('context canceled', 'context-cancelled'),
            ('context cancelled', 'context-cancelled'), ('file already closed', 'closed-file'),
            ('use of closed file', 'closed-file'), ('PRIVATE_UNKNOWN', 'unknown')):
            with self.subTest(expected=expected, error=error):
                observed = self.reject('level=error msg="PRIVATE_MESSAGE" error="' + error + '"')
                self.assertEqual(observed['error_class'], expected)
                self.assertEqual(observed['message_class'], 'other-omitted')

    def test_optional_event_reports_type_and_suffix_mismatches_without_acceptance(self):
        base = ('level=info msg="skip loading plugin" error="unsupported: skip plugin" '
                'id=io.containerd.snapshotter.v1.blockfile type=io.containerd.snapshotter.v1')
        wrong_type = self.reject(base.replace('type=io.containerd.snapshotter.v1', 'type=PRIVATE_TYPE'))
        self.assertFalse(wrong_type['plugin_type_matches'])
        self.assertTrue(wrong_type['skip_plugin_suffix'])
        wrong_suffix = self.reject(base.replace(': skip plugin', ': PRIVATE_SUFFIX'))
        self.assertTrue(wrong_suffix['plugin_type_matches'])
        self.assertFalse(wrong_suffix['skip_plugin_suffix'])
        observed = self.reject('level=info msg="ENOSPC" error="PRIVATE_UNKNOWN"')
        self.assertEqual(observed['error_class'], 'disk-full')

    def test_duplicate_fields_never_credit_last_value_as_known_identity(self):
        observed = self.reject('level=PRIVATE_LEVEL level=info msg="skip loading plugin" '
            'id=PRIVATE_COMPONENT id=io.containerd.snapshotter.v1.blockfile error=x',
            'ambiguous error-bearing daemon log')
        self.assertEqual(observed['duplicate_fields'], 'present')
        self.assertEqual(observed['severity'], 'unknown')
        self.assertEqual(observed['plugin_class'], 'other-omitted')

    def test_serialized_diagnosis_omits_secrets_unknown_fields_controls_and_large_lines(self):
        secret = 'PRIVATE_TOKEN_7b2 https://user:password@private.invalid/key /Users/private/key'
        cases = [
            ('level=error msg="' + secret + '" error="' + secret + '" '
             'PRIVATE_FIELD="' + secret + '" id="' + secret + '"'),
            'error="' + secret + '\x00\x1b[31m',
            'level=error msg="' + secret + '\x00\x1b[31m"',
            'level=error msg="' + secret + 'x' * (1024 * 1024),
            'ENOSPC ' + secret + 'x' * (1024 * 1024),
        ]
        for log in cases:
            report = {}
            with self.subTest(length=len(log)), self.assertRaises(probe.ProbeError):
                probe.validate_logs(log, report)
            serialized = json.dumps(report)
            self.assertLess(len(serialized), 1000)
            for forbidden in ('PRIVATE', 'https', 'password', '/Users', '\\u0000', '\\u001b',
                              hashlib.sha256(log.encode()).hexdigest()):
                self.assertNotIn(forbidden, serialized)
        observed = self.reject('ENOSPC ' + 'x' * 9000)
        self.assertEqual(observed['parse_state'], 'omitted-bound')
        self.assertEqual(observed['duplicate_fields'], 'unavailable')
        self.assertEqual(observed['error_class'], 'unknown')

    def test_execute_main_and_cleanup_publish_both_log_gate_failures(self):
        # Keep the real execute/main/cleanup orchestration. Only external resource,
        # identity, and unrelated runtime probes are synthetic; no commands run.
        for source in ('archive-load', 'daemon-log-check'):
            for cleanup_failure in (False, True):
                with self.subTest(source=source, cleanup_failure=cleanup_failure), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    archive = root / 'backend.oci.tar'
                    archive.write_bytes(b'synthetic')
                    artifact = dict(ImageIdentityFixture().artifact, oci_archive_sha256='b' * 64)
                    (root / 'inspection.json').write_text(json.dumps(artifact))
                    (root / 'source-revision.txt').write_text('a' * 40 + '\n')
                    (root / 'SHA256SUMS').write_text('b' * 64 + '  backend.oci.tar\n')
                    item = probe.Probe(archive, 'a' * 40, root / 'output')
                    item.containerd_address = '/proof/containerd.sock'
                    runner = LogGateRunner(item, source, cleanup_failure)
                    with ExitStack() as stack:
                        stack.enter_context(patch.object(probe, 'Probe', return_value=item))
                        stack.enter_context(patch.object(probe, 'Runner', return_value=runner))
                        stack.enter_context(patch.object(probe, 'inspect_archive', return_value=artifact))
                        stack.enter_context(patch.object(probe, 'prepare_runtime_tools', return_value={'binary_bytes': 0}))
                        stack.enter_context(patch.object(probe, 'validate_worker'))
                        # Small fixture disk only; production CAP and allocation code stay unchanged.
                        stack.enter_context(patch.object(probe, 'CAP', 4096))
                        stack.enter_context(patch.object(probe.os, 'posix_fallocate',
                            side_effect=lambda fd, offset, size: os.ftruncate(fd, size), create=True))
                        stack.enter_context(patch.object(probe.threading, 'Thread'))
                        stack.enter_context(patch.object(probe.time, 'sleep'))
                        stack.enter_context(patch.object(probe.signal, 'signal'))
                        stack.enter_context(patch.object(probe.platform, 'system', return_value='Linux'))
                        stack.enter_context(patch.object(probe.platform, 'machine', return_value='aarch64'))
                        stack.enter_context(patch.dict(probe.os.environ, {'GITHUB_ACTIONS': 'true',
                            'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'ARM64',
                            'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'RUNNER_TEMP': tmp}))
                        stack.enter_context(patch.object(sys, 'argv', ['probe', str(archive), '--revision', 'a' * 40,
                            '--output', str(item.output), '--disposable-ci-opt-in']))
                        stack.enter_context(patch.object(probe.subprocess, 'run', side_effect=AssertionError('no commands')))
                        stack.enter_context(patch.object(probe.urllib.request, 'urlopen', side_effect=AssertionError('no network')))
                        for method in ('check_loop', 'check_runtime_tools', 'check_delegation', 'check_engine',
                                       'check_paths', 'check_version_runtimes', 'capped_path'):
                            stack.enter_context(patch.object(item, method))
                        stack.enter_context(patch.object(item, 'check_loaded_image', return_value=artifact['image_manifest_digest']))
                        stack.enter_context(patch.object(item, 'sample', side_effect=lambda:
                            item.report['samples'].append({'used_bytes': 100})))
                        stack.enter_context(patch.object(item, 'mount_info', side_effect=lambda: {
                            'target': str(item.fs), 'source': '/dev/loop7', 'fstype': 'ext4', 'options': 'rw,relatime'}))
                        self.assertEqual(probe.main(), 1)
                    published = json.loads((item.output / 'proof.json').read_text())
                    self.assertEqual(published['status'], 'failed')
                    self.assertEqual(published['failure'], 'import or daemon error observed', published)
                    self.assertEqual(published['failure_context']['substep'], source)
                    self.assertEqual(published['log_rejection']['branch'], 'error-event')
                    self.assertEqual(published['log_rejection']['severity'], 'error')
                    self.assertEqual(published['log_rejection']['error_class'], 'permission-denied')
                    self.assertEqual(published['log_rejection']['line_index'], 2)
                    self.assertEqual(published['cleanup'], 'failed; unknown resources left for ephemeral runner teardown'
                                     if cleanup_failure else 'passed')
                    self.assertNotIn('PRIVATE', json.dumps(published))
                    self.assertNotIn('PRIVATE', (item.output / 'probe.log').read_text())

    def test_actual_version_output_gate_retains_diagnosis_before_probe_credit(self):
        target = 'sha256:' + 'b' * 64
        for name in ('node', 'native'):
            with self.subTest(name=name):
                item = probe.Probe(Path('/archive'), 'a' * 40, Path('/output'))
                item.outer, item.cid, item.owner = ['docker'], 'a' * 64, 'backend-import-123-1-abc'
                item.runner = VersionIdentityRunner(target, False)
                run = item.runner.run
                def output(argv, **kwargs):
                    result = run(argv, **kwargs)
                    if 'start' in argv and item.runner.containers.get(argv[-1]) == name:
                        result += 'level=error msg="PRIVATE_MESSAGE" error="unexpected EOF PRIVATE_TOKEN"\n'
                    return result
                with patch.object(item.runner, 'run', side_effect=output), self.assertRaises(probe.ProbeError) as raised:
                    item.check_version_runtimes(target)
                self.assertEqual(str(raised.exception), 'import or daemon error observed')
                self.assertEqual(item.report['substep'], name + '-runtime-result')
                self.assertNotIn(name + '_version_probe_passed', item.report)
                self.assertEqual(item.report['log_rejection']['line_index'], 2)
                self.assertEqual(item.report['log_rejection']['error_class'], 'unexpected-eof')
                self.assertNotIn('PRIVATE', json.dumps(item.report))

    def test_diagnostic_fault_never_replaces_primary_gate_failure(self):
        with patch.object(probe, 'log_rejection_observation', side_effect=RuntimeError('PRIVATE_FAILURE')):
            report = {}
            with self.assertRaises(probe.ProbeError) as raised:
                probe.validate_logs('level=error msg=failed', report)
            self.assertEqual(str(raised.exception), 'import or daemon error observed')
            self.assertEqual(report['log_rejection'], {'line_index': 1, 'line_index_clamped': False,
                'branch': 'error-event', 'parse_state': 'unavailable'})
            self.assertNotIn('PRIVATE', json.dumps(report))


class LogGateRunner:
    """Synthetic external boundary for real log-gate failure publication."""
    def __init__(self, item, source, cleanup_failure):
        self.item, self.source, self.cleanup_failure = item, source, cleanup_failure

    def run(self, argv, **kwargs):
        item = self.item
        if argv[:4] == ['sudo', '-n', 'losetup', '--find']:
            return '/dev/loop7'
        if argv[:4] == ['sudo', '-n', 'dumpe2fs', '-h']:
            return 'Block count: 1\nBlock size: 4096\n'
        if argv[:2] == ['sudo', '-n'] or argv[:2] == ['sync', '-f']:
            return ''
        if argv[:len(item.outer)] != item.outer:
            raise AssertionError('unexpected synthetic control command')
        args = argv[len(item.outer):]
        if args[:2] == ['container', 'rm'] and self.cleanup_failure:
            raise probe.ProbeError('bounded command failed')
        if args[:2] == ['container', 'inspect']:
            return json.dumps([{'Id': item.cid, 'Config': {'Labels': {probe.OWNER_LABEL: item.owner}}}])
        if args[:2] == ['image', 'inspect']:
            return json.dumps([{'Id': 'sha256:' + 'c' * 64, 'Architecture': 'arm64', 'Os': 'linux', 'Size': 1}])
        if args[:1] == ['create']:
            return 'd' * 64
        rejected = ('ready\nlevel=error msg="PRIVATE_MESSAGE" error="permission denied PRIVATE_TOKEN" '
                    'path="/PRIVATE_PATH" url="https://PRIVATE.invalid"')
        if args[:2] == ['exec', '-i']:
            return rejected if self.source == 'archive-load' else 'Loaded image'
        if args[:1] == ['exec']:
            command = args[2:]
            if command == ['cat', '/proof/daemon.log']:
                return rejected
            if command[:2] == ['docker', '--host=unix:///proof/docker.sock']:
                if command[2:3] in (['version'], ['info']):
                    return '{}'
                if command[2:] == ['image', 'ls', '--quiet', '--all']:
                    return ''
            if command[:1] == ['ctr']:
                if command[-4:] == ['images', 'check', '--snapshotter', 'overlayfs']:
                    return ('REF TYPE DIGEST STATUS SIZE UNPACKED\nref application/vnd.oci.image.manifest.v1+json ' +
                            ImageIdentityFixture().manifest_digest + ' complete (2/2) 1kB true\n')
                if command[-2:] in (['ls', '--quiet'], ['overlayfs', 'ls']):
                    return ''
        if args[:2] == ['image', 'ls'] or args[:1] in (['pull'], ['start']) or args[:2] in (
                ['container', 'rm'], ['image', 'rm']):
            return ''
        raise AssertionError('unexpected synthetic import command')


class LoadedIdentityTests(unittest.TestCase):
    def item(self, fixture):
        item = probe.Probe(Path('/archive'), fixture.artifact['source_revision'], Path('/output'))
        item.outer, item.cid, item.containerd_address = ['docker'], 'a' * 64, '/proof/containerd.sock'
        item.runner = ImageIdentityRunner(fixture)
        return item

    def test_actual_identity_uses_manifest_target_and_binds_stored_config_and_diff_ids(self):
        fixture = ImageIdentityFixture()
        item = self.item(fixture)
        self.assertEqual(item.check_loaded_image(fixture.artifact), fixture.manifest_digest)
        observed = item.report['loaded_identity']
        self.assertTrue(observed['validated'])
        self.assertEqual(observed['docker']['image_id'], fixture.manifest_digest)
        self.assertEqual(observed['manifest']['digest'], fixture.manifest_digest)
        self.assertEqual(observed['config']['digest'], fixture.config_digest)
        self.assertEqual(observed['config']['diff_ids'], ['sha256:' + 'd' * 64, 'sha256:' + 'e' * 64])
        self.assertNotIn('PRIVATE', json.dumps(item.report))
        self.assertNotIn('Env', json.dumps(item.report))

    def test_actual_identity_rejects_missing_stale_ambiguous_and_multiple_images(self):
        for mutation in ('missing', 'stale', 'duplicate-docker', 'multiple-containerd', 'wrong-target', 'multiple-inspect'):
            with self.subTest(mutation=mutation):
                fixture = ImageIdentityFixture()
                if mutation == 'missing':
                    fixture.docker_ids = []
                elif mutation == 'stale':
                    fixture.docker_ids = ['sha256:' + '9' * 64]
                elif mutation == 'duplicate-docker':
                    fixture.docker_ids *= 2
                elif mutation == 'multiple-containerd':
                    fixture.refs.append('PRIVATE_STALE_REFERENCE')
                elif mutation == 'wrong-target':
                    fixture.matching_refs = []
                else:
                    fixture.inspections *= 2
                item = self.item(fixture)
                with self.assertRaises(probe.ProbeError):
                    item.check_loaded_image(fixture.artifact)
                self.assertFalse(item.report['loaded_identity']['validated'])
                self.assertNotIn('PRIVATE', json.dumps(item.report))

    def test_actual_identity_rejects_broken_manifest_config_platform_source_and_diff_id_chain(self):
        for mutation in ('config-as-id', 'descriptor', 'descriptor-platform', 'index', 'size', 'source', 'platform', 'diff-ids',
                         'manifest-bytes', 'config-bytes', 'config-link', 'oversized'):
            with self.subTest(mutation=mutation):
                fixture = ImageIdentityFixture()
                if mutation == 'config-as-id':
                    fixture.image['Id'] = fixture.config_digest
                elif mutation == 'descriptor':
                    fixture.image['Descriptor']['digest'] = 'sha256:' + '9' * 64
                elif mutation == 'descriptor-platform':
                    fixture.image['Descriptor']['platform'] = {'os': 'linux', 'architecture': 'amd64'}
                elif mutation == 'index':
                    fixture.image['Descriptor']['mediaType'] = 'application/vnd.oci.image.index.v1+json'
                elif mutation == 'size':
                    fixture.image['Descriptor']['size'] += 1
                elif mutation == 'source':
                    fixture.image['Config']['Labels']['org.opencontainers.image.revision'] = 'b' * 40
                elif mutation == 'platform':
                    fixture.image['Architecture'] = 'amd64'
                elif mutation == 'diff-ids':
                    fixture.image['RootFS']['Layers'].reverse()
                elif mutation == 'config-link':
                    fixture.artifact['image_config_digest'] = 'sha256:' + '9' * 64
                elif mutation == 'oversized':
                    fixture.blobs[fixture.manifest_digest] = b'x' * (4 * 1024**2)
                else:
                    digest = fixture.manifest_digest if mutation == 'manifest-bytes' else fixture.config_digest
                    fixture.blobs[digest] += b'\n'
                item = self.item(fixture)
                with self.assertRaises(probe.ProbeError):
                    item.check_loaded_image(fixture.artifact)
                self.assertFalse(item.report['loaded_identity']['validated'])
                self.assertNotIn('PRIVATE', json.dumps(item.report))

    def test_unpack_cannot_credit_another_complete_manifest(self):
        target = 'sha256:' + 'b' * 64
        output = ('REF TYPE DIGEST STATUS SIZE UNPACKED\n'
                  'ref application/vnd.oci.image.manifest.v1+json ' + target + ' complete (4/4) 1kB/1kB true\n')
        probe.validate_unpack(output, 1, target)
        with self.assertRaises(probe.ProbeError):
            probe.validate_unpack(output.replace(target, 'sha256:' + 'c' * 64), 1, target)

    def test_actual_version_probes_use_manifest_id_and_reject_a_different_running_image(self):
        target = 'sha256:' + 'b' * 64
        for wrong_image in (False, True):
            with self.subTest(wrong_image=wrong_image):
                item = probe.Probe(Path('/archive'), 'a' * 40, Path('/output'))
                item.outer, item.cid, item.owner = ['docker'], 'a' * 64, 'backend-import-123-1-abc'
                item.runner = VersionIdentityRunner(target, wrong_image)
                if wrong_image:
                    with self.assertRaises(probe.ProbeError):
                        item.check_version_runtimes(target)
                    self.assertNotIn('node_version_probe_passed', item.report)
                else:
                    item.check_version_runtimes(target)
                    self.assertTrue(item.report['node_version_probe_passed'])
                    self.assertTrue(item.report['native_version_probe_passed'])
                    self.assertEqual(item.report['runtime_image_ids'], {'node': target, 'native': target})
                self.assertNotIn('PRIVATE', json.dumps(item.report))

    def test_actual_runner_returns_exact_content_bytes_for_hash_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner = probe.Runner(Path(tmp))
            def raw(argv, **kwargs):
                kwargs['stdout'].write(b'\xff\x00\xe7\xa7\x98')
                return subprocess.CompletedProcess(argv, 0)
            with patch.object(probe.subprocess, 'run', side_effect=raw):
                self.assertEqual(runner.run(['docker'], binary=True), b'\xff\x00\xe7\xa7\x98')


class ImageIdentityFixture:
    def __init__(self):
        media = 'application/vnd.oci.image.'
        self.config = {'os': 'linux', 'architecture': 'arm64',
            'config': {'Labels': {'org.opencontainers.image.revision': 'a' * 40}, 'Env': ['PRIVATE=秘密']},
            'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + 'd' * 64, 'sha256:' + 'e' * 64]}}
        config_bytes = json.dumps(self.config, ensure_ascii=False, separators=(',', ':')).encode()
        self.config_digest = 'sha256:' + hashlib.sha256(config_bytes).hexdigest()
        manifest = {'schemaVersion': 2, 'mediaType': media + 'manifest.v1+json',
            'config': {'digest': self.config_digest, 'mediaType': media + 'config.v1+json', 'size': len(config_bytes)},
            'layers': [{'digest': 'sha256:' + x * 64, 'mediaType': media + 'layer.v1.tar+gzip', 'size': 123}
                       for x in ('1', '2')]}
        manifest_bytes = json.dumps(manifest, separators=(',', ':')).encode()
        self.manifest_digest = 'sha256:' + hashlib.sha256(manifest_bytes).hexdigest()
        self.artifact = {'image_config_digest': self.config_digest, 'image_manifest_digest': self.manifest_digest,
                         'source_revision': 'a' * 40, 'layer_count': 2, 'platform': 'linux/arm64'}
        self.image = {'Id': self.manifest_digest, 'Descriptor': {'digest': self.manifest_digest,
                       'mediaType': media + 'manifest.v1+json', 'size': len(manifest_bytes)},
                      'Os': 'linux', 'Architecture': 'arm64', 'Config': copy.deepcopy(self.config['config']),
                      'RootFS': {'Type': 'layers', 'Layers': self.config['rootfs']['diff_ids'][:]}}
        self.inspections = [self.image]
        self.docker_ids = [self.manifest_digest]
        self.refs = ['moby-dangling@' + self.manifest_digest]
        self.matching_refs = self.refs[:]
        self.blobs = {self.manifest_digest: manifest_bytes, self.config_digest: config_bytes}


class ImageIdentityRunner:
    """Moby 29 resolves target digests, never config digests; no real commands."""
    def __init__(self, fixture):
        self.fixture = fixture

    def run(self, argv, **kwargs):
        prefix = ['docker', 'exec', 'a' * 64]
        docker = prefix + ['docker', '--host=unix:///proof/docker.sock']
        ctr = prefix + ['ctr', '--address', '/proof/containerd.sock', '--namespace', 'moby']
        fixture = self.fixture
        if argv == docker + ['image', 'inspect', fixture.config_digest]:
            raise probe.ProbeError('bounded command failed')
        if argv == docker + ['image', 'inspect', fixture.manifest_digest]:
            return json.dumps(fixture.inspections)
        if argv == docker + ['image', 'ls', '--quiet', '--all', '--no-trunc']:
            return '\n'.join(fixture.docker_ids)
        if argv == ctr + ['images', 'ls', '--quiet']:
            return '\n'.join(fixture.refs)
        if argv == ctr + ['images', 'ls', '--quiet', 'target.digest==' + fixture.manifest_digest]:
            return '\n'.join(fixture.matching_refs)
        if argv[:len(ctr) + 2] == ctr + ['content', 'get'] and argv[-1] in fixture.blobs:
            if kwargs != {'binary': True}:
                raise AssertionError('content hash input must remain raw bytes')
            return fixture.blobs[argv[-1]]
        raise AssertionError('unexpected identity command')


class VersionIdentityRunner:
    def __init__(self, target, wrong_image):
        self.target, self.wrong_image = target, wrong_image
        self.containers = {}

    def run(self, argv, **kwargs):
        prefix = ['docker', 'exec', 'a' * 64, 'docker', '--host=unix:///proof/docker.sock']
        if argv[:len(prefix)] != prefix:
            raise AssertionError('unexpected runtime prefix')
        args = argv[len(prefix):]
        if args[:1] == ['create']:
            if args[args.index('--entrypoint=node') + 1] != self.target:
                raise probe.ProbeError('bounded command failed')
            if not {'--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges'} <= set(args):
                raise AssertionError('runtime isolation lost')
            name = args[args.index('--name') + 1].rsplit('-', 1)[-1]
            cid = ('b' if name == 'node' else 'c') * 64
            self.containers[cid] = name
            return cid
        if args[:2] == ['start', '--attach'] and args[2] in self.containers:
            return ('node-arm64-ok v22.15.0\n' if self.containers[args[2]] == 'node' else
                    'Native Agent runtime verified: linux-arm64; 0.1.73\n')
        if args[:2] == ['container', 'inspect'] and args[2] in self.containers:
            return json.dumps([{'Id': args[2], 'Image': 'sha256:' + '9' * 64 if self.wrong_image else self.target,
                'Config': {'Env': ['PRIVATE']}, 'State': {'Status': 'exited', 'ExitCode': 0, 'OOMKilled': False}}])
        raise AssertionError('unexpected runtime command')


class PathRunner:
    """Synthetic pinned-daemon filesystem; never executes a subprocess."""
    ROOT = '/proof/docker/containerd/daemon'
    STATE = '/proof/run/docker/containerd/daemon'
    CONFIG = '/proof/run/docker/containerd/containerd.toml'
    ADDRESS = '/proof/run/docker/containerd/containerd.sock'
    CONTENT = ROOT + '/io.containerd.content.v1.content'
    OVERLAY = ROOT + '/io.containerd.snapshotter.v1.overlayfs'

    def __init__(self, root):
        self.root, self.foreign_device = root.resolve(), None
        self.config = ('version = 2\nroot = "' + self.ROOT + '"\nstate = "' + self.STATE +
                       '"\n[grpc]\naddress = "' + self.ADDRESS + '"\n')
        for path in (self.ROOT, self.STATE, self.OVERLAY, self.ROOT + '/io.containerd.metadata.v1.bolt',
                     '/proof/tmp', '/proof/unused-docker', '/proof/unused-containerd'):
            self.local(path).mkdir(parents=True, exist_ok=True)
        self.local(self.CONFIG).touch()
        self.local(self.ADDRESS).touch()

    def local(self, path):
        aliases = {'/tmp': '/proof/tmp', '/run': '/proof/run', '/var/lib/docker': '/proof/unused-docker',
                   '/var/lib/containerd': '/proof/unused-containerd'}
        path = aliases.get(path, path)
        if not path.startswith('/proof/'):
            raise AssertionError('unexpected synthetic path')
        return self.root / path.removeprefix('/proof/')

    def run(self, argv, **kwargs):
        prefix = ['docker', 'exec', 'a' * 64]
        if argv[:3] != prefix:
            raise AssertionError('unexpected synthetic command prefix')
        args = argv[3:]
        if args == ['cat', self.CONFIG]:
            return self.config
        if args[:2] == ['sh', '-c'] and len(args) == 3:
            return '/usr/local/bin/containerd\n--config\n' + self.CONFIG + '\n'
        if args[:2] == ['sh', '-c'] and args[3:4] == ['probe-path'] and len(args) == 5:
            path = self.local(args[4])
            if path.is_symlink() or (path.exists() and not path.is_dir()):
                raise probe.ProbeError('bounded command failed')
            return 'present' if path.is_dir() else 'absent'
        if args[:2] == ['readlink', '-f']:
            path = self.local(args[2]).resolve()
            return '/proof/' + str(path.relative_to(self.root)) + '\n'
        if args[:3] == ['stat', '-c', '%d']:
            try:
                device = self.local(args[3]).stat().st_dev
            except FileNotFoundError:
                raise probe.ProbeError('bounded command failed') from None
            return str(device + (args[3] == self.foreign_device)) + '\n'
        raise AssertionError('unexpected synthetic command')


def runtime_fixture(change=None):
    files = {}
    for name in ('containerd', 'containerd-shim-runc-v2', 'ctr'):
        data = bytearray(128)
        data[:7] = b'\x7fELF\x02\x01\x01'
        struct.pack_into('<HH', data, 16, 2, 183)
        struct.pack_into('<Q', data, 32, 64)
        struct.pack_into('<HHH', data, 52, 64, 56, 1)
        struct.pack_into('<I', data, 64, 1)
        if name == 'ctr' and change == 'wrong-arch':
            struct.pack_into('<H', data, 18, 62)
        if name == 'ctr' and change == 'dynamic':
            struct.pack_into('<I', data, 64, 3)
        files[name] = bytes(data) + name.encode()
    specs = {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, data in files.items()}
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w:gz', format=tarfile.USTAR_FORMAT) as archive:
        directory = tarfile.TarInfo('bin')
        directory.type = tarfile.DIRTYPE
        archive.addfile(directory)
        auxiliary = tarfile.TarInfo('bin/containerd-stress')
        auxiliary.size = 3
        archive.addfile(auxiliary, io.BytesIO(b'aux'))
        for name, data in files.items():
            if name == 'ctr' and change == 'missing':
                continue
            member = tarfile.TarInfo('bin/' + name)
            member.size = len(data)
            if name == 'ctr' and change in ('link', 'hardlink'):
                member.type = tarfile.SYMTYPE if change == 'link' else tarfile.LNKTYPE
                member.linkname, member.size = '/outside', 0
                archive.addfile(member)
            else:
                archive.addfile(member, io.BytesIO(data))
        if change == 'duplicate':
            duplicate = tarfile.TarInfo('bin/ctr')
            duplicate.size = len(files['ctr'])
            archive.addfile(duplicate, io.BytesIO(files['ctr']))
        if change == 'unexpected-name':
            archive.addfile(tarfile.TarInfo('bin/unexpected'))
    return raw.getvalue(), specs


class RuntimeResponse(io.BytesIO):
    def __init__(self, body, final_url):
        super().__init__(body)
        self.final_url = final_url

    def geturl(self):
        return self.final_url


def runtime_inputs(raw, specs, *, body=None, final_url='https://release-assets.githubusercontent.com/asset'):
    stack = ExitStack()
    stack.enter_context(patch.dict(probe.RUNTIME_BINARIES, specs, clear=True))
    stack.enter_context(patch.object(probe, 'RUNTIME_ARCHIVE_BYTES', len(raw)))
    stack.enter_context(patch.object(probe, 'RUNTIME_ARCHIVE_SHA256', hashlib.sha256(raw).hexdigest()))
    response = RuntimeResponse(raw if body is None else body, final_url)
    stack.enter_context(patch.object(probe.urllib.request, 'urlopen', return_value=response))
    return stack


class RuntimeHashRunner:
    def __init__(self, corrupt):
        self.corrupt = corrupt

    def run(self, argv, **kwargs):
        prefix = ['docker', 'exec', 'a' * 64]
        for name, spec in probe.RUNTIME_BINARIES.items():
            path = '/usr/local/bin/' + name
            if argv == prefix + ['sha256sum', path]:
                digest = '0' * 64 if self.corrupt == 'file' else spec['sha256']
                return digest + '  ' + path + '\n'
        if argv[:5] == prefix + ['sh', '-c']:
            digest = '0' * 64 if self.corrupt == 'process' else probe.RUNTIME_BINARIES['containerd']['sha256']
            return digest + '  /proc/42/exe\n'
        raise AssertionError('unexpected command: ' + str(argv))


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
