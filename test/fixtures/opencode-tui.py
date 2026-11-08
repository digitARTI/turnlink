"""Private POSIX pseudo-terminal for the opt-in native CLI fixture, not production."""
import fcntl
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))
child = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
stopping = False

def stop(_signal=None, _frame=None):
    global stopping
    stopping = True

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
tail = b''
try:
    while not stopping and child.poll() is None:
        ready, _, _ = select.select([master], [], [], 0.1)
        if not ready:
            continue
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        tail = (tail + data)[-65536:]
        # Respond only to terminal capability/position/background queries. Never
        # submit user input, approvals, commands or prompts through the terminal.
        if b'\x1b[6n' in data:
            os.write(master, b'\x1b[1;1R')
        if b'\x1b[c' in data or b'\x1b[0c' in data:
            os.write(master, b'\x1b[?1;2c')
        if b'\x1b]11;?' in data:
            os.write(master, b'\x1b]11;rgb:1a1a/1a1a/1a1a\x1b\\')
finally:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    os.close(master)
    # Terminal output may contain a private fixture server password. Never emit
    # it to the test runner or a shared log; the fixture directory is private.
    fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(tail)
sys.exit(0 if stopping else child.returncode or 0)
