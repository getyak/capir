#!/usr/bin/env python3
"""Explicitly opted-in, disposable GitHub ARM runner import proof; never deployment.

A fixed ext4 device bounds the credited data paths. Samples are observations,
not peak upper bounds. Outer runner/control/image costs are separate exceptions.
Only sanitized, allowlisted evidence is retained; command output is not published.
"""
import argparse
import json
import hashlib
import struct
import tarfile
import urllib.request
import urllib.parse
import os
from pathlib import Path
import platform
import re
import resource
import signal
import shlex
import subprocess
import tempfile
import threading
import time

from inspect_backend_oci import inspect_archive, bounded_tar_info, decode_json, OCI, SHA256, MAX_LAYERS

CAP = 2 * 1024**3
OUTPUT_LIMIT = 4 * 1024**2
CGROUP2_SUPER_MAGIC = 0x63677270  # Linux include/uapi/linux/magic.h, statfs.f_type.
DIND = 'docker.io/library/docker@sha256:5256d1242c894ee092a567c4385fe682071c05c2056c1e90953717cec0aa3fbe'
OWNER_LABEL = 'capir.import-probe.owner'
RUNTIME_REVISION = '193637f7ee8ae5f5aa5248f49e7baa3e6164966e'
RUNTIME_URL = 'https://github.com/containerd/containerd/releases/download/v2.2.4/containerd-static-2.2.4-linux-arm64.tar.gz'
RUNTIME_ARCHIVE_BYTES = 30546406
RUNTIME_ARCHIVE_SHA256 = '5f01ac0ad46caf685afee7614e36e406c48e73c1d84a71378dd4afe5d63a11d2'
RUNTIME_BINARIES = {
    'containerd': {'bytes': 41166848, 'sha256': 'd27435c74f56df34b002bfad7b0bdc87a86815044e989b25b29a3356d60a2e09'},
    'containerd-shim-runc-v2': {'bytes': 7995576, 'sha256': 'ec775d80dbdb767418827c6597a86e709cb794ca41edb0debf01dbbee64bb47a'},
    'ctr': {'bytes': 20840632, 'sha256': 'dba23ecfa03867ccd3a7ae442f5cef7f0d37564f8c96639500997b5bef5e03d8'},
}


class ProbeError(ValueError):
    """Only constant, content-free diagnostics belong in this exception."""


def require(condition, message):
    if not condition:
        raise ProbeError(message)


def prepare_runtime_tools(root):
    """Stage only hash-pinned official tools; no execution and no general extraction."""
    folder = root / 'runtime-tools'
    folder.mkdir()  # Exclusive task-owned directory; never overwrite or reuse.
    archive = folder / 'package.tar.gz'
    digest, count, started = hashlib.sha256(), 0, time.monotonic()
    with urllib.request.urlopen(RUNTIME_URL, timeout=30) as response, archive.open('xb') as target:
        origin = urllib.parse.urlsplit(response.geturl())
        require(origin.scheme == 'https' and origin.hostname in
                ('github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com') and
                not origin.username and not origin.password, 'unexpected runtime download origin')
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            count += len(chunk)
            require(count <= RUNTIME_ARCHIVE_BYTES and time.monotonic() - started < 180,
                    'runtime download exceeds bounds')
            digest.update(chunk)
            target.write(chunk)  # Not subject to command-output RLIMIT_FSIZE.
    require(count == RUNTIME_ARCHIVE_BYTES and digest.hexdigest() == RUNTIME_ARCHIVE_SHA256,
            'runtime archive integrity mismatch')
    found, seen, total = set(), set(), 0
    with tarfile.open(archive, 'r:gz', tarinfo=bounded_tar_info()) as package:
        for index, member in enumerate(package):
            require(index < 16, 'runtime archive member count exceeded')
            name = member.name
            while name.startswith('./'):
                name = name[2:]
            name = name.rstrip('/')
            require(name not in seen and (member.isdir() or member.isfile()) and not member.issparse(),
                    'duplicate or linked runtime archive member')
            seen.add(name)
            if member.isdir():
                require(name in ('', 'bin'), 'unexpected runtime archive directory')
                continue
            total += member.size
            require(0 <= member.size <= 64 * 1024**2 and total <= 128 * 1024**2,
                    'runtime archive payload exceeds bounds')
            # Some official packages include the stress utility; never stage/run it.
            if name == 'bin/containerd-stress':
                require(member.size <= 32 * 1024**2, 'unexpected auxiliary runtime size')
                continue
            binary = name.removeprefix('bin/')
            require(name == 'bin/' + binary and binary in RUNTIME_BINARIES,
                    'unexpected runtime archive filename')
            spec = RUNTIME_BINARIES[binary]
            require(member.size == spec['bytes'], 'runtime binary size mismatch')
            path, actual, written = folder / binary, hashlib.sha256(), 0
            with package.extractfile(member) as source, path.open('xb') as target:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    require(written <= spec['bytes'], 'runtime binary exceeds bound')
                    actual.update(chunk)
                    target.write(chunk)
            require(written == spec['bytes'] and actual.hexdigest() == spec['sha256'],
                    'runtime binary digest mismatch')
            with path.open('rb') as source:
                header = source.read(64)
                require(len(header) == 64 and header[:7] == b'\x7fELF\x02\x01\x01' and
                        struct.unpack_from('<HH', header, 16) == (2, 183), 'runtime binary is not ARM64 ELF')
                offset = struct.unpack_from('<Q', header, 32)[0]
                entry_size, entries = struct.unpack_from('<HH', header, 54)
                require(entry_size == 56 and 0 < entries <= 256 and
                        offset + entry_size * entries <= written, 'invalid runtime ELF program headers')
                source.seek(offset)
                program_headers = source.read(entry_size * entries)
                require(all(struct.unpack_from('<I', program_headers, i * entry_size)[0] not in (2, 3)
                            for i in range(entries)), 'runtime binary requires dynamic linking')
            path.chmod(0o555)
            found.add(binary)
    require(found == set(RUNTIME_BINARIES), 'missing required runtime binary')
    archive.unlink()
    return {'url': RUNTIME_URL, 'archive_sha256': RUNTIME_ARCHIVE_SHA256,
            'archive_bytes': count, 'binary_bytes': sum(spec['bytes'] for spec in RUNTIME_BINARIES.values()),
            'binaries': RUNTIME_BINARIES, 'outside_import_cap': True}


