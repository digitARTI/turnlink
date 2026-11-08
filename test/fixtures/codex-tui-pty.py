import os
import pty
import signal
import sys

pid, fd = pty.fork()
if pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)

def stop(*_):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

signal.signal(signal.SIGTERM, stop)
try:
    while True:
        data = os.read(fd, 4096)
        if not data:
            break
        if os.environ.get('TURNLINK_TUI_FIXTURE_OUTPUT'):
            with open(os.environ['TURNLINK_TUI_FIXTURE_OUTPUT'], 'ab') as out:
                out.write(data)
except OSError:
    pass
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
