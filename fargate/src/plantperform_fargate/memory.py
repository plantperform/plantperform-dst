"""Read task-local cgroup counters without treating a generic SIGKILL as OOM."""

from pathlib import Path


def _integer(path):
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


def memory_observation(root=Path("/sys/fs/cgroup")):
    v2 = root / "memory.events"
    v1 = root / "memory" / "memory.oom_control"
    for events, current, peak, limit in (
        (v2, root / "memory.current", root / "memory.peak", root / "memory.max"),
        (
            v1,
            v1.parent / "memory.usage_in_bytes",
            v1.parent / "memory.max_usage_in_bytes",
            v1.parent / "memory.limit_in_bytes",
        ),
    ):
        try:
            counters = dict(line.split() for line in events.read_text().splitlines())
            kills = int(counters["oom_kill"]) if "oom_kill" in counters else None
        except (OSError, ValueError):
            continue
        return {
            "oom_kills": kills,
            "current_bytes": _integer(current),
            "peak_bytes": _integer(peak),
            "limit_bytes": _integer(limit),
        }
    return {"oom_kills": None, "current_bytes": None, "peak_bytes": None, "limit_bytes": None}