def engine_observation(version, info=None):
    def safe(value, pattern=r'[A-Za-z0-9][A-Za-z0-9._+-]{0,63}'):
        return value if isinstance(value, str) and re.fullmatch(pattern, value) else None
    components = version.get('Components', [])
    containerd = [x for x in components if isinstance(x, dict) and x.get('Name') == 'containerd'] if isinstance(components, list) else []
    component = containerd[0] if len(containerd) == 1 else {}
    details = component.get('Details', {})
    result = {'docker': safe(version.get('Version')), 'docker_commit': safe(version.get('GitCommit'), r'[0-9a-f]{7,40}'),
              'os': safe(version.get('Os')), 'architecture': safe(version.get('Arch')),
              'containerd': safe(component.get('Version')),
              'containerd_commit': safe(details.get('GitCommit'), r'[0-9a-f]{40}') if isinstance(details, dict) else None,
              'validated': False}
    if info is not None:
        result.update({'driver': safe(info.get('Driver')),
                       'docker_root': safe(info.get('DockerRootDir'), r'/[A-Za-z0-9_./-]{1,255}'),
                       'driver_types': [safe(row[1]) for row in info.get('DriverStatus', [])
                                        if isinstance(row, list) and len(row) == 2 and row[0] == 'driver-type']})
    return result


