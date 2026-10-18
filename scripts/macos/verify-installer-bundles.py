"""Compare complete bundle structure without following symlinks or normalizing links."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def manifest(root):
    if root.is_symlink() or not root.is_dir() or root.suffix != '.app':
        raise ValueError('Expected an actual app bundle directory, not a root alias.')
    result = {}
    def unreadable(error):
        raise error
    for directory, folders, files in os.walk(root, followlinks=False, onerror=unreadable):
        for name in folders + files:
            path = Path(directory) / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                value = {'type': 'symlink', 'target': os.readlink(path)}
            elif stat.S_ISDIR(mode):
                value = {'type': 'directory'}
            elif stat.S_ISREG(mode):
                with path.open('rb') as source:
                    digest = hashlib.sha256()
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        digest.update(chunk)
                value = {'type': 'file', 'sha256': digest.hexdigest()}
            else:
                raise ValueError('Unexpected special file in app bundle.')
            result[str(path.relative_to(root))] = value
    if not result:
        raise ValueError('An empty app bundle cannot prove installation.')
    return result


if __name__ == '__main__':
    source, installed = (Path(x) for x in sys.argv[1:])
    expected, actual = manifest(source), manifest(installed)
    if expected != actual:
        raise SystemExit('ZIP and installed bundle differ in paths, types, bytes or symlink targets.')
    digest = hashlib.sha256(json.dumps(expected, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    print(json.dumps({'source': str(source), 'installed': str(installed), 'identical': True,
                      'entries': len(expected), 'manifestSHA256': digest, 'symlinksFollowed': False}))
