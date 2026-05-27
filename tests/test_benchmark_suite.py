import importlib.util
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
BENCHMARK = ROOT / "docs" / "review" / "benchmark_suite.py"


def load_benchmark():
    spec = importlib.util.spec_from_file_location("benchmark_suite", BENCHMARK)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class BenchmarkSuiteTests(unittest.TestCase):
    def test_context_fixture_budget_is_deterministic_and_comparable(self):
        bench = load_benchmark()
        result = bench.context_fixture_benchmark(bench.Target("candidate", ROOT))

        self.assertEqual([row["name"] for row in result["rows"]], ["idle", "fresh-message", "tool-heavy-feedback"])
        self.assertGreater(result["avg_token_estimate"], 1000)
        self.assertEqual(result["rows"][0]["components"]["history_chars"], result["max_history"])
        self.assertIn("skills_chars", result["rows"][0]["components"])

    def test_default_baseline_is_asi_alliance_origin_main(self):
        bench = load_benchmark()
        self.assertEqual(bench.DEFAULT_BASELINE_REF, "origin/main")

    def test_assume_benchmark_treats_fabricpc_exit_77_as_skip(self):
        bench = load_benchmark()

        class FakeResult:
            returncode = 77
            stdout = "SKIP FabricPC python not found"

        original = bench.run
        try:
            bench.run = lambda *args, **kwargs: FakeResult()
            result = bench.assume_benchmark(bench.Target("candidate", ROOT))
        finally:
            bench.run = original

        self.assertEqual(result["status"], "skipped")

    def test_output_argument_writes_rendered_report(self):
        bench = load_benchmark()
        text = bench.markdown({
            "baseline_ref": "origin/main",
            "baseline": {
                "path": "/baseline",
                "parser": {"us_per_parse": 1.0, "parses_per_second": 1000, "errors": []},
                "workloads": {"rows": [{"name": name, "ok": True} for name, *_ in bench.WORKLOAD_CASES]},
                "surface": {"skill_signatures": 1, "skill_definitions": 1, "modules": 0, "skill_help_atoms": 0, "catalog_files": 0, "signature_files": 0},
                "context_fixture": bench.context_fixture_benchmark(bench.Target("baseline", ROOT)),
                "footprint": {"files": 1, "bytes": 1},
                "assume": {"status": "skipped"},
            },
            "candidate": {
                "path": "/candidate",
                "parser": {"us_per_parse": 1.0, "parses_per_second": 1000, "errors": []},
                "workloads": {"rows": [{"name": name, "ok": True} for name, *_ in bench.WORKLOAD_CASES]},
                "surface": {"skill_signatures": 1, "skill_definitions": 1, "modules": 0, "skill_help_atoms": 0, "catalog_files": 0, "signature_files": 0},
                "context_fixture": bench.context_fixture_benchmark(bench.Target("candidate", ROOT)),
                "footprint": {"files": 1, "bytes": 1},
                "runtime": {"status": "missing"},
                "assume": {"status": "skipped"},
            },
        })
        self.assertIn("Baseline ref: `origin/main`", text)
        self.assertIn("Assume/Fabric demo", text)


if __name__ == "__main__":
    unittest.main()