def validate_environment(env, opt_in, system, machine):
    require(opt_in and env.get('GITHUB_ACTIONS') == 'true' and
            env.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
            env.get('RUNNER_OS') == 'Linux' and env.get('RUNNER_ARCH') == 'ARM64' and
            system == 'Linux' and machine in ('aarch64', 'arm64'),
            'requires explicit disposable GitHub-hosted Linux ARM64 opt-in')
    require(all(re.fullmatch(r'[0-9]+', env.get(key, '')) for key in
                ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT')), 'invalid run identity')


def validate_artifact(actual, prior, revision, sums):
    require(re.fullmatch(r'[0-9a-f]{40}', revision) is not None, 'invalid revision')
    require(actual.get('source_revision') == revision and actual.get('platform') == 'linux/arm64',
            'artifact source or platform mismatch')
    for key in ('source_revision', 'platform', 'oci_archive_sha256',
                'image_config_digest', 'image_manifest_digest'):
        require(actual.get(key) == prior.get(key), 'artifact reinspection mismatch')
    require(sums == actual['oci_archive_sha256'] + '  backend.oci.tar\n', 'archive checksum mismatch')


def validate_worker(worker, filesystem):
    expected = {dest: filesystem + suffix for suffix, dest in
                [('', '/proof'), ('/run', '/run'), ('/tmp', '/tmp'),
                 ('/unused-docker', '/var/lib/docker'), ('/unused-containerd', '/var/lib/containerd')]}
    expected = {dest: (source, True) for dest, source in expected.items()}
    tools = Path(filesystem).parent / 'runtime-tools'
    expected.update({'/usr/local/bin/' + name: (str(tools / name), False) for name in RUNTIME_BINARIES})
    mounts = worker.get('Mounts', [])
    require(len(mounts) == len(expected) and all(
        mount.get('Type') == 'bind' and
        expected.get(mount.get('Destination')) == (mount.get('Source'), mount.get('RW')) for mount in mounts),
        'unexpected worker mount or host socket')
    require(len({mount.get('Destination') for mount in mounts}) == len(expected), 'duplicate worker mount')
    host = worker.get('HostConfig', {})
    require(host.get('ReadonlyRootfs') is True and host.get('NetworkMode') == 'none' and
            not host.get('PortBindings') and host.get('LogConfig', {}).get('Type') == 'none' and
            host.get('CgroupnsMode') == 'private',
            'worker root network or log boundary mismatch')
    env = worker.get('Config', {}).get('Env', [])
    require('DOCKER_TMPDIR=/proof/tmp' in env and 'TMPDIR=/proof/tmp' in env,
            'worker temporary path mismatch')


def validate_engine(version, info):
    require(version.get('Version') == '29.5.2' and version.get('Os') == 'linux' and
            version.get('Arch') == 'arm64', 'wrong Docker engine or platform')
    observed = engine_observation(version)
    require(observed['containerd'] in ('v2.2.4', '2.2.4') and
            observed['containerd_commit'] == RUNTIME_REVISION, 'wrong containerd version or commit')
    require(info.get('OSType') == 'linux' and info.get('Architecture') in ('aarch64', 'arm64') and
            info.get('Driver') == 'overlayfs' and
            ['driver-type', 'io.containerd.snapshotter.v1'] in info.get('DriverStatus', []) and
            info.get('DockerRootDir') == '/proof/docker', 'wrong snapshotter or Docker root')


def validate_mount(mount, target, loop, block_size, total):
    options = set(mount.get('options', '').split(','))
    require(mount.get('target') == target and mount.get('source') == loop and
            mount.get('fstype') == 'ext4' and {'rw', 'relatime'} <= options and
            not {'noatime', 'ro'} & options and block_size == 4096 and total == CAP,
            'filesystem or mount backing mismatch')


def validate_backing(expected, resolved, actual_device, device):
    require(expected.startswith('/proof/') and resolved == expected and actual_device == device,
            'inner path escapes the capped filesystem')


def validate_loop(value, loop, backing):
    require(value.get('loopdevices') == [{'name': loop, 'back-file': backing}],
            'loop device ownership mismatch')


def validate_unpack(output, expected_count, expected_digest=None):
    rows = [line.split() for line in output.splitlines()[1:] if line.strip()]
    require(expected_count > 0 and len(rows) == expected_count, 'missing image unpack evidence')
    for row in rows:
        if expected_digest is not None:
            require(len(row) > 3 and row[1] == OCI + 'manifest.v1+json' and row[2] == expected_digest,
                    'unpack evidence belongs to another image')
        require('complete' in row and row[-1] == 'true' and 'incomplete' not in row,
                'incomplete image content or unpack')
        counts = [re.fullmatch(r'\(([0-9]+)/([0-9]+)\)', token) for token in row]
        require(any(m and int(m[1]) > 0 and m[1] == m[2] for m in counts),
                'incomplete content count')


def log_rejection_observation(line, index, branch, optional):
    """Content-free classification only; bounded independently of gate parsing."""
    observed = {'line_index': min(index, OUTPUT_LIMIT), 'line_index_clamped': index > OUTPUT_LIMIT,
                'branch': branch, 'parse_state': 'omitted-bound', 'duplicate_fields': 'unavailable',
                'severity': 'unknown', 'plugin_class': 'other-omitted',
                'message_class': 'other-omitted', 'error_class': 'unknown',
                'plugin_type_matches': False, 'skip_plugin_suffix': False}
    # Never parse a second unbounded line or retain raw input (including hashes).
    # The gate below still checks the complete line with its original predicates.
    if len(line) > 8192:
        return observed
    try:
        pairs = [token.split('=', 1) for token in shlex.split(line) if '=' in token]
    except ValueError:
        observed['parse_state'] = 'unparseable'
        return observed
    observed['parse_state'] = 'parsed'
    fields = dict(pairs)
    duplicate = len(fields) != len(pairs)
    observed['duplicate_fields'] = 'present' if duplicate else 'absent'
    # A duplicate event has no trustworthy last-value identity, even when one
    # repeated value happens to be known. Classify its shape, never its values.
    if duplicate:
        return observed
    severity, plugin, message = fields.get('level'), fields.get('id'), fields.get('msg')
    observed['severity'] = ('absent' if severity is None else severity if severity in
        ('trace', 'debug', 'info', 'warn', 'warning', 'error', 'fatal', 'panic') else 'unknown')
    observed['plugin_class'] = ('absent' if plugin is None else 'optional' if plugin in optional else
        'required' if plugin == 'io.containerd.snapshotter.v1.overlayfs' else 'other-omitted')
    observed['message_class'] = ('absent' if message is None else 'skip-loading-plugin' if
        message == 'skip loading plugin' else 'other-omitted')
    observed['plugin_type_matches'] = bool(plugin) and fields.get('type') == plugin.rsplit('.', 1)[0]
    observed['skip_plugin_suffix'] = fields.get('error', '').endswith(': skip plugin')
    error = line if branch == 'hard-error-pattern' else fields.get('error', line)
    for pattern, classification in (
            (r'\bENOSPC\b|no space left on device', 'disk-full'),
            (r'\bEACCES\b|permission denied', 'permission-denied'),
            (r'failed to unpack|unpack(?:ing)? failed', 'unpack-failure'),
            (r'unexpected EOF', 'unexpected-eof'),
            (r'context cancel(?:l)?ed', 'context-cancelled'),
            (r'file already closed|use of closed file', 'closed-file')):
        if re.search(pattern, error, re.IGNORECASE):
            observed['error_class'] = classification
            break
    return observed


def validate_logs(output, report=None):
    # containerd 2.2.4 emits ErrSkipPlugin at INFO with an error= field.
    # Only known optional plugin skips are benign; overlayfs is required here.
    optional = {f'io.containerd.snapshotter.v1.{name}' for name in
                ('blockfile', 'btrfs', 'devmapper', 'erofs', 'zfs')}
    optional |= {'io.containerd.tracing.processor.v1.otlp', 'io.containerd.internal.v1.tracing'}

    def retain_rejection(line, index, branch):
        if report is not None:
            try:
                # First rejection only. Diagnostics cannot replace the failure.
                if 'log_rejection' not in report:
                    report['log_rejection'] = log_rejection_observation(line, index, branch, optional)
            except Exception:
                try:
                    # Even a classifier fault can retain the fixed gate branch.
                    report.setdefault('log_rejection', {'line_index': min(index, OUTPUT_LIMIT),
                        'line_index_clamped': index > OUTPUT_LIMIT, 'branch': branch, 'parse_state': 'unavailable'})
                except Exception:
                    pass

    for index, line in enumerate(output.splitlines(), 1):
        hard_error = re.search(r'\b(fatal|panic|ENOSPC)\b|no space left on device|'
                               r'failed to unpack|unpack(?:ing)? failed', line, re.IGNORECASE)
        if hard_error:
            retain_rejection(line, index, 'hard-error-pattern')
        require(not hard_error, 'import or daemon error observed')
        if not re.search(r'\berror\b', line, re.IGNORECASE):
            continue
        try:
            pairs = [token.split('=', 1) for token in shlex.split(line) if '=' in token]
        except ValueError:
            retain_rejection(line, index, 'parse-error')
            raise ProbeError('unparseable error-bearing daemon log') from None
        fields = dict(pairs)
        if len(fields) != len(pairs):
            retain_rejection(line, index, 'duplicate-fields')
        require(len(fields) == len(pairs), 'ambiguous error-bearing daemon log')
        plugin_id = fields.get('id', '')
        accepted = (fields.get('level') == 'info' and fields.get('msg') == 'skip loading plugin' and
                    plugin_id in optional and fields.get('type') == plugin_id.rsplit('.', 1)[0] and
                    fields.get('error', '').endswith(': skip plugin'))
        if not accepted:
            retain_rejection(line, index, 'error-event')
        require(accepted, 'import or daemon error observed')


def validate_delegation(host_namespace, worker_namespace, available, enabled, membership):
    require(all(re.fullmatch(r'cgroup:\[[0-9]+\]', value) for value in
                (host_namespace, worker_namespace)) and host_namespace != worker_namespace,
            'worker shares or cannot identify host cgroup namespace')
    required = {'cpu', 'memory', 'pids'}
    require(required <= set(available.split()) and required <= set(enabled.split()) and
            membership.strip() == '0::/init', 'nested cgroup v2 delegation incomplete')


def digest_observation(value):
    return value if isinstance(value, str) and SHA256.fullmatch(value) else None


def config_observation(config):
    """Allowlisted runtime identity only; never retain Config.Env or other config."""
    settings = config.get('config') if isinstance(config.get('config'), dict) else {}
    labels = settings.get('Labels') if isinstance(settings.get('Labels'), dict) else {}
    rootfs = config.get('rootfs') if isinstance(config.get('rootfs'), dict) else {}
    revision, layers = labels.get('org.opencontainers.image.revision'), rootfs.get('diff_ids')
    return {'os': config.get('os') if config.get('os') in ('linux', 'windows', 'darwin') else None,
            'architecture': config.get('architecture') if config.get('architecture') in
                ('arm64', 'amd64', 'arm', '386', 'riscv64', 's390x', 'ppc64le') else None,
            'source_revision': revision if isinstance(revision, str) and re.fullmatch(r'[0-9a-f]{40}', revision) else None,
            'rootfs_type': 'layers' if rootfs.get('type') == 'layers' else None,
            'diff_ids': [digest_observation(x) for x in layers]
                if isinstance(layers, list) and len(layers) <= MAX_LAYERS else None}


def image_observation(image):
    descriptor = image.get('Descriptor') if isinstance(image.get('Descriptor'), dict) else {}
    platform = config_observation(descriptor.get('platform') if isinstance(descriptor.get('platform'), dict) else {})
    rootfs = image.get('RootFS') if isinstance(image.get('RootFS'), dict) else {}
    result = config_observation({'os': image.get('Os'), 'architecture': image.get('Architecture'),
        'config': image.get('Config'), 'rootfs': {'type': rootfs.get('Type'), 'diff_ids': rootfs.get('Layers')}})
    size = descriptor.get('size')
    result.update({'image_id': digest_observation(image.get('Id')), 'descriptor': {
        'digest': digest_observation(descriptor.get('digest')),
        'media_type': descriptor.get('mediaType') if descriptor.get('mediaType') in
            (OCI + 'manifest.v1+json', OCI + 'index.v1+json', OCI + 'config.v1+json') else None,
        'bytes': size if type(size) is int and 0 < size < OUTPUT_LIMIT else None,
        'platform_present': 'platform' in descriptor, 'os': platform['os'], 'architecture': platform['architecture']}})
    return result


def validate_image(image, artifact):
    observed = image_observation(image)
    require(observed['image_id'] == artifact['image_manifest_digest'] and
            observed['descriptor']['digest'] == artifact['image_manifest_digest'] and
            observed['descriptor']['media_type'] == OCI + 'manifest.v1+json' and
            (not observed['descriptor']['platform_present'] or
             (observed['descriptor']['os'] == 'linux' and observed['descriptor']['architecture'] == 'arm64')) and
            observed['os'] == 'linux' and observed['architecture'] == 'arm64' and
            observed['source_revision'] == artifact['source_revision'], 'loaded image identity mismatch')


class Runner:
    def __init__(self, temp):
        self.temp = temp
        self.command_count = 0
        self.last_command = None
        # No inherited Docker context, TLS settings, credential helper or auth.
        self.env = {key: os.environ[key] for key in ('PATH', 'HOME') if key in os.environ}
        self.env.update({'LC_ALL': 'C', 'TMPDIR': str(temp)})

    def run(self, argv, *, stdin=None, timeout=120, binary=False):
        self.command_count += 1
        # Fixed-size, content-free provenance; never retain argv, env or output.
        observed = {'sequence': self.command_count,
                    'program': argv[0] if argv[0] in ('docker', 'sudo', 'findmnt', 'sync') else 'other',
                    'outcome': 'command-limit', 'exit_code': None, 'output_bytes': 0}
        self.last_command = observed
        require(self.command_count <= 512, 'control command limit exceeded')
        observed['outcome'] = 'started'
        def limit_output():
            resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT, OUTPUT_LIMIT))
        with tempfile.TemporaryFile(dir=self.temp) as output:
            try:
                result = subprocess.run(argv, stdin=stdin, stdout=output, stderr=subprocess.STDOUT,
                                        env=self.env, timeout=timeout, preexec_fn=limit_output)
            except subprocess.TimeoutExpired:
                observed.update(outcome='timeout', output_bytes=min(output.tell(), OUTPUT_LIMIT))
                raise ProbeError('bounded command timed out') from None
            except OSError as error:
                observed.update(outcome='launch-error', errno=error.errno)
                raise ProbeError('bounded command could not start') from None
            observed.update(exit_code=result.returncode, output_bytes=min(output.tell(), OUTPUT_LIMIT))
            observed['outcome'] = 'output-limit'
            require(output.tell() < OUTPUT_LIMIT, 'command output limit reached')
            observed['outcome'] = 'nonzero-exit'
            require(result.returncode == 0, 'bounded command failed')
            output.seek(0)
            data = output.read()
            observed['outcome'] = 'passed'
            return data if binary else data.decode('utf-8', errors='replace')


