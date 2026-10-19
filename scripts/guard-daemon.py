#!/usr/bin/env python3
"""Keep the launchd-owned AAM daemon as the sole scheduler for one AAM home."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess


def run(argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=5, check=False)
    if result.returncode:
        raise RuntimeError("inspection unavailable: " + argv[0])
    return result.stdout


def daemon_command(command):
    try:
        args = shlex.split(command)
    except ValueError:
        return False
    if not args or Path(args[0]).name != "node":
        return False
    return any(arg.endswith("/src/cli.ts") and args[i + 1:i + 2] == ["daemon"]
               for i, arg in enumerate(args))


def guard(home, uid, inspect=run, stop=lambda pid: os.kill(pid, signal.SIGTERM)):
    service = ["/bin/launchctl", "print", f"gui/{uid}/com.aam.daemon"]
    database = str(Path(home).resolve() / "aam.db")

    def canonical():
        ids = set(re.findall(r"^\s*pid = (\d+)\s*$", inspect(service), re.MULTILINE))
        if len(ids) != 1:
            raise RuntimeError("launchd owner unavailable")
        return int(ids.pop())

    def owners():
        # File-name selection asks lsof to stat a protected Desktop path under
        # launchd, which can block on macOS privacy checks. Inspect only actual
        # scheduler processes, then match their already-open descriptor names.
        candidates = set()
        for line in inspect(["/bin/ps", "-axo", "pid=,command="]).splitlines():
            fields = line.strip().split(None, 1)
            if len(fields) == 2 and fields[0].isdigit() and daemon_command(fields[1]):
                candidates.add(int(fields[0]))
        if not candidates:
            return set()
        output = inspect(["/usr/sbin/lsof", "-nP", "-a", "-p",
                          ",".join(str(pid) for pid in sorted(candidates)), "-Fpn"])
        found, pid = set(), None
        for line in output.splitlines():
            if line.startswith("p"):
                pid = int(line[1:]) if line[1:].isdigit() else None
            elif line == "n" + database and pid in candidates:
                found.add(pid)
        return found

    def command(pid):
        return inspect(["/bin/ps", "-p", str(pid), "-o", "command="]).strip()

    owner = canonical()
    pids = owners()
    if owner not in pids or not daemon_command(command(owner)):
        raise RuntimeError("canonical daemon does not own this database")
    stopped = []
    for pid in sorted(pids - {owner}):
        try:
            original = command(pid)
            if not daemon_command(original):
                continue  # UI, workers, tests and other database clients are retained.
            # Inspect again before signalling: a stale or changed PID is never a target.
            if canonical() != owner or not {pid, owner}.issubset(owners()) or command(pid) != original:
                continue
            stop(pid)
            stopped.append(pid)
        except (RuntimeError, ProcessLookupError, subprocess.TimeoutExpired):
            continue
    return {"canonical_pid": owner, "stopped_duplicate_pids": stopped}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", required=True)
    args = parser.parse_args()
    try:
        result = guard(args.home, os.getuid())
        if result["stopped_duplicate_pids"]:
            print(json.dumps(result), flush=True)
    except (RuntimeError, subprocess.TimeoutExpired, OSError, ValueError) as error:
        print(json.dumps({"guard_error": str(error)}), flush=True)
        raise SystemExit(1)
