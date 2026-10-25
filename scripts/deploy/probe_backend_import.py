#!/usr/bin/env python3
"""Explicitly opted-in, disposable GitHub ARM runner import proof; never deployment.

A fixed ext4 device bounds the credited data paths. Samples are observations,
not peak upper bounds. Outer runner/control/image costs are separate exceptions.
Only sanitized, allowlisted evidence is retained; command output is not published.
"""
import argparse
import json
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

from inspect_backend_oci import inspect_archive

CAP = 2 * 1024**3
OUTPUT_LIMIT = 4 * 1024**2
CGROUP2_SUPER_MAGIC = 0x63677270  # Linux include/uapi/linux/magic.h, statfs.f_type.
DIND = 'docker.io/library/docker@sha256:5256d1242c894ee092a567c4385fe682071c05c2056c1e90953717cec0aa3fbe'
OWNER_LABEL = 'capir.import-probe.owner'


class ProbeError(ValueError):
    """Only constant, content-free diagnostics belong in this exception."""


def require(condition, message):
    if not condition:
        raise ProbeError(message)


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
    mounts = worker.get('Mounts', [])
    require(len(mounts) == len(expected) and all(
        mount.get('Type') == 'bind' and mount.get('RW') is True and
        expected.get(mount.get('Destination')) == mount.get('Source') for mount in mounts),
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
    components = version.get('Components', [])
    require(any(x.get('Name') == 'containerd' and x.get('Version', '').removeprefix('v') == '2.2.4'
                for x in components), 'wrong containerd version')
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


def validate_unpack(output, expected_count):
    rows = [line.split() for line in output.splitlines()[1:] if line.strip()]
    require(expected_count > 0 and len(rows) == expected_count, 'missing image unpack evidence')
    for row in rows:
        require('complete' in row and row[-1] == 'true' and 'incomplete' not in row,
                'incomplete image content or unpack')
        counts = [re.fullmatch(r'\(([0-9]+)/([0-9]+)\)', token) for token in row]
        require(any(m and int(m[1]) > 0 and m[1] == m[2] for m in counts),
                'incomplete content count')


def validate_logs(output):
    # containerd 2.2.4 emits ErrSkipPlugin at INFO with an error= field.
    # Only known optional plugin skips are benign; overlayfs is required here.
    optional = {f'io.containerd.snapshotter.v1.{name}' for name in
                ('blockfile', 'btrfs', 'devmapper', 'erofs', 'zfs')}
    optional |= {'io.containerd.tracing.processor.v1.otlp', 'io.containerd.internal.v1.tracing'}
    for line in output.splitlines():
        require(not re.search(r'\b(fatal|panic|ENOSPC)\b|no space left on device|'
                              r'failed to unpack|unpack(?:ing)? failed', line, re.IGNORECASE),
                'import or daemon error observed')
        if not re.search(r'\berror\b', line, re.IGNORECASE):
            continue
        try:
            pairs = [token.split('=', 1) for token in shlex.split(line) if '=' in token]
        except ValueError:
            raise ProbeError('unparseable error-bearing daemon log') from None
        fields = dict(pairs)
        require(len(fields) == len(pairs), 'ambiguous error-bearing daemon log')
        plugin_id = fields.get('id', '')
        require(fields.get('level') == 'info' and fields.get('msg') == 'skip loading plugin' and
                plugin_id in optional and fields.get('type') == plugin_id.rsplit('.', 1)[0] and
                fields.get('error', '').endswith(': skip plugin'),
                'import or daemon error observed')


def validate_delegation(host_namespace, worker_namespace, available, enabled, membership):
    require(all(re.fullmatch(r'cgroup:\[[0-9]+\]', value) for value in
                (host_namespace, worker_namespace)) and host_namespace != worker_namespace,
            'worker shares or cannot identify host cgroup namespace')
    required = {'cpu', 'memory', 'pids'}
    require(required <= set(available.split()) and required <= set(enabled.split()) and
            membership.strip() == '0::/init', 'nested cgroup v2 delegation incomplete')


def validate_image(image, artifact):
    require(image.get('Id') == artifact['image_config_digest'] and image.get('Os') == 'linux' and
            image.get('Architecture') == 'arm64' and
            image.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') ==
            artifact['source_revision'], 'loaded image identity mismatch')


class Runner:
    def __init__(self, temp):
        self.temp = temp
        self.command_count = 0
        # No inherited Docker context, TLS settings, credential helper or auth.
        self.env = {key: os.environ[key] for key in ('PATH', 'HOME') if key in os.environ}
        self.env.update({'LC_ALL': 'C', 'TMPDIR': str(temp)})

    def run(self, argv, *, stdin=None, timeout=120):
        self.command_count += 1
        require(self.command_count <= 512, 'control command limit exceeded')
        def limit_output():
            resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT, OUTPUT_LIMIT))
        with tempfile.TemporaryFile(dir=self.temp) as output:
            try:
                result = subprocess.run(argv, stdin=stdin, stdout=output, stderr=subprocess.STDOUT,
                                        env=self.env, timeout=timeout, preexec_fn=limit_output)
            except subprocess.TimeoutExpired:
                raise ProbeError('bounded command timed out') from None
            require(output.tell() < OUTPUT_LIMIT, 'command output limit reached')
            output.seek(0)
            text = output.read().decode('utf-8', errors='replace')
            require(result.returncode == 0, 'bounded command failed')
            return text


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
                       'failure_cleanup_guarantee': False, 'samples': []}
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

    def ctr(self, *args):
        return self.runner.run(self.outer + ['exec', self.cid, 'ctr',
            '--address', self.containerd_address, '--namespace', 'moby', *args])

    def capped_path(self, path):
        require(isinstance(path, str) and path.startswith('/proof/') and
                '..' not in path.split('/'), 'unexpected inner path')
        resolved = self.runner.run(self.outer + ['exec', self.cid, 'readlink', '-f', path]).strip()
        device = int(self.runner.run(self.outer + ['exec', self.cid, 'stat', '-c', '%d', path]).strip())
        validate_backing(path, resolved, device, os.stat(self.fs).st_dev)

    def check_paths(self):
        import tomllib  # Ubuntu 24.04 supplies Python 3.12; guards/tests work on 3.10.
        # Read the running process's actual argv, then the exact generated config.
        argv = self.runner.run(self.outer + ['exec', self.cid, 'sh', '-c',
            'for f in /proc/[0-9]*/comm; do '
            'if [ "$(cat "$f" 2>/dev/null)" = containerd ]; then '
            'tr "\\000" "\\n" < "${f%comm}cmdline"; fi; done']).splitlines()
        require(argv.count('--config') == 1, 'cannot identify managed containerd config')
        config_path = argv[argv.index('--config') + 1]
        self.capped_path(config_path)
        config = tomllib.loads(self.runner.run(self.outer + ['exec', self.cid, 'cat', config_path]))
        root, state = config.get('root'), config.get('state')
        for path in (root, state, '/proof/docker', '/proof/tmp', '/proof/run'):
            self.capped_path(path)
        # Fail closed if any plugin redirects storage away from its root.
        def validate_overrides(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key in ('root', 'root_path', 'state', 'state_path') and child:
                        self.capped_path(child)
                    validate_overrides(child)
        validate_overrides(config.get('plugins', {}))
        self.containerd_address = config.get('grpc', {}).get('address')
        self.capped_path(self.containerd_address)
        content = root + '/io.containerd.content.v1.content'
        snapshots = root + '/io.containerd.snapshotter.v1.overlayfs'
        metadata = root + '/io.containerd.metadata.v1.bolt'
        for path in (content, snapshots, metadata):
            self.capped_path(path)
        # Explicit environment and bind checks for the non-/proof aliases.
        for alias, target in (('/tmp', '/proof/tmp'), ('/run', '/proof/run'),
                              ('/var/lib/docker', '/proof/unused-docker'),
                              ('/var/lib/containerd', '/proof/unused-containerd')):
            device = int(self.runner.run(self.outer + ['exec', self.cid, 'stat', '-c', '%d', alias]).strip())
            require(device == os.stat(self.fs).st_dev, 'uncapped writable daemon alias')
            self.capped_path(target)
        self.report['credited_paths'] = {'docker_root': '/proof/docker', 'containerd_root': root,
            'containerd_state': state, 'content_and_ingest': content, 'snapshots': snapshots,
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
            '--entrypoint=sh', DIND, '-c', 'exec /usr/local/bin/dind dockerd "$@" > /proof/daemon.log 2>&1',
            'dockerd', '--config-file=/proof/daemon.json',
            '--host=unix:///proof/docker.sock', '--data-root=/proof/docker',
            '--exec-root=/proof/run/docker', '--pidfile=/proof/run/docker.pid',
            '--iptables=false', '--ip6tables=false', '--bridge=none', '--ip-forward=false', '--ip-masq=false']

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
        self.report['phase'] = 'capped-filesystem-creation'
        self.backing = self.root / 'disk.img'
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
            'outside_cap': 'archive, pinned read-only worker image, host Docker control metadata, '
                           'host daemon logging and bounded command capture; not resident import allocations'}
        self.uncertain_resource = True
        self.cid = self.runner.run(self.worker_command()).strip()
        require(re.fullmatch(r'[0-9a-f]{64}', self.cid) is not None, 'unexpected worker identifier')
        self.uncertain_resource = False
        self.runner.run(self.outer + ['start', self.cid])
        for attempt in range(30):
            try:
                version = json.loads(self.inner('version', '--format', '{{json .Server}}'))
                break
            except ProbeError:
                if attempt == 29:
                    raise
                time.sleep(1)
        worker = json.loads(self.runner.run(self.outer + ['container', 'inspect', self.cid]))[0]
        validate_worker(worker, str(self.fs))
        self.check_delegation()
        info = json.loads(self.inner('info', '--format', '{{json .}}'))
        validate_engine(version, info)
        self.report['engine'] = {'docker': version['Version'], 'containerd': '2.2.4',
                                 'platform': 'linux/arm64', 'driver': info['Driver'],
                                 'driver_status': [['driver-type', 'io.containerd.snapshotter.v1']]}
        self.check_paths()
        require(not self.inner('image', 'ls', '--quiet', '--all').strip() and
                not self.ctr('images', 'ls', '--quiet').strip() and
                not self.ctr('content', 'ls', '--quiet').strip(), 'nonempty initial image/content store')
        snapshots = self.ctr('snapshots', '--snapshotter', 'overlayfs', 'ls').splitlines()
        require(len(snapshots) <= 1, 'nonempty initial snapshots')
        self.report['empty_store_verified'] = True
        self.report['phase'] = 'streaming-import'
        with self.archive.open('rb') as stream:
            result = self.runner.run(self.outer + ['exec', '-i', self.cid, 'docker',
                '--host=unix:///proof/docker.sock', 'load', '--platform=linux/arm64'], stdin=stream, timeout=900)
        validate_logs(result)
        # Repeat integrity after streaming; never accept changed input by accident.
        after = inspect_archive(self.archive, self.revision)
        validate_artifact(after, artifact, self.revision, (self.archive.parent / 'SHA256SUMS').read_text())
        loaded = json.loads(self.inner('image', 'inspect', artifact['image_config_digest']))
        require(len(loaded) == 1, 'missing loaded image')
        validate_image(loaded[0], artifact)
        refs = self.ctr('images', 'ls', '--quiet').splitlines()
        validate_unpack(self.ctr('images', 'check', '--snapshotter', 'overlayfs'), len(refs))
        self.report['complete_unpack_verified'] = True
        self.report['phase'] = 'version-only-runtime'
        for name, command, expected in (
            ('node', ['-e', 'if(process.platform!=="linux"||process.arch!=="arm64")process.exit(1);console.log("node-arm64-ok "+process.version)'], 'node-arm64-ok'),
            ('native', ['/app/apps/agent/scripts/verify-native-runtime.cjs'], 'Native Agent runtime verified: linux-arm64;')):
            runtime = self.inner('create', '--name', self.owner + '-' + name, '--network=none', '--read-only',
                '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=512m',
                '--cpus=1', '--log-driver=none', '--entrypoint=node', artifact['image_config_digest'], *command).strip()
            require(re.fullmatch(r'[0-9a-f]{64}', runtime) is not None, 'unexpected runtime identifier')
            result = self.inner('start', '--attach', runtime, timeout=90)
            state = json.loads(self.inner('container', 'inspect', runtime))[0]['State']
            require(state['Status'] == 'exited' and state['ExitCode'] == 0 and not state.get('OOMKilled') and
                    expected in result, 'version-only runtime failed')
            validate_logs(result)
            # Retain stopped version-probe writable layers through stabilization.
            self.report[name + '_version_probe_passed'] = True
            pattern = r'node-arm64-ok v([0-9]+\.[0-9]+\.[0-9]+)' if name == 'node' else r'linux-arm64; ([0-9]+\.[0-9]+\.[0-9]+)'
            version_match = re.search(pattern, result)
            require(version_match is not None, 'version-only output not recognized')
            self.report[name + '_version'] = version_match[1]
        self.report['phase'] = 'idle-stabilization'
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
        validate_unpack(self.ctr('images', 'check', '--snapshotter', 'overlayfs'), len(refs))
        self.capped_path('/proof/daemon.log')
        validate_logs(self.runner.run(self.outer + ['exec', self.cid, 'cat', '/proof/daemon.log']))
        self.check_paths()
        require(not self.sample_error, 'allocation sampling failed')
        self.report['idle_stabilized'] = True
        self.report['no_import_errors_observed'] = True
        self.report['status'] = 'passed'
        self.report['phase'] = 'complete'

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
            self.report['cleanup'] = 'passed'
        except Exception:
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
