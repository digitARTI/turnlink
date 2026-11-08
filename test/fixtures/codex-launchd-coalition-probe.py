#!/usr/bin/env python3
"""Opt-in macOS probe. Creates one temporary launchd job and cleans up its processes.

Uses private macOS interfaces; results are not MCP cleanup authority.
"""
import ctypes
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import uuid


class Coalition(ctypes.Structure):
    _fields_ = [("id", ctypes.c_uint64), ("kind", ctypes.c_uint32), ("tasks", ctypes.c_uint32)]


lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
lib.proc_pidpath.restype = ctypes.c_int
lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
lib.proc_pidinfo.restype = ctypes.c_int
lib.proc_listcoalitions.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
lib.proc_listcoalitions.restype = ctypes.c_int
usage_lib = ctypes.CDLL(None, use_errno=True)
usage_lib.coalition_info_resource_usage.argtypes = [ctypes.c_uint64, ctypes.c_void_p, ctypes.c_size_t]
usage_lib.coalition_info_resource_usage.restype = ctypes.c_int


def owned(pid, expected):
    buf = ctypes.create_string_buffer(4096)
    return lib.proc_pidpath(pid, buf, len(buf)) > 0 and buf.value == os.fsencode(expected)


def group(pid):
    buf = (ctypes.c_uint64 * 5)()
    if lib.proc_pidinfo(pid, 20, 0, buf, ctypes.sizeof(buf)) != ctypes.sizeof(buf):
        raise RuntimeError("coalition identity unavailable")
    return buf[0]


def count(group_id):
    # XNU counts coalitions, allocates a kernel buffer, then enumerates again.
    # Growth between those passes can omit an entry without filling our caller
    # buffer. A missing group is therefore unknown, never proof of release.
    rows = (Coalition * 16384)()
    length = lib.proc_listcoalitions(2, 0, rows, ctypes.sizeof(rows))
    if length <= 0 or length >= ctypes.sizeof(rows) or length % ctypes.sizeof(Coalition):
        raise RuntimeError("coalition list unavailable or possibly truncated")
    matches = [row.tasks for row in rows[: length // ctypes.sizeof(Coalition)] if row.kind == 0 and row.id == group_id]
    if len(matches) > 1:
        raise RuntimeError("duplicate coalition identity")
    return matches[0] if matches else None


def usage(group_id):
    # Private, target-specific interface; the first two uint64 values are the
    # started and exited task counters. A failure is not evidence of absence.
    values = (ctypes.c_uint64 * 128)()
    ctypes.set_errno(0)
    if usage_lib.coalition_info_resource_usage(group_id, values, ctypes.sizeof(values)) != 0:
        return {"available": False, "errno": ctypes.get_errno()}
    if values[1] > values[0]:
        raise RuntimeError("inconsistent coalition usage counters")
    return {"available": True, "started": values[0], "exited": values[1], "active": values[0] - values[1]}


def launchctl(*args):
    return subprocess.run(["/bin/launchctl", *args], capture_output=True, text=True, timeout=8)


def main():
    source = Path(__file__).with_name("codex-launchd-worker.c")
    label = "org.turnlink.gate2-probe-" + uuid.uuid4().hex
    pids = []
    with tempfile.TemporaryDirectory(prefix="gate2-coalition-", dir="/private/tmp") as temp:
        worker = Path(temp) / "worker"
        record = Path(temp) / "ids"
        subprocess.run(["cc", "-Wall", "-Wextra", "-Werror", str(source), "-o", str(worker)], check=True, timeout=20)
        try:
            result = launchctl("submit", "-l", label, "--", str(worker), str(record))
            if result.returncode:
                raise RuntimeError("fixture launchd submission failed: " + result.stderr.strip())
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                try:
                    values = [int(value) for value in record.read_text().split()]
                    if len(values) == 2:
                        pids = values
                        break
                except (FileNotFoundError, ValueError):
                    pass
                time.sleep(0.05)
            if len(pids) != 2 or not all(owned(pid, worker) for pid in pids):
                raise RuntimeError("fixture process identity unavailable")
            parent, child = pids
            controller_group, job_group, child_group = group(os.getpid()), group(parent), group(child)
            if not all((controller_group, job_group, child_group)):
                raise RuntimeError("zero coalition identity")
            print("separate controller coalition:", controller_group != job_group)
            print("child shares job coalition:", job_group == child_group)
            before = usage(job_group)
            print("coalition tasks before job removal:", count(job_group))
            print("targeted usage before job removal:", before)
            if controller_group == job_group or job_group != child_group or not before.get("available") or before["active"] < 2:
                raise RuntimeError("fixture did not establish a separate coalition with both processes")
            if launchctl("remove", label).returncode:
                raise RuntimeError("fixture job removal failed")
            time.sleep(0.5)
            child_alive = owned(child, worker)
            after = usage(job_group)
            print("detached child alive after removal:", child_alive)
            print("coalition tasks after job removal:", count(job_group))
            print("targeted usage after job removal:", after)
            if not child_alive or not after.get("available") or after["active"] < 1:
                raise RuntimeError("targeted query failed to observe the live detached child")
            if child_alive:
                os.kill(child, signal.SIGKILL)
            time.sleep(0.5)
            print("coalition list after child termination (missing is unknown):", count(job_group))
            print("targeted usage after child termination:", usage(job_group))
            print("targeted usage for never-issued fixture ID:", usage(0))
        finally:
            launchctl("remove", label)
            for pid in pids:
                if owned(pid, worker):
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            time.sleep(0.2)
            print("fixture processes still visible:", sum(owned(pid, worker) for pid in pids))


if __name__ == "__main__":
    main()
