#!/usr/bin/env python3
"""Opt-in temporary launchd/MCP transport experiment, not a cleanup verifier."""
import importlib.util
import ctypes
import os
from pathlib import Path
import signal
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("coalition_probe", Path(__file__).with_name("codex-launchd-coalition-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def main():
    label = "org.turnlink.gate2-mcp-probe-" + uuid.uuid4().hex
    delegate_label = "org.turnlink.gate2-mcp-delegate-" + uuid.uuid4().hex
    expect_denial = os.environ.get("TURNLINK_EXPECT_DELEGATION_DENIED") == "1"
    pids = []
    delegated = None
    with tempfile.TemporaryDirectory(prefix="gate2-mcp-", dir="/private/tmp") as directory:
        root = Path(directory)
        binary, address, record, delegate_record = root / "fixture", root / "stdio.sock", root / "ids", root / "delegate"
        subprocess.run(["cc", "-Wall", "-Wextra", "-Werror", str(Path(__file__).with_name("codex-launchd-mcp-fixture.c")), "-o", str(binary)], check=True, timeout=20)
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(address))
        os.chmod(address, 0o600)
        listener.listen(1)
        listener.settimeout(8)
        connection = None
        try:
            command = [str(binary), str(address), str(record), delegate_label, str(delegate_record)]
            if expect_denial:
                command = ["/usr/bin/sandbox-exec", "-p", '(version 1)(allow default)(deny mach-lookup (global-name "com.apple.xpc.launchd"))', *command]
            launched = probe.launchctl("submit", "-l", label, "--", *command)
            if launched.returncode:
                raise RuntimeError("launchd fixture launch failed: " + launched.stderr.strip())
            connection, _ = listener.accept()
            connection.settimeout(8)
            peer = struct.unpack("i", connection.getsockopt(0, 2, 4))[0]  # SOL_LOCAL / LOCAL_PEERPID
            uid, gid = ctypes.c_uint(), ctypes.c_uint()
            libc = ctypes.CDLL(None, use_errno=True)
            libc.getpeereid.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
            libc.getpeereid.restype = ctypes.c_int
            if libc.getpeereid(connection.fileno(), ctypes.byref(uid), ctypes.byref(gid)) != 0 or uid.value != os.geteuid():
                raise RuntimeError("fixture socket peer has the wrong effective user")
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                try:
                    pids = [int(value) for value in record.read_text().split()]
                    if len(pids) == 2:
                        break
                except (FileNotFoundError, ValueError):
                    pass
                time.sleep(0.05)
            if len(pids) != 2 or pids[0] != peer or not all(probe.owned(pid, binary) for pid in pids):
                raise RuntimeError("could not bind the socket peer and fixture process identities")
            owner, orphan = pids
            coalition = probe.group(owner)
            if not coalition or coalition == probe.group(os.getpid()) or coalition != probe.group(orphan):
                raise RuntimeError("fixture processes do not have a separate shared coalition")
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline and os.getsid(orphan) != orphan:
                time.sleep(0.02)
            if os.getsid(orphan) != orphan:
                raise RuntimeError("fixture child did not detach into its own session")
            node = shutil.which("node")
            if not node:
                raise RuntimeError("node is required for the real MCP SDK client")
            subprocess.run([node, str(Path(__file__).with_name("codex-launchd-mcp-client.mjs")), str(connection.fileno())],
                           pass_fds=(connection.fileno(),), check=True, timeout=15)
            if not expect_denial:
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    try:
                        delegated = int(delegate_record.read_text().strip())
                        break
                    except (FileNotFoundError, ValueError):
                        time.sleep(0.05)
                if not delegated or not probe.owned(delegated, binary) or probe.group(delegated) == coalition:
                    raise RuntimeError("delegated fixture job did not start in a separate coalition")
            else:
                time.sleep(0.2)
                if delegate_record.exists() or probe.launchctl("list", delegate_label).returncode == 0:
                    raise RuntimeError("denied delegation nevertheless created a fixture job")
            before = probe.usage(coalition)
            if not before.get("available") or before["active"] < 2:
                raise RuntimeError("owned coalition did not contain both fixture processes")
            if probe.launchctl("remove", label).returncode:
                raise RuntimeError("failed to remove exact fixture job")
            time.sleep(0.5)
            after = probe.usage(coalition)
            if not probe.owned(orphan, binary) or not after.get("available") or after["active"] < 1:
                raise RuntimeError("detached fixture child was not observed after job removal")
            print("MCP initialize, tools/list and tools/call passed over launchd-owned stdio")
            print("socket peer matched fixture owner and distinct coalition")
            print("active tasks before/after job removal:", before["active"], after["active"])
            os.kill(orphan, signal.SIGKILL)
            time.sleep(0.3)
            print("targeted usage after child exit:", probe.usage(coalition))
            if not expect_denial:
                if not probe.owned(delegated, binary):
                    raise RuntimeError("delegated job did not remain alive after the original job and child stopped")
                print("delegated MCP work survived in a separate coalition")
        finally:
            if connection is not None:
                connection.close()
            listener.close()
            probe.launchctl("remove", label)
            probe.launchctl("remove", delegate_label)
            # The worker releases its child only after recording both PIDs;
            # recover that record even if the normal handshake failed early.
            try:
                recorded = [int(value) for value in record.read_text().split()]
                if len(recorded) == 2:
                    pids = recorded
            except (FileNotFoundError, ValueError):
                pass
            try:
                delegated = int(delegate_record.read_text().strip())
                pids.append(delegated)
            except (FileNotFoundError, ValueError):
                pass
            for pid in pids:
                if probe.owned(pid, binary):
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            time.sleep(0.2)
            remaining = sum(probe.owned(pid, binary) for pid in pids)
            print("fixture processes still visible:", remaining)
            if remaining:
                raise RuntimeError("fixture cleanup incomplete")


if __name__ == "__main__":
    main()
