# Reference - Testing And Benchmarks

This page records the repeatable checks used for the out-of-box core readiness branch. Commands assume the repository root as the working directory.

## Unit Test Suite

Tracked core unit tests:

```bash
PYTHONPATH=src .venv/bin/python -m unittest \
  tests.test_agentverse_module \
  tests.test_energy \
  tests.test_input_context \
  tests.test_memory_runtime \
  tests.test_skill_affordance_contract \
  tests.test_syntax_history_fixture \
  tests.test_syntax_smoke_corpus \
  tests.test_write_surface
```

Expected result for the readiness branch: all tests pass.

The repository also contains interactive/black-box `Autotests/` for a running agent. Those are intentionally separate from the fast core unit suite because they require a live OmegaClaw process and channel setup.

## MeTTa Smoke Suite

Run isolated MeTTa smoke files through the guarded smoke runner:

```bash
.venv/bin/python tests/run_metta_smokes.py \
  tests/space_merge_atoms_smoke.metta \
  --timeout 45
```

The runner classifies each file before execution and skips live-memory-risk files unless `--allow-live-memory` is explicitly supplied.

## Benchmark Suite

Parser command membrane latency:

```bash
PYTHONPATH=src .venv/bin/python tests/bench_parser_latency.py
```

Context-view payload compaction:

```bash
PYTHONPATH=src .venv/bin/python tests/bench_context_compaction.py
```

Benchmark scripts should avoid live memory and external network dependencies. They are regression checks for relative shape and order of magnitude, not formal hardware-independent performance claims.

## Current Results

Latest local VM run on the private readiness branch:

| Check | Result |
|---|---|
| Core unit suite | 54 tests passed |
| `space_merge_atoms_smoke.metta` | passed; two matching atoms merged into one replacement and unrelated atom survived |
| Parser benchmark | 45,000 parses; signature parser 12.38 us/parse; legacy/current path 14.79 us/parse; declaration reload 408.58 us/load; 100 loaded signatures |
| Context compaction benchmark | raw 27,428 chars / ~6,857 tokens; view 161 chars / ~40 tokens; ratio 0.0059; 2,094.64 us/context view; raw history preserved yes; payload omitted from view yes; thought visible yes |

These numbers came from the local Linux VM run during this documentation sweep. When publishing benchmark numbers elsewhere, include the fresh command output, branch SHA, Python version, and machine/runtime context. Do not present a single local VM number as a universal performance claim.

## Optional Modules

Optional modules are tested only when included in the branch under review. A module folder should not affect the core command surface unless its `entry.metta` is imported from `modules/loader.metta`.
