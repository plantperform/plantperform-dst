"""Read task-local cgroup counters without treating a generic SIGKILL as OOM."""

import errno
from functools import cache
from pathlib import Path


def _integer(path):
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


@cache
def _memory_directory(root, membership):
    # Fargate can mount the container's cgroup directly or expose the hierarchy.
    try:
        groups = membership.read_text().splitlines()
    except OSError:
        groups = []
    for line in groups:
        _, controllers, group = line.split(":", 2)
        if controllers and "memory" not in controllers.split(","):
            continue
        base = root / "memory" if controllers else root
        relative = Path(group.lstrip("/"))
        directory = base / relative
        usage_file = "memory.usage_in_bytes" if controllers else "memory.current"
        if ".." not in relative.parts and (directory / usage_file).is_file():
            return directory
    return root / "memory" if (root / "memory").is_dir() else root


def _cgroup_files(root, membership):
    directory = _memory_directory(root, membership)
    if (directory / "memory.current").exists() or (directory / "memory.events").exists():
        return (
            directory / "memory.events",
            directory / "memory.current",
            directory / "memory.peak",
            directory / "memory.max",
        )
    return (
        directory / "memory.oom_control",
        directory / "memory.usage_in_bytes",
        directory / "memory.max_usage_in_bytes",
        directory / "memory.limit_in_bytes",
    )


def memory_observation(root=Path("/sys/fs/cgroup"), membership=Path("/proc/self/cgroup")):
    events, current, peak, limit = _cgroup_files(root, membership)
    try:
        counters = dict(line.split() for line in events.read_text().splitlines())
        kills = int(counters["oom_kill"]) if "oom_kill" in counters else None
    except (OSError, ValueError):
        kills = None
    return {
        "oom_kills": kills,
        "current_bytes": _integer(current),
        "peak_bytes": _integer(peak),
        "limit_bytes": _integer(limit),
    }


def limit_address_space(limit):
    # Only the spawned Linux worker lowers its limit. Local runs can use Windows.
    import resource

    _, hard = resource.getrlimit(resource.RLIMIT_AS)
    if hard != resource.RLIM_INFINITY:
        limit = min(limit, hard)
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def memory_pressure(pid, limit, root=Path("/proc")):
    _, current_file, _, _ = _cgroup_files(Path("/sys/fs/cgroup"), Path("/proc/self/cgroup"))
    current = _integer(current_file)
    if current is not None and current >= limit:
        return {"task_bytes": current, "limit_bytes": limit}
    try:
        for line in (root / str(pid) / "status").read_text().splitlines():
            if line.startswith("VmSize:"):
                size = int(line.split()[1]) * 1024
                if size >= limit - 256 * 1024**2:
                    return {"child_virtual_bytes": size, "limit_bytes": limit}
                break
    except (OSError, ValueError):
        pass
    return None


def allocation_failed(error):
    return (
        isinstance(error, MemoryError) or isinstance(error, OSError) and error.errno == errno.ENOMEM
    )
