"""Shared swarm spaces: lib_hive.metta running in an embedded PeTTa.

All interpreter calls run on one worker thread.  Mutations are appended to an
operations log (``spaces.log.jsonl``) and replayed on start, so the commons
survive restarts; PeTTa itself has no persistence.

Swarm ``s`` owns ``&commons_s`` and ``&vocab_s``; grants live in ``&hive_acl``.
Agent input is validated by ``sexpr`` before it is spliced into MeTTa.
"""

from __future__ import annotations

import json
import os
import pathlib
import queue
import sys
import threading
from concurrent.futures import Future

from . import sexpr

LIB_HIVE = pathlib.Path(__file__).resolve().with_name("lib_hive.metta")
OUTCOMES = {"adopted", "revised", "chosen", "kept", "duplicate", "quarantined", "denied"}


class SpaceError(RuntimeError):
    pass


def _stamp_atoms(stamp):
    """["ev:a_1:3", ...] -> "((ev a_1 3) ...)" with validated parts."""
    parts = []
    for item in stamp:
        kind, agent, number = str(item).split(":")
        if kind != "ev" or not number.isdigit():
            raise sexpr.SexprError(f"bad evidence id {item!r}")
        parts.append(f"(ev {sexpr.safe_symbol(agent)} {int(number)})")
    return "(" + " ".join(sorted(parts)) + ")"


def _stamp_json(value):
    return [f"ev:{e[1]}:{e[2]}" for e in (value or []) if isinstance(e, list) and len(e) == 3]


def _tv(value):
    if isinstance(value, list) and len(value) == 3 and value[0] == "stv":
        return {"f": round(float(value[1]), 6), "c": round(float(value[2]), 6)}
    raise SpaceError(f"not a truth value: {value!r}")


class _Interpreter:
    """The process-wide PeTTa interpreter and the one thread allowed to use it.

    janus ties the interpreter to the thread that first calls it; a second
    thread calling in deadlocks, so every service shares this worker.
    """

    _instance = None
    _lock = threading.Lock()

    @classmethod
    def get(cls, petta_path):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(petta_path)
            return cls._instance

    def __init__(self, petta_path):
        self.petta_path = petta_path
        self._jobs: queue.Queue = queue.Queue()
        self._ready = threading.Event()
        self._error = None
        threading.Thread(target=self._worker, name="hive-petta", daemon=True).start()
        self._ready.wait(60)
        if self._error:
            raise SpaceError(f"PeTTa failed to start: {self._error}")

    def _worker(self):
        try:
            sys.path.insert(0, str(pathlib.Path(self.petta_path) / "python"))
            os.environ.setdefault("LANG", "C.UTF-8")
            from petta import PeTTa

            metta = PeTTa(verbose=False, petta_path=self.petta_path)
            metta.load_metta_file(str(LIB_HIVE))
        except Exception as exc:  # pragma: no cover - environment failure
            self._error = exc
            self._ready.set()
            return
        self._ready.set()
        while True:
            code, future = self._jobs.get()
            try:
                future.set_result(metta.process_metta_string(code))
            except Exception as exc:
                future.set_exception(exc)

    def run(self, code, timeout=30):
        future: Future = Future()
        self._jobs.put((code, future))
        return future.result(timeout)


