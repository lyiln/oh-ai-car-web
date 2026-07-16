import importlib.util
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class PatrolSharedStateTest(unittest.TestCase):
    def test_vision_reads_scheduler_task_and_current_waypoint(self) -> None:
        vision = load_module("plate_vision_shared_state", "plate_vision_agent.py")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.sqlite3"
            with sqlite3.connect(path) as connection:
                connection.execute("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                connection.executemany(
                    "INSERT INTO state(key,value) VALUES (?,?)",
                    [("active_task_id", "task-1"), ("active_waypoint_id", "waypoint-2")],
                )
            previous = os.environ.get("STATE_PATH")
            os.environ["STATE_PATH"] = str(path)
            try:
                self.assertEqual(vision._shared_patrol_context(), ("task-1", "waypoint-2"))
            finally:
                if previous is None:
                    os.environ.pop("STATE_PATH", None)
                else:
                    os.environ["STATE_PATH"] = previous

    def test_scheduler_activation_replaces_stale_task_and_waypoint_atomically(self) -> None:
        scheduler = load_module("patrol_scheduler_shared_state", "patrol_scheduler.py")
        with tempfile.TemporaryDirectory() as directory:
            state = scheduler.LocalState(str(Path(directory) / "state.sqlite3"))
            state.set("active_task_id", "old-task")
            state.set("active_waypoint_id", "old-waypoint")

            state.activate_task("new-task")

            self.assertEqual(state.get("active_task_id"), "new-task")
            self.assertIsNone(state.get("active_waypoint_id"))

    def test_scheduler_cleanup_removes_task_and_waypoint(self) -> None:
        scheduler = load_module("patrol_scheduler_cleanup", "patrol_scheduler.py")
        with tempfile.TemporaryDirectory() as directory:
            state = scheduler.LocalState(str(Path(directory) / "state.sqlite3"))
            state.set("active_task_id", "task-1")
            state.set("active_waypoint_id", "waypoint-1")

            state.clear_patrol()

            self.assertIsNone(state.get("active_task_id"))
            self.assertIsNone(state.get("active_waypoint_id"))


if __name__ == "__main__":
    unittest.main()
