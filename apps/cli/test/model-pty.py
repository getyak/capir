"""Real POSIX terminal acceptance driver; owns and closes only its child and PTYs."""
import errno, json, os, pty, select, subprocess, sys, time
spec=json.load(sys.stdin)
in_master,in_slave=pty.openpty()
out_master,out_slave=pty.openpty()
child=subprocess.Popen([spec['node'],spec['binary'],'chat',*spec.get('args',[])],stdin=in_slave,stdout=out_slave,stderr=subprocess.PIPE,env=os.environ.copy(),start_new_session=True)
os.close(in_slave);os.close(out_slave)
stdout=bytearray();stderr=bytearray();active={out_master:stdout,child.stderr.fileno():stderr}
def pump(timeout=0.05):
    for fd in select.select(list(active),[],[],timeout)[0]:
        try: data=os.read(fd,65536)
        except OSError as e:
            if e.errno!=errno.EIO: raise
            data=b''
        if data: active[fd].extend(data)
        else: active.pop(fd,None)
def wait_for(text):
    deadline=time.monotonic()+10
    while text not in (stdout+stderr).decode('utf8','replace'):
        if time.monotonic()>deadline or child.poll() is not None:
            raise RuntimeError('PTY did not reach expected interaction')
        pump()
try:
    for action in spec['actions']:
        if 'wait' in action: wait_for(action['wait'])
        if 'write' in action: os.write(in_master,action['write'].encode())
        if 'signal' in action: child.send_signal(action['signal'])
    deadline=time.monotonic()+12
    while child.poll() is None or active:
        if time.monotonic()>deadline: raise RuntimeError(f'PTY session exceeded deadline (child={child.poll()}, output_bytes={len(stdout)}, diagnostic_bytes={len(stderr)}, last_action={spec["actions"][-1]!r})')
        pump()
    print(json.dumps({'code':child.returncode,'stdout':stdout.decode('utf8','replace').replace('\r\n','\n'),'stderr':stderr.decode('utf8','replace')}))
finally:
    if child.poll() is None: child.kill(); child.wait()
    child.stderr.close();os.close(in_master);os.close(out_master)