def remove_owned_container(runner, outer, cid, owner):
    require(re.fullmatch(r'[0-9a-f]{64}', cid) is not None and
            re.fullmatch(r'backend-import-[0-9]+-[0-9]+-[a-z0-9_]+', owner) is not None,
            'invalid cleanup identity')
    value = json.loads(runner.run(outer + ['container', 'inspect', cid]))
    require(len(value) == 1 and value[0].get('Id') == cid and
            value[0].get('Config', {}).get('Labels', {}).get(OWNER_LABEL) == owner,
            'container ownership mismatch')
    runner.run(outer + ['container', 'rm', '--force', cid])


class Probe:
    def __init__(self, archive, revision, output):
        self.archive, self.revision, self.output = archive, revision, output
        self.report = {'schema': 1, 'status': 'failed', 'deployment_approved': False,
                       'resident_capacity_approved': False, 'allocation_cap_bytes': CAP,
                       'observed_high_water_is_upper_bound': False,
                       'failure_cleanup_guarantee': False, 'samples': [],
                       'engine_requirements': {'docker': '29.5.2', 'containerd': '2.2.4',
                           'containerd_commit': RUNTIME_REVISION, 'driver': 'overlayfs'}}
        self.root = self.fs = self.runner = None
        self.loop = self.cid = None
        self.mounted = False
        self.stop = threading.Event()
        self.sampler = None
        self.sample_error = False
        self.image_created = False
        self.image_id = None
        self.uncertain_resource = False

    def sample(self):
        value = os.statvfs(self.fs)
        self.report['samples'].append({'elapsed_seconds': round(time.monotonic() - self.started, 3),
            'used_bytes': (value.f_blocks - value.f_bfree) * value.f_frsize,
            'available_bytes': value.f_bavail * value.f_frsize,
            'free_inodes': value.f_favail})

    def sampling(self):
        try:
            while not self.stop.wait(0.5):
                require(len(self.report['samples']) < 7200, 'sampling window exceeded')
                self.sample()
        except Exception:
            self.sample_error = True

    def inner(self, *args, **kwargs):
        return self.runner.run(self.outer + ['exec', self.cid, 'docker',
            '--host=unix:///proof/docker.sock', *args], **kwargs)

    def ctr(self, *args, **kwargs):
        return self.runner.run(self.outer + ['exec', self.cid, 'ctr',
            '--address', self.containerd_address, '--namespace', 'moby', *args], **kwargs)

    def capped_path(self, path, role='control'):
        self.report['substep'] = 'path-backing'
        observed = {'role': role, 'operation': 'validate', 'verified': False}
        self.report['path_check'] = observed
        require(isinstance(path, str) and path.startswith('/proof/') and
                '..' not in path.split('/'), 'unexpected inner path')
        observed['operation'] = 'resolve'
        resolved = self.runner.run(self.outer + ['exec', self.cid, 'readlink', '-f', path]).strip()
        observed['operation'] = 'device'
        device = int(self.runner.run(self.outer + ['exec', self.cid, 'stat', '-c', '%d', path]).strip())
        validate_backing(path, resolved, device, os.stat(self.fs).st_dev)
        observed['verified'] = True

    def check_paths(self):
        import tomllib  # Ubuntu 24.04 supplies Python 3.12; guards/tests work on 3.10.
        # Read the running process's actual argv, then the exact generated config.
        self.report['substep'] = 'containerd-config-argv'
        argv = self.runner.run(self.outer + ['exec', self.cid, 'sh', '-c',
            'for f in /proc/[0-9]*/comm; do '
            'if [ "$(cat "$f" 2>/dev/null)" = containerd ]; then '
            'tr "\\000" "\\n" < "${f%comm}cmdline"; fi; done']).splitlines()
        require(argv.count('--config') == 1, 'cannot identify managed containerd config')
        config_path = argv[argv.index('--config') + 1]
        self.capped_path(config_path, 'containerd-config')
        self.report['substep'] = 'containerd-config-read'
        config = tomllib.loads(self.runner.run(self.outer + ['exec', self.cid, 'cat', config_path]))
        root, state = config.get('root'), config.get('state')
        for role, path in (('containerd-root', root), ('containerd-state', state),
                           ('docker-root', '/proof/docker'), ('temporary', '/proof/tmp'), ('control', '/proof/run')):
            self.capped_path(path, role)
        # Fail closed if any plugin redirects storage away from its root.
        def validate_overrides(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key in ('root', 'root_path', 'state', 'state_path') and child:
                        self.capped_path(child, 'plugin-override')
                    validate_overrides(child)
        validate_overrides(config.get('plugins', {}))
        self.containerd_address = config.get('grpc', {}).get('address')
        self.capped_path(self.containerd_address, 'containerd-socket')
        content = root + '/io.containerd.content.v1.content'
        snapshots = root + '/io.containerd.snapshotter.v1.overlayfs'
        metadata = root + '/io.containerd.metadata.v1.bolt'
        # containerd v2.2.4 local.NewStore creates its root only on first ingest.
        # Only this exact derived child may be absent before import. Do not
        # create it, credit it as observed, or waive the post-import device check.
        self.report['substep'] = 'path-presence'
        self.report['path_check'] = {'role': 'content', 'operation': 'presence', 'verified': False}
        presence = self.runner.run(self.outer + ['exec', self.cid, 'sh', '-c',
            'if [ -L "$1" ]; then exit 1; elif [ -d "$1" ]; then printf present; '
            'elif [ ! -e "$1" ]; then printf absent; else exit 1; fi', 'probe-path', content]).strip()
        require(presence in ('present', 'absent'), 'invalid content path presence observation')
        lazy = self.report.setdefault('lazy_content_path', {'initially_absent': presence == 'absent',
            'parent_verified': True, 'post_import_verified': False})
        if presence == 'absent':
            require(self.report.get('phase') == 'nested-engine-startup', 'content store missing after import')
            self.capped_path(root, 'content-parent')
            lazy['parent_verified'] = True
        else:
            self.capped_path(content, 'content')
            if self.report.get('phase') != 'nested-engine-startup':
                lazy['post_import_verified'] = True
        for role, path in (('snapshots', snapshots), ('metadata', metadata)):
            self.capped_path(path, role)
        # Explicit environment and bind checks for the non-/proof aliases.
        for role, alias, target in (('alias-tmp', '/tmp', '/proof/tmp'), ('alias-run', '/run', '/proof/run'),
                                   ('alias-docker', '/var/lib/docker', '/proof/unused-docker'),
                                   ('alias-containerd', '/var/lib/containerd', '/proof/unused-containerd')):
            self.report['substep'] = 'path-backing'
            self.report['path_check'] = {'role': role, 'operation': 'device', 'verified': False}
            device = int(self.runner.run(self.outer + ['exec', self.cid, 'stat', '-c', '%d', alias]).strip())
            require(device == os.stat(self.fs).st_dev, 'uncapped writable daemon alias')
            self.capped_path(target, role + '-target')
        self.report['credited_paths'] = {'docker_root': '/proof/docker', 'containerd_root': root,
            'containerd_state': state, 'content_and_ingest': content if presence == 'present' else None, 'snapshots': snapshots,
            'metadata': metadata, 'temporary': '/proof/tmp', 'control': '/proof/run'}

    def worker_command(self):
        # Invoke the pinned image's official initializer before dockerd. Explicit
        # private cgroupns preserves isolation; no entrypoint-added TCP listener.
        return self.outer + ['create', '--name', self.owner, '--label', OWNER_LABEL + '=' + self.owner,
            '--privileged', '--read-only', '--cgroupns=private', '--network=none', '--memory=4g', '--cpus=2', '--pids-limit=512',
            '--log-driver=none',
            '--mount', 'type=bind,src=' + str(self.fs) + ',dst=/proof',
            '--mount', 'type=bind,src=' + str(self.fs / 'run') + ',dst=/run',
            '--mount', 'type=bind,src=' + str(self.fs / 'tmp') + ',dst=/tmp',
            '--mount', 'type=bind,src=' + str(self.fs / 'unused-docker') + ',dst=/var/lib/docker',
            '--mount', 'type=bind,src=' + str(self.fs / 'unused-containerd') + ',dst=/var/lib/containerd',
            '--env', 'DOCKER_TMPDIR=/proof/tmp', '--env', 'TMPDIR=/proof/tmp',
            *[argument for name in RUNTIME_BINARIES for argument in
              ('--mount', 'type=bind,src=' + str(self.fs.parent / 'runtime-tools' / name) +
               ',dst=/usr/local/bin/' + name + ',readonly')],
            '--entrypoint=sh', DIND, '-c', 'exec /usr/local/bin/dind dockerd "$@" > /proof/daemon.log 2>&1',
            'dockerd', '--config-file=/proof/daemon.json',
            '--host=unix:///proof/docker.sock', '--data-root=/proof/docker',
            '--exec-root=/proof/run/docker', '--pidfile=/proof/run/docker.pid',
            '--iptables=false', '--ip6tables=false', '--bridge=none', '--ip-forward=false', '--ip-masq=false']

    def check_engine(self, version, info):
        self.report['engine'] = engine_observation(version, info)
        validate_engine(version, info)
        self.report['engine']['validated'] = True

    def check_loaded_image(self, artifact):
        observed = self.report['loaded_identity'] = {'validated': False}
        target, config_digest = artifact['image_manifest_digest'], artifact['image_config_digest']
        require(digest_observation(target) and digest_observation(config_digest), 'invalid expected image digest')
        # Moby 29 resolves image IDs by containerd target.digest, not config digest.
        # The inspected artifact has exactly one flat manifest, never an index target.
        self.report['substep'] = 'loaded-image-inventory'
        ids = self.inner('image', 'ls', '--quiet', '--all', '--no-trunc').splitlines()
        observed.update(docker_image_count=len(ids), docker_image_ids=[digest_observation(x) for x in ids[:2]])
        refs = self.ctr('images', 'ls', '--quiet').splitlines()
        observed['containerd_image_count'] = len(refs)
        matching = self.ctr('images', 'ls', '--quiet', 'target.digest==' + target).splitlines()
        observed['matching_manifest_count'] = len(matching)
        require(ids == [target] and len(refs) == 1 and refs == matching and refs[0],
                'loaded image inventory is missing wrong or ambiguous')
        self.report['substep'] = 'loaded-image-inspect'
        loaded = json.loads(self.inner('image', 'inspect', target))
        observed['inspect_count'] = len(loaded) if isinstance(loaded, list) else None
        require(isinstance(loaded, list) and len(loaded) == 1 and isinstance(loaded[0], dict), 'missing loaded image')
        observed['docker'] = image_observation(loaded[0])
        validate_image(loaded[0], artifact)

        manifest, manifest_bytes = self.stored_image_document(target, 'manifest', observed)
        descriptor = manifest.get('config') if isinstance(manifest.get('config'), dict) else {}
        layers = manifest.get('layers')
        observed['manifest'].update(config_digest=digest_observation(descriptor.get('digest')),
                                    layer_count=len(layers) if isinstance(layers, list) else None)
        require(type(manifest.get('schemaVersion')) is int and manifest['schemaVersion'] == 2 and
                manifest.get('mediaType', OCI + 'manifest.v1+json') == OCI + 'manifest.v1+json' and
                descriptor.get('mediaType') == OCI + 'config.v1+json' and
                descriptor.get('digest') == config_digest and isinstance(layers, list) and
                len(layers) == artifact['layer_count'] and
                observed['docker']['descriptor']['bytes'] == manifest_bytes,
                'stored manifest descriptor mismatch')
        config, config_bytes = self.stored_image_document(config_digest, 'config', observed)
        metadata = config_observation(config)
        observed['config'].update(metadata)
        diff_ids = metadata['diff_ids']
        require(descriptor.get('size') == config_bytes and metadata['os'] == 'linux' and
                metadata['architecture'] == 'arm64' and metadata['source_revision'] == artifact['source_revision'] and
                metadata['rootfs_type'] == 'layers' and isinstance(diff_ids, list) and
                0 < len(diff_ids) == len(layers) <= MAX_LAYERS and all(diff_ids),
                'stored config identity mismatch')
        require(all(observed['docker'][key] == value for key, value in metadata.items()),
                'Docker config or rootfs differs from stored config')
        observed['validated'] = True
        return target

    def stored_image_document(self, digest, role, observed):
        self.report['substep'] = 'stored-image-' + role
        data = self.ctr('content', 'get', digest, binary=True)
        require(isinstance(data, bytes) and 0 < len(data) < OUTPUT_LIMIT, 'stored image metadata exceeds bound')
        actual = 'sha256:' + hashlib.sha256(data).hexdigest()
        observed[role] = {'digest': actual, 'bytes': len(data)}
        require(actual == digest, 'stored image metadata digest mismatch')
        try:
            return decode_json(data), len(data)
        except ValueError:
            raise ProbeError('invalid stored image metadata') from None

    def check_version_runtimes(self, image_id):
        require(digest_observation(image_id), 'invalid runtime image identity')
        for name, command, expected in (
            ('node', ['-e', 'if(process.platform!=="linux"||process.arch!=="arm64")process.exit(1);console.log("node-arm64-ok "+process.version)'], 'node-arm64-ok'),
            ('native', ['/app/apps/agent/scripts/verify-native-runtime.cjs'], 'Native Agent runtime verified: linux-arm64;')):
            self.report['substep'] = name + '-runtime-create'
            runtime = self.inner('create', '--name', self.owner + '-' + name, '--network=none', '--read-only',
                '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=512m',
                '--cpus=1', '--log-driver=none', '--entrypoint=node', image_id, *command).strip()
            require(re.fullmatch(r'[0-9a-f]{64}', runtime) is not None, 'unexpected runtime identifier')
            self.report['substep'] = name + '-runtime-start'
            result = self.inner('start', '--attach', runtime, timeout=90)
            self.report['substep'] = name + '-runtime-result'
            inspected = json.loads(self.inner('container', 'inspect', runtime))
            require(isinstance(inspected, list) and len(inspected) == 1 and inspected[0].get('Id') == runtime,
                    'missing version-only runtime container')
            actual_image = digest_observation(inspected[0].get('Image'))
            self.report.setdefault('runtime_image_ids', {})[name] = actual_image
            require(actual_image == image_id, 'version-only runtime image mismatch')
            state = inspected[0]['State']
            require(state['Status'] == 'exited' and state['ExitCode'] == 0 and not state.get('OOMKilled') and
                    expected in result, 'version-only runtime failed')
            validate_logs(result, self.report)
            # Retain stopped version-probe writable layers through stabilization.
            self.report[name + '_version_probe_passed'] = True
            pattern = r'node-arm64-ok v([0-9]+\.[0-9]+\.[0-9]+)' if name == 'node' else r'linux-arm64; ([0-9]+\.[0-9]+\.[0-9]+)'
            version_match = re.search(pattern, result)
            require(version_match is not None, 'version-only output not recognized')
            self.report[name + '_version'] = version_match[1]

    def check_runtime_tools(self):
        observed = self.report.setdefault('runtime_tool_hashes', {})
        for name, spec in RUNTIME_BINARIES.items():
            path = '/usr/local/bin/' + name
            output = self.runner.run(self.outer + ['exec', self.cid, 'sha256sum', path]).strip()
            match = re.fullmatch(r'([0-9a-f]{64})  ' + re.escape(path), output)
            observed[name] = match[1] if match else None
            require(observed[name] == spec['sha256'], 'bound runtime binary digest mismatch')
        # Verify the executable of the running managed process, not only a path.
        output = self.runner.run(self.outer + ['exec', self.cid, 'sh', '-c',
            'for f in /proc/[0-9]*/comm; do '
            'if [ "$(cat "$f" 2>/dev/null)" = containerd ]; then '
            'sha256sum "${f%comm}exe"; fi; done']).strip()
        match = re.fullmatch(r'([0-9a-f]{64})  /proc/[0-9]+/exe', output)
        observed['running_containerd'] = match[1] if match else None
        require(observed['running_containerd'] == RUNTIME_BINARIES['containerd']['sha256'],
                'running containerd binary digest mismatch')
        self.report['runtime_tools_verified'] = True

    def check_delegation(self):
        def read(path):
            return self.runner.run(self.outer + ['exec', self.cid, 'cat', path]).strip()
        # %T is a utility-specific display name (BusyBox may say UNKNOWN).
        # %t exposes the kernel statfs.f_type; only the cgroup-v2 magic passes.
        magic = self.runner.run(self.outer + ['exec', self.cid, 'stat', '-f', '-c', '%t',
                                            '/sys/fs/cgroup']).strip()
        parsed_magic = int(magic, 16) if re.fullmatch(r'(?:0[xX])?[0-9a-fA-F]{1,16}', magic) else None
        observation = {'statfs_type_hex': hex(parsed_magic) if parsed_magic is not None else None,
                       'numeric_observation_valid': parsed_magic is not None}
        # Retain sanitized numeric evidence even when a later read or gate fails.
        self.report['cgroup_filesystem'] = observation
        label = self.runner.run(self.outer + ['exec', self.cid, 'stat', '-f', '-c', '%T',
                                            '/sys/fs/cgroup']).strip()
        observation['statfs_type_label'] = label if re.fullmatch(r'[A-Za-z0-9_ ()-]{1,64}', label) else 'unrecognized'
        require(parsed_magic == CGROUP2_SUPER_MAGIC, 'nested cgroup filesystem is not v2')
        host_namespace = os.readlink('/proc/self/ns/cgroup')
        worker_namespace = self.runner.run(self.outer + ['exec', self.cid, 'readlink',
                                                       '/proc/1/ns/cgroup']).strip()
        available = read('/sys/fs/cgroup/cgroup.controllers')
        enabled = read('/sys/fs/cgroup/cgroup.subtree_control')
        membership = read('/proc/1/cgroup')
        validate_delegation(host_namespace, worker_namespace, available, enabled, membership)
        self.report['cgroup_delegation'] = {'version': 2, 'private_namespace_verified': True,
            'controllers_available': sorted(available.split()),
            'controllers_enabled': sorted(enabled.split()), 'daemon_membership': '/init'}

    def execute(self):
        self.report['phase'] = 'artifact-reinspection'
        prior = json.loads((self.archive.parent / 'inspection.json').read_text())
        require((self.archive.parent / 'source-revision.txt').read_text() == self.revision + '\n',
                'source sidecar mismatch')
        artifact = inspect_archive(self.archive, self.revision)
        validate_artifact(artifact, prior, self.revision, (self.archive.parent / 'SHA256SUMS').read_text())
        self.report['artifact'] = artifact
        self.report['run_id'] = os.environ['GITHUB_RUN_ID']
        self.report['run_attempt'] = os.environ['GITHUB_RUN_ATTEMPT']
        temp = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
        require(temp.is_dir() and not self.archive.is_relative_to(self.output), 'invalid input/output boundary')
        self.root = Path(tempfile.mkdtemp(prefix='backend-import-' + self.report['run_id'] + '-' +
                                        self.report['run_attempt'] + '-', dir=temp))
        self.owner = self.root.name
        self.fs = self.root / 'fs'
        self.fs.mkdir()
        config = self.root / 'client'
        config.mkdir()
        (config / 'config.json').write_text('{}\n')
        self.runner = Runner(self.root)
        self.outer = ['docker', '--config', str(config), '--host=unix:///var/run/docker.sock']
        self.backing = self.root / 'disk.img'
        self.report['phase'] = 'runtime-bootstrap-verification'
        self.report['runtime_tools'] = prepare_runtime_tools(self.root)
        self.report['phase'] = 'capped-filesystem-creation'
        # Allocate in this process: the command-output RLIMIT must not truncate
        # the separately bounded 2 GiB backing file. This is never grown later.
        with self.backing.open('xb') as disk:
            os.posix_fallocate(disk.fileno(), 0, CAP)
        require(self.backing.stat().st_size == CAP, 'backing file size mismatch')
        self.uncertain_resource = True
        self.loop = self.runner.run(['sudo', '-n', 'losetup', '--find', '--show', str(self.backing)]).strip()
        require(re.fullmatch(r'/dev/loop[0-9]+', self.loop) is not None, 'unexpected loop identifier')
        self.uncertain_resource = False
        self.check_loop()
        self.runner.run(['sudo', '-n', 'mkfs.ext4', '-q', '-b', '4096', '-m', '0',
                         '-E', 'lazy_itable_init=0,lazy_journal_init=0', self.loop])
        self.uncertain_resource = True
        self.runner.run(['sudo', '-n', 'mount', '-t', 'ext4', '-o', 'rw,relatime', self.loop, str(self.fs)])
        self.mounted = True
        self.uncertain_resource = False
        details = self.runner.run(['sudo', '-n', 'dumpe2fs', '-h', self.loop])
        fields = dict(line.split(':', 1) for line in details.splitlines() if ':' in line)
        metadata = {key: fields[key].strip() for key in ('Filesystem features', 'Block count',
                    'Block size', 'Inode count', 'Inode size', 'Journal size') if key in fields}
        total = int(metadata['Block count']) * int(metadata['Block size'])
        mount = self.mount_info()
        validate_mount(mount, str(self.fs), self.loop, int(metadata['Block size']), total)
        self.report['filesystem'] = {'bytes': total, 'metadata': metadata, 'type': mount['fstype'],
                                    'options': mount['options'], 'mount_target': str(self.fs),
                                    'mount_source': self.loop, 'device_id': os.stat(self.fs).st_dev, 'fresh': True}
        self.started = time.monotonic()
        self.sample()
        self.sampler = threading.Thread(target=self.sampling, daemon=True)
        self.sampler.start()
        self.runner.run(['sudo', '-n', 'chown', str(os.getuid()) + ':' + str(os.getgid()), str(self.fs)])
        for path in ('docker', 'run', 'tmp', 'unused-docker', 'unused-containerd'):
            (self.fs / path).mkdir()
        (self.fs / 'daemon.json').write_text(json.dumps({'features': {'containerd-snapshotter': True}}))
        self.report['phase'] = 'nested-engine-startup'
        self.report['substep'] = 'worker-image'
        existing = self.runner.run(self.outer + ['image', 'ls', '--quiet', '--no-trunc']).splitlines()
        self.runner.run(self.outer + ['pull', '--platform=linux/arm64', DIND], timeout=300)
        image = json.loads(self.runner.run(self.outer + ['image', 'inspect', DIND]))[0]
        self.image_id = image['Id']
        self.image_created = self.image_id not in existing
        require(image['Architecture'] == 'arm64' and image['Os'] == 'linux', 'wrong worker image platform')
        self.report['worker_exceptions'] = {'image': DIND, 'image_virtual_bytes': image['Size'],
            'read_only_root': True, 'memory_limit_bytes': 4 * 1024**3, 'cpu_limit': 2,
            'pids_limit': 512, 'outer_container_log_bytes': 0, 'daemon_log_on_capped_filesystem': True,
            'command_output_max_bytes_each': OUTPUT_LIMIT, 'command_count_limit': 512,
            'outer_worker_container_limit': 1, 'host_control_bytes_upper_bound': None,
            'runtime_binary_bytes': self.report['runtime_tools']['binary_bytes'],
            'runtime_download_peak_bytes': RUNTIME_ARCHIVE_BYTES + self.report['runtime_tools']['binary_bytes'],
            'outside_cap': 'archive, pinned read-only worker image and runtime binaries, host Docker control metadata, '
                           'host daemon logging and bounded command capture; not resident import allocations'}
        self.uncertain_resource = True
        self.report['substep'] = 'worker-create'
        self.cid = self.runner.run(self.worker_command()).strip()
        require(re.fullmatch(r'[0-9a-f]{64}', self.cid) is not None, 'unexpected worker identifier')
        self.uncertain_resource = False
        self.report['substep'] = 'worker-start'
        self.runner.run(self.outer + ['start', self.cid])
        self.report['substep'] = 'engine-ready'
        for attempt in range(30):
            try:
                version = json.loads(self.inner('version', '--format', '{{json .Server}}'))
                self.report['engine'] = engine_observation(version)
                break
            except ProbeError:
                if attempt == 29:
                    raise
                time.sleep(1)
        self.report['substep'] = 'worker-boundaries'
        worker = json.loads(self.runner.run(self.outer + ['container', 'inspect', self.cid]))[0]
        validate_worker(worker, str(self.fs))
        self.report['substep'] = 'runtime-tools'
        self.check_runtime_tools()
        self.report['substep'] = 'cgroup-delegation'
        self.check_delegation()
        self.report['substep'] = 'engine-info'
        info = json.loads(self.inner('info', '--format', '{{json .}}'))
        self.check_engine(version, info)
        self.check_paths()
        self.report['substep'] = 'empty-docker-images'
        require(not self.inner('image', 'ls', '--quiet', '--all').strip(), 'nonempty initial image/content store')
        self.report['substep'] = 'empty-containerd-images'
        require(not self.ctr('images', 'ls', '--quiet').strip(), 'nonempty initial image/content store')
        self.report['substep'] = 'empty-containerd-content'
        require(not self.ctr('content', 'ls', '--quiet').strip(), 'nonempty initial image/content store')
        self.report['substep'] = 'empty-containerd-snapshots'
        snapshots = self.ctr('snapshots', '--snapshotter', 'overlayfs', 'ls').splitlines()
        require(len(snapshots) <= 1, 'nonempty initial snapshots')
        self.report['empty_store_verified'] = True
        self.report['phase'] = 'streaming-import'
        self.report['substep'] = 'archive-load'
        with self.archive.open('rb') as stream:
            result = self.runner.run(self.outer + ['exec', '-i', self.cid, 'docker',
                '--host=unix:///proof/docker.sock', 'load', '--platform=linux/arm64'], stdin=stream, timeout=900)
        validate_logs(result, self.report)
        # Repeat integrity after streaming; never accept changed input by accident.
        self.report['substep'] = 'archive-reinspection-after-load'
        after = inspect_archive(self.archive, self.revision)
        validate_artifact(after, artifact, self.revision, (self.archive.parent / 'SHA256SUMS').read_text())
        self.report['substep'] = 'loaded-image-identity'
        runtime_image = self.check_loaded_image(artifact)
        self.report['substep'] = 'complete-unpack'
        validate_unpack(self.ctr('images', 'check', '--snapshotter', 'overlayfs'), 1, runtime_image)
        self.report['complete_unpack_verified'] = True
        self.report['phase'] = 'version-only-runtime'
        self.check_version_runtimes(runtime_image)
        self.report['phase'] = 'idle-stabilization'
        self.report['substep'] = 'usage-stabilization'
        previous = None
        stable = 0
        for _ in range(30):
            self.runner.run(['sync', '-f', str(self.fs)])
            self.sample()
            current = self.report['samples'][-1]['used_bytes']
            stable = stable + 1 if current == previous else 0
            previous = current
            if stable >= 5:
                break
            time.sleep(1)
        require(stable >= 5, 'filesystem did not stabilize')
        require(self.check_loaded_image(artifact) == runtime_image, 'loaded image identity changed after runtime')
        self.report['substep'] = 'final-unpack'
        validate_unpack(self.ctr('images', 'check', '--snapshotter', 'overlayfs'), 1, runtime_image)
        self.capped_path('/proof/daemon.log', 'daemon-log')
        self.report['substep'] = 'daemon-log-check'
        validate_logs(self.runner.run(self.outer + ['exec', self.cid, 'cat', '/proof/daemon.log']), self.report)
        self.check_paths()
        self.report['substep'] = 'allocation-sampling'
        require(not self.sample_error, 'allocation sampling failed')
        self.report['substep'] = 'final-runtime-tools'
        self.check_runtime_tools()
        self.report['idle_stabilized'] = True
        self.report['no_import_errors_observed'] = True
        self.report['status'] = 'passed'
        self.report['phase'] = 'complete'
        self.report['substep'] = 'complete'

    def check_loop(self):
        value = json.loads(self.runner.run(['sudo', '-n', 'losetup', '--json', '--list',
                          '--output', 'NAME,BACK-FILE', self.loop]))
        validate_loop(value, self.loop, str(self.backing))

    def mount_info(self):
        value = json.loads(self.runner.run(['findmnt', '--json', '--mountpoint', str(self.fs),
                          '--output', 'TARGET,SOURCE,FSTYPE,OPTIONS']))
        require(len(value.get('filesystems', [])) == 1, 'ambiguous mount')
        return value['filesystems'][0]

    def cleanup(self):
        # Snapshot the primary failure before cleanup replaces last_command.
        if self.report['status'] != 'passed':
            self.report['failure_context'] = {'substep': self.report.get('substep'),
                'path_check': dict(self.report['path_check']) if self.report.get('substep') in
                    ('path-backing', 'path-presence') else None,
                'command': dict(self.runner.last_command) if getattr(self.runner, 'last_command', None) else None}
        self.stop.set()
        if self.sampler:
            self.sampler.join(timeout=2)
        try:
            require(not self.uncertain_resource, 'resource creation outcome unknown')
            if self.cid:
                remove_owned_container(self.runner, self.outer, self.cid, self.owner)
            if self.mounted:
                self.check_loop()
                mount = self.mount_info()
                require(mount['target'] == str(self.fs) and mount['source'] == self.loop,
                        'cleanup mount ownership mismatch')
                self.runner.run(['sudo', '-n', 'umount', str(self.fs)])
                self.mounted = False
            if self.loop:
                self.check_loop()
                self.runner.run(['sudo', '-n', 'losetup', '--detach', self.loop])
                self.loop = None
            if self.image_created:
                image = json.loads(self.runner.run(self.outer + ['image', 'inspect', DIND]))[0]
                require(image['Id'] == self.image_id, 'worker image identity changed')
                # No --force and no removal of preexisting/shared images.
                self.runner.run(self.outer + ['image', 'rm', DIND])
            if self.root and self.backing.exists():
                self.backing.unlink()
            if self.root:
                tools = self.root / 'runtime-tools'
                if tools.exists():
                    for name in (*RUNTIME_BINARIES, 'package.tar.gz'):
                        path = tools / name
                        if path.exists():
                            require(path.is_file() and not path.is_symlink(), 'runtime cleanup ownership mismatch')
                            path.unlink()
                    tools.rmdir()
            self.report['cleanup'] = 'passed'
        except Exception:
            self.report['cleanup_failed_command'] = dict(self.runner.last_command) if getattr(self.runner, 'last_command', None) else None
            self.report['cleanup'] = 'failed; unknown resources left for ephemeral runner teardown'
            self.report['status'] = 'failed'
        if self.runner and hasattr(self.runner, 'command_count'):
            self.report['control_commands_executed'] = self.runner.command_count
        if self.report['samples']:
            self.report['observed_high_water_bytes'] = max(x['used_bytes'] for x in self.report['samples'])
        self.output.mkdir(parents=True, exist_ok=True)
        (self.output / 'proof.json').write_text(json.dumps(self.report, indent=2) + '\n')
        (self.output / 'probe.log').write_text('Import-only disposable CI proof: ' + self.report['status'] + '\n' +
            'Cleanup: ' + self.report['cleanup'] + '\n' +
            'The fixed cap bounds credited paths; samples are not a peak upper bound.\n' +
            'No resident capacity, startup, WAL/growth, activation or recovery approval.\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--disposable-ci-opt-in', action='store_true')
    args = parser.parse_args()
    # Guard precedes even artifact/output/resource creation, including on macOS.
    validate_environment(os.environ, args.disposable_ci_opt_in, platform.system(), platform.machine())
    require(not args.output.exists(), 'proof output must be fresh')
    proof = Probe(args.archive.resolve(strict=True), args.revision, args.output.resolve())
    def interrupted(_signum, _frame):
        raise ProbeError('probe interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        proof.execute()
    except ProbeError as error:
        proof.report['failure'] = str(error)  # Only constant diagnostics from our checks.
    except Exception:
        # Do not persist arbitrary exception/command/image/env content.
        proof.report['failure'] = 'probe failed closed; phase and sanitized evidence retained'
    finally:
        proof.cleanup()
    return 0 if proof.report['status'] == 'passed' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except ProbeError as error:
        print('Import probe refused: ' + str(error))
        raise SystemExit(1)
