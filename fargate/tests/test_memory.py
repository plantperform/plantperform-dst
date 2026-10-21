import tempfile
import unittest
from pathlib import Path

from plantperform_fargate.memory import memory_observation


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
