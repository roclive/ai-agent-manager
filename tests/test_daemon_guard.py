"""Offline tests for process selection; never send an actual process signal."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("guard", Path(__file__).resolve().parents[1] / "scripts/guard-daemon.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
DAEMON = "/opt/homebrew/bin/node --import loader.mjs /manager/src/cli.ts daemon --interval 60"


class GuardTests(unittest.TestCase):
    def inspect(self, owners="100 200 300 400", commands=None, owner="100"):
        commands = commands or {100: DAEMON, 200: DAEMON, 300: DAEMON.replace(" daemon", " serve"), 400: "codex exec -C /manager"}
        def run(argv):
            if argv[0].endswith("launchctl"):
                return "service = {\n pid = " + owner + "\n}"
            if argv[0].endswith("lsof"):
                selected = set(argv[argv.index("-p") + 1].split(","))
                return "\n".join("p" + pid + "\nn/manager/.aam/aam.db" for pid in owners.split() if pid in selected)
            if "-axo" in argv:
                return "\n".join(str(pid) + " " + command for pid, command in commands.items())
            return commands[int(argv[2])]
        return run

    def test_stops_only_duplicate_node_scheduler_sharing_database(self):
        stopped = []
        result = module.guard("/manager/.aam", 501, self.inspect(), stopped.append)
        self.assertEqual(stopped, [200])
        self.assertEqual(result["canonical_pid"], 100)

    def test_owner_inspection_never_waits_for_network_name_resolution(self):
        base = self.inspect(owners="100 300 400")
        def inspect(argv):
            if argv[0].endswith("lsof") and "-nP" not in argv:
                raise module.subprocess.TimeoutExpired(argv, 5)
            return base(argv)
        self.assertEqual(module.guard("/manager/.aam", 501, inspect)["stopped_duplicate_pids"], [])

    def test_lsof_never_stats_database_path_or_scans_unrelated_processes(self):
        base = self.inspect()
        def inspect(argv):
            if argv[0].endswith("lsof"):
                self.assertNotIn("/manager/.aam/aam.db", argv)
                self.assertEqual(argv[argv.index("-p") + 1], "100,200")
                self.assertIn("-Fpn", argv)
            return base(argv)
        stopped = []
        module.guard("/manager/.aam", 501, inspect, stopped.append)
        self.assertEqual(stopped, [200])

    def test_descriptor_names_must_match_database_exactly(self):
        base = self.inspect()
        def inspect(argv):
            if argv[0].endswith("lsof"):
                return "p100\nn/manager/.aam/aam.db\np200\nn/manager/.aam/aam.db-wal"
            return base(argv)
        stopped = []
        module.guard("/manager/.aam", 501, inspect, stopped.append)
        self.assertEqual(stopped, [])

    def test_keeps_unrelated_daemon_without_this_database(self):
        stopped = []
        module.guard("/manager/.aam", 501, self.inspect(owners="100 300 400"), stopped.append)
        self.assertEqual(stopped, [])

    def test_no_launchd_owner_or_no_matching_database_means_no_signals(self):
        for inspect in [self.inspect(owner="999"), lambda argv: "no service"]:
            stopped = []
            with self.assertRaises((RuntimeError, ValueError)):
                module.guard("/manager/.aam", 501, inspect, stopped.append)
            self.assertEqual(stopped, [])

    def test_changed_pid_command_is_not_signalled(self):
        base = self.inspect()
        calls = 0
        def inspect(argv):
            nonlocal calls
            if argv[0].endswith("ps") and argv[2] == "200":
                calls += 1
                return DAEMON if calls == 1 else "node /unrelated.js"
            return base(argv)
        stopped = []
        module.guard("/manager/.aam", 501, inspect, stopped.append)
        self.assertEqual(stopped, [])

    def test_never_selects_worker_prompt_or_shell_wrappers(self):
        for command in ["codex exec /manager/src/cli.ts daemon", "sh /manager/src/cli.ts daemon", "node /manager/src/cli.ts serve", "node /manager/not-cli.ts daemon"]:
            self.assertFalse(module.daemon_command(command))
        self.assertTrue(module.daemon_command("node --import ./bin/../node_modules/tsx/dist/loader.mjs ./bin/../src/cli.ts daemon --interval 60"))


if __name__ == "__main__":
    unittest.main()
