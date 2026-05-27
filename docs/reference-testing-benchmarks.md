# Testing and Benchmarking

OmegaClaw v0.01a keeps test evidence separated by risk and purpose. The goal is
not to make every optional organ mandatory, but to make each claim testable in
the smallest honest harness.

## Required Local Gates

Run these from the OmegaClaw-Core checkout:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"
PYTHONPATH=src python3 docs/review/review_audit.py
```

These are the default release gates. They cover parser behavior, module
contracts, skill/catalog consistency, runtime-memory helpers, context views,
provider boundaries, optional module manifests, and local bridge logic without
requiring live credentials.

## MeTTa Smoke Gates

MeTTa smoke files live under `tests/*.metta` and are classified before they run:

```bash
PYTHONPATH=src python3 tests/run_metta_smokes.py --list
```

To execute the safe subset, provide a PeTTa runtime root containing `run.sh`:

```bash
OMEGACLAW_ROOT=/path/to/petta-runtime \
PYTHONPATH=src python3 tests/run_metta_smokes.py --summary-only
```

Smoke classes:

| Class | Default | Meaning |
|---|---|---|
| `isolated` | runs | Uses fresh temporary spaces or pure local forms. |
| `runtime-skill-risk` | skipped | Calls imported OmegaClaw skill definitions; behavior is covered by unit tests or full-runtime live checks. |
| `imports-full-runtime` / mutation / external-action | skipped | May touch runtime memory, provider state, external channels, or files. Run only with explicit operator intent. |

Risky/manual smokes are available for live-runtime review:

```bash
OMEGACLAW_ROOT=/path/to/petta-runtime \
PYTHONPATH=src python3 tests/run_metta_smokes.py --allow-live-memory
```

Runtime-skill smokes can be forced with:

```bash
OMEGACLAW_ROOT=/path/to/petta-runtime \
PYTHONPATH=src python3 tests/run_metta_smokes.py --allow-runtime-skill
```

Use this only when the runtime harness is known to evaluate imported skill
forms, not merely import them as symbolic atoms.

## Benchmarks

The reviewer-facing benchmark compares the candidate branch against the ASI
Alliance OmegaClaw-Core baseline by default:

```bash
git fetch origin
PYTHONPATH=src python3 docs/review/benchmark_suite.py \
  --baseline-ref origin/main \
  --candidate . \
  --loops 1000 \
  --run-patch-audit \
  --output docs/review/v0.01a-benchmark-results.md
```

The benchmark spends no LLM tokens by default. It measures parser latency,
representative request parsing, fixed synthetic context size, declared skill and
module surface, repo review footprint, optional Assume/Fabric availability, and
review-audit status. Live cost data is only read from `memory/cost_ledger.jsonl`
when present.

For a quick parser-only latency check:

```bash
PYTHONPATH=src python3 tests/bench_parser_latency.py
```

## Optional Module Tests

Some tests are intentionally skip-safe:

- FabricPC/JAX/Optax tests skip when `FABRICPC_PYTHON` is unavailable.
- Game Boy tests skip when `pyboy` is unavailable.
- WhatsApp health smoke tests skip when the local bridge is not running.

A skip in an optional module test is not a core failure. It means the optional
dependency or live service was not configured for that run.

## Release Report Expectations

A v0.01a readiness report should name:

- ASI baseline ref and candidate commit.
- Unit-test result count and skip count.
- Smoke classification totals and whether isolated smokes executed.
- Benchmark output path.
- Optional dependency skips.
- Any live-only tests performed outside the private repo.
