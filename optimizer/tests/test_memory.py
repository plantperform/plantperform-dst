import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from optimizer.memory import memory_observation, memory_pressure


class MemoryTests(unittest.TestCase):
    def test_cgroup_v2_reports_kills_and_bytes_and_accepts_unbounded_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "memory.events").write_text("oom 4\noom_kill 2\nmax 10\n")
            (root / "memory.current").write_text("4096")
            (root / "memory.peak").write_text("8192")
            (root / "memory.max").write_text("max")
            self.assertEqual(
                memory_observation(root),
                {
                    "oom_kills": 2,
                    "current_bytes": 4096,
                    "peak_bytes": 8192,
                    "limit_bytes": None,
                },
            )

    def test_cgroup_v1_reads_oom_kill_counter(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "memory").mkdir()
            (root / "memory/memory.oom_control").write_text("under_oom 0\noom_kill 3\n")
            (root / "memory/memory.usage_in_bytes").write_text("100")
            (root / "memory/memory.max_usage_in_bytes").write_text("200")
            (root / "memory/memory.limit_in_bytes").write_text("300")
            self.assertEqual(
                memory_observation(root),
                {
                    "oom_kills": 3,
                    "current_bytes": 100,
                    "peak_bytes": 200,
                    "limit_bytes": 300,
                },
            )

    def test_unavailable_or_older_cgroup_counters_do_not_claim_oom(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertIsNone(memory_observation(root)["oom_kills"])
            (root / "memory.events").write_text("oom 4\nmax 10\n")
            self.assertIsNone(memory_observation(root)["oom_kills"])

    def test_usage_from_own_cgroup_in_a_shared_hierarchy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            membership = root / "membership"
            membership.write_text("0::/task/worker")
            group = root / "task/worker"
            group.mkdir(parents=True)
            (group / "memory.current").write_text("512")
            (root / "memory.current").write_text("4096")

            observed = memory_observation(root, membership)

            self.assertEqual(observed["current_bytes"], 512)

    def test_child_virtual_size_cutoff_includes_the_256_mib_margin(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch("optimizer.memory._integer", return_value=0),
        ):
            proc = Path(directory)
            (proc / "123").mkdir()
            size = 9 * 1024**3 - 256 * 1024**2
            (proc / "123/status").write_text(f"VmSize: {size // 1024} kB")

            pressure = memory_pressure(123, 9 * 1024**3, root=proc)

            self.assertEqual(pressure["child_virtual_bytes"], size)

    @unittest.skipUnless(sys.platform == "linux", "Linux address-space limits")
    def test_hard_limit_rejects_a_single_large_allocation_in_a_child(self):
        program = """from optimizer.memory import limit_address_space
limit_address_space(256 * 1024**2)
try:
    bytearray(512 * 1024**2)
except MemoryError:
    raise SystemExit(0)
raise SystemExit(1)
"""
        child = subprocess.run([sys.executable, "-c", program], timeout=10)

        self.assertEqual(child.returncode, 0)