class SpaceService:
    """One per process: spaces are global to the interpreter."""

    def __init__(self, data_dir, petta_path=None):
        self.data_dir = pathlib.Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.data_dir / "spaces.log.jsonl"
        self.petta_path = petta_path or os.environ.get("PETTA_PATH") or str(pathlib.Path.home() / "PeTTa")
        self._interp = _Interpreter.get(self.petta_path)
        self._replay()

    def run(self, code, timeout=30):
        return self._interp.run(code, timeout)

    def run_one(self, code):
        results = self.run(code)
        return sexpr.read_result(results[-1]) if results else None

    # ---- persistence -----------------------------------------------------------------

    def _log(self, op, **fields):
        with open(self.log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(dict(op=op, **fields)) + "\n")

    def _replay(self):
        if not self.log_path.exists():
            return
        for line in self.log_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            entry = json.loads(line)
            op = entry.pop("op")
            getattr(self, f"_apply_{op}")(**entry)

    # ---- grants and vocabulary --------------------------------------------------------

    def _apply_grant(self, agent_id, swarm_id):
        agent, swarm = sexpr.safe_symbol(agent_id), sexpr.safe_symbol(swarm_id)
        self.run(f"!(add-atom &hive_acl (Grant {agent} &commons_{swarm} $stmt publish))")

    def _apply_revoke(self, agent_id, swarm_id):
        agent, swarm = sexpr.safe_symbol(agent_id), sexpr.safe_symbol(swarm_id)
        self.run(f"!(remove-atom &hive_acl (Grant {agent} &commons_{swarm} $stmt publish))")

    def _apply_vocab(self, swarm_id, term, agent_id="hive"):
        swarm, sym, agent = sexpr.safe_symbol(swarm_id), sexpr.safe_symbol(term), sexpr.safe_symbol(agent_id)
        self.run(f"!(hive-vocab-add! &vocab_{swarm} {sym} {agent})")

    def grant(self, agent_id, swarm_id):
        if self.is_member(agent_id, swarm_id):
            return
        self._apply_grant(agent_id, swarm_id)
        self._log("grant", agent_id=agent_id, swarm_id=swarm_id)

    def revoke(self, agent_id, swarm_id):
        self._apply_revoke(agent_id, swarm_id)
        self._log("revoke", agent_id=agent_id, swarm_id=swarm_id)

    def is_member(self, agent_id, swarm_id):
        agent, swarm = sexpr.safe_symbol(agent_id), sexpr.safe_symbol(swarm_id)
        found = self.run(f"!(collapse (match &hive_acl (Grant {agent} &commons_{swarm} $s publish) True))")
        return bool(found) and found[-1] not in ("()", "")

    def add_vocab(self, swarm_id, terms, agent_id="hive"):
        known = set(self.vocab(swarm_id))
        for term in terms:
            term = sexpr.safe_symbol(term)
            if term in known:
                continue
            self._apply_vocab(swarm_id, term, agent_id)
            self._log("vocab", swarm_id=swarm_id, term=term, agent_id=agent_id)
            known.add(term)
        return self.vocab(swarm_id)

    def vocab(self, swarm_id):
        swarm = sexpr.safe_symbol(swarm_id)
        value = self.run_one(f"!(collapse (match &vocab_{swarm} (Term $t) $t))")
        return sorted(str(v) for v in (value or []))

    @staticmethod
    def statement_text(statement):
        return sexpr.safe_statement(statement)

    def statement_symbols(self, statement):
        structural = {"-->", "<->", "==>", "<=>", "&&", "||", "--", "stv"}
        out = []

        def walk(node):
            if isinstance(node, list):
                for item in node:
                    walk(item)
            elif isinstance(node, str) and not isinstance(node, sexpr.Str) and node not in structural:
                out.append(node)

        walk(sexpr.parse(statement))
        return sorted(set(out))

    # ---- publishing ---------------------------------------------------------------------

    def _apply_publish(self, swarm_id, agent_id, statement, f, c, stamp):
        swarm, agent = sexpr.safe_symbol(swarm_id), sexpr.safe_symbol(agent_id)
        stmt = sexpr.safe_statement(statement)
        tv = f"(stv {float(f)!r} {float(c)!r})"
        code = (
            f"!(hive-publish! &commons_{swarm} &vocab_{swarm} &hive_acl {agent} "
            f"{stmt} {tv} {_stamp_atoms(stamp)})"
        )
        return self.run_one(code)

    def publish(self, swarm_id, agent_id, statement, f, c, stamp, open_vocab=True):
        statement = sexpr.safe_statement(statement)
        f, c = float(f), float(c)
        if not (0.0 <= f <= 1.0 and 0.0 < c < 1.0):
            raise SpaceError("need 0 <= f <= 1 and 0 < c < 1")
        if open_vocab and self.is_member(agent_id, swarm_id):
            self.add_vocab(swarm_id, self.statement_symbols(statement), agent_id)
        result = self._apply_publish(swarm_id, agent_id, statement, f, c, stamp)
        outcome = result if isinstance(result, str) else (result[0] if result else "error")
        if outcome not in OUTCOMES:
            raise SpaceError(f"unexpected publish result: {result!r}")
        if outcome not in ("denied", "quarantined", "duplicate"):
            self._log("publish", swarm_id=swarm_id, agent_id=agent_id, statement=statement,
                      f=f, c=c, stamp=list(stamp))
        detail = {"outcome": outcome, "statement": statement}
        if outcome == "quarantined":
            detail["unmapped"] = [str(s) for s in result[1]]
        return detail

    # ---- reading ---------------------------------------------------------------------------

    def beliefs(self, swarm_id):
        swarm = sexpr.safe_symbol(swarm_id)
        value = self.run_one(f"!(collapse (match &commons_{swarm} (Current $s $t $st) ($s $t $st)))")
        out = []
        for stmt, tv, stamp in value or []:
            out.append({"statement": sexpr.render(stmt), "tv": _tv(tv), "stamp": _stamp_json(stamp)})
        return out

    def belief(self, swarm_id, statement):
        swarm = sexpr.safe_symbol(swarm_id)
        stmt = sexpr.safe_statement(statement)
        cur = self.run_one(f"!(collapse (match &commons_{swarm} (Current {stmt} $t $st) ($t $st)))")
        if not cur:
            return None
        tv, stamp = cur[0]
        sources = self.run_one(f"!(hive-sources &commons_{swarm} {stmt})") or []
        chosen = self.run_one(f"!(collapse (match &commons_{swarm} (Chosen {stmt} $k $r) ($k $r)))") or []
        return {
            "statement": stmt,
            "tv": _tv(tv),
            "stamp": _stamp_json(stamp),
            "sources": [str(s) for s in sources],
            "choices": [{"kept": _stamp_json(k), "rejected": _stamp_json(r)} for k, r in chosen],
        }

    def query(self, swarm_ids, pattern):
        pat = sexpr.safe_pattern(pattern)
        spaces = " ".join(f"&commons_{sexpr.safe_symbol(s)}" for s in swarm_ids)
        value = self.run_one(f"!(hive-view ({spaces}) {pat})") or []
        return [sexpr.render(v) for v in value]
