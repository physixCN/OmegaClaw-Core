"""Dot programs: plugins that supply a work graph for the adaptive host UI.

See hive/PROGRAMS.md for the contract. A program is a directory with a
plugin.json manifest and a Python module defining describe(), view() and
act(). Built-in programs live in hive/plugins/; more come from the directories
in HIVE_PLUGIN_DIRS, so private programs stay in their owners' repositories.
"""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import re
import traceback

BUILTIN_DIR = pathlib.Path(__file__).resolve().parents[1] / "plugins"
CONTRACT = "0.1"
STAGES = ("unfold", "map", "compare", "detail")
ROLES = {"question", "claim", "evidence", "hypothesis", "assessment", "explanation", "gap", "source", "other"}
POLARITIES = {"support", "oppose", "qualify", "neutral"}
ITEM_STATUSES = {"current", "corrected", "superseded", "retracted"}
SOURCE_STATUSES = {"retrieved", "inspected", "cited", "unavailable"}
RESULT_STATUSES = {"done", "started", "needs_input", "stale", "refused", "error"}
MAX_ITEMS, MAX_LINKS = 400, 1200
CAPABILITIES = {"commons:read", "goals:read", "goals:write", "exhibits:write"}


class ProgramContext:
    """What a program may touch, limited to its declared capabilities and one swarm."""

    def __init__(self, hive, swarm_id, program):
        self._hive, self._program = hive, program
        self.swarm_id = swarm_id
        self.swarm = hive.swarm(swarm_id)

    def _need(self, capability):
        if capability not in self._program["capabilities"]:
            raise self._hive.error(403, "capability_missing",
                                   f"{self._program['id']} did not declare {capability} in plugin.json")

    def beliefs(self):
        self._need("commons:read")
        return self._hive.beliefs(self.swarm_id)

    def belief(self, statement):
        self._need("commons:read")
        try:
            return self._hive.belief(self.swarm_id, statement)
        except Exception as exc:  # unknown belief or bad statement
            if getattr(exc, "status", None) in (400, 404):
                return None
            raise

    def agents(self):
        self._need("commons:read")
        return [{"id": a["id"], "name": a["name"], "kind": a["kind"], "hue": a["hue"]}
                for a in self._hive.agents() if a["swarm_id"] == self.swarm_id]

    def goals(self):
        self._need("goals:read")
        return self._hive.goals.list(self.swarm_id)

    def goal(self, goal_id):
        self._need("goals:read")
        goal = self._hive.goals.view(self._hive.goals.get(goal_id))
        if goal["swarm_id"] != self.swarm_id:
            raise self._hive.error(403, "forbidden", "goal is in another swarm")
        return goal

    async def create_goal(self, title, detail="", assignee=None, binding=None, priority=0.5):
        """Post a goal; with assignee only that dot may claim it, with binding its result must echo it."""
        self._need("goals:write")
        return await self._hive.goals.create(self.swarm_id, title, detail, priority,
                                             created_by=f"program:{self._program['id']}",
                                             assignee=assignee, binding=binding)

    async def cancel_goal(self, goal_id):
        self._need("goals:write")
        goal = self.goal(goal_id) if "goals:read" in self._program["capabilities"] else \
            self._hive.goals.view(self._hive.goals.get(goal_id))
        if goal["swarm_id"] != self.swarm_id or goal["created_by"] != f"program:{self._program['id']}":
            raise self._hive.error(403, "forbidden", "a program can only cancel goals it created")
        self._hive.goals.update(goal_id, {"status": "cancelled"})
        await self._hive.goals.notify_cancelled(goal_id)
        return self._hive.goals.view(self._hive.goals.get(goal_id))

    async def exhibit(self, title, to, minutes=30, body="", atoms=None):
        """Show a snapshot to named dots for a while; returns its content digest and share ids."""
        self._need("exhibits:write")
        return await self._hive.shares.program_exhibit(self._program["id"], self.swarm_id, title, to, minutes,
                                                       body, atoms)


class Programs:
    def __init__(self, hive):
        self.hive = hive
        self.programs: dict[str, dict] = {}
        self.disabled: set[str] = set()
        self.reload()

    # ---- loading ------------------------------------------------------------------------------

    def _dirs(self):
        dirs = [(BUILTIN_DIR, "built-in")]
        for part in filter(None, os.environ.get("HIVE_PLUGIN_DIRS", "").split(os.pathsep)):
            dirs.append((pathlib.Path(part).expanduser(), "plugin-dir"))
        return dirs

    def reload(self):
        found = {}
        for base, source in self._dirs():
            if not base.exists():
                continue
            candidates = [base] if (base / "plugin.json").exists() else sorted(p for p in base.iterdir() if p.is_dir())
            for folder in candidates:
                manifest_path = folder / "plugin.json"
                if not manifest_path.exists():
                    continue
                entry = self._load(folder, manifest_path, source)
                found[entry["id"]] = entry
        self.programs = found
        return self.list()

    def _load(self, folder, manifest_path, source):
        entry = {"id": folder.name, "name": folder.name, "version": "0", "description": "", "icon": "spark",
                 "capabilities": [], "source": source, "path": str(folder), "module": None, "error": None}
        try:
            manifest = json.loads(manifest_path.read_text())
            entry.update({k: manifest[k] for k in ("id", "name", "version", "description", "icon") if k in manifest})
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,40}", entry["id"]):
                raise ValueError(f"bad program id {entry['id']!r}")
            caps = list(manifest.get("capabilities", []))
            unknown = set(caps) - CAPABILITIES
            if unknown:
                raise ValueError(f"unknown capabilities: {', '.join(sorted(unknown))}")
            entry["capabilities"] = caps
            module_path = folder / manifest.get("module", "program.py")
            spec = importlib.util.spec_from_file_location(f"hive_program_{entry['id'].replace('-', '_')}", module_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            for name in ("describe", "view", "act"):
                if not callable(getattr(module, name, None)):
                    raise ValueError(f"{module_path.name} has no {name}()")
            entry["module"] = module
            entry["describe"] = self._check_description(module.describe())
        except Exception as exc:
            entry["error"] = f"{type(exc).__name__}: {exc}"
        return entry

    @staticmethod
    def _check_description(desc):
        kinds = desc.get("kinds") or []
        if not kinds:
            raise ValueError("describe() must list kinds")
        for kind in kinds:
            if kind.get("role") not in ROLES:
                raise ValueError(f"kind {kind.get('id')} has role {kind.get('role')!r}; use one of {sorted(ROLES)}")
        for rel in desc.get("relations") or []:
            if rel.get("polarity") not in POLARITIES:
                raise ValueError(f"relation {rel.get('id')} needs polarity support, oppose or neutral")
        return {"contract": str(desc.get("contract", CONTRACT)), "kinds": kinds,
                "relations": desc.get("relations") or [], "actions": desc.get("actions") or []}

    # ---- reading ------------------------------------------------------------------------------

    def view_of(self, entry):
        return {"id": entry["id"], "name": entry["name"], "version": entry["version"],
                "description": entry["description"], "icon": entry["icon"], "capabilities": entry["capabilities"],
                "source": entry["source"], "enabled": entry["id"] not in self.disabled and not entry["error"],
                "error": entry["error"]}

    def list(self):
        return [self.view_of(e) for e in sorted(self.programs.values(), key=lambda e: e["name"])]

    def get(self, program_id):
        entry = self.programs.get(program_id)
        if entry is None:
            raise self.hive.error(404, "not_found", f"no program {program_id}")
        return entry

    def detail(self, program_id):
        entry = self.get(program_id)
        return self.view_of(entry) | {"describe": entry.get("describe")}

    def set_enabled(self, program_id, enabled):
        self.get(program_id)
        (self.disabled.discard if enabled else self.disabled.add)(program_id)
        out = self.view_of(self.get(program_id))
        self.hive.events.publish("program.updated", program=out)
        return out

    def _ready(self, program_id):
        entry = self.get(program_id)
        if entry["error"]:
            raise self.hive.error(500, "program_error", f"{program_id} failed to load: {entry['error']}")
        if program_id in self.disabled:
            raise self.hive.error(409, "program_disabled", f"{program_id} is disabled")
        return entry

    # ---- running ------------------------------------------------------------------------------

    def _call(self, entry, fn, *args):
        try:
            return fn(*args)
        except Exception as exc:
            if getattr(exc, "status", None):
                raise
            tail = traceback.format_exc().strip().splitlines()[-4:]
            raise self.hive.error(500, "program_error", f"{entry['id']}: " + " | ".join(tail)) from exc

    async def view(self, program_id, swarm_id, focus=None, stage=None):
        entry = self._ready(program_id)
        stage = stage if stage in STAGES else "unfold"
        ctx = ProgramContext(self.hive, swarm_id, entry)
        graph = self._call(entry, entry["module"].view, ctx, focus or None, stage)
        graph = await graph if hasattr(graph, "__await__") else graph
        return self.validate(entry, graph, stage)

    async def act(self, program_id, swarm_id, action, items, params=None, base_revision=None):
        entry = self._ready(program_id)
        known = {a["id"] for a in entry["describe"]["actions"]}
        if action not in known:
            raise self.hive.error(400, "bad_request", f"{program_id} has no action {action!r}")
        ctx = ProgramContext(self.hive, swarm_id, entry)
        params = dict(params or {}, base_revision=base_revision)
        out = self._call(entry, entry["module"].act, ctx, action, list(items or []), params)
        out = await out if hasattr(out, "__await__") else out
        return validate_result(entry["id"], entry["describe"], out,
                               lambda m: self.hive.error(400, "bad_result", f"{entry['id']}: {m}"))

    def validate(self, entry, graph, stage):
        return validate_graph(entry["id"], entry["describe"], graph, stage,
                              lambda message: self.hive.error(400, "bad_graph", f"{entry['id']}: {message}"))


def _unit(value):
    try:
        return 0.0 <= float(value) <= 1.0
    except (TypeError, ValueError):
        return False


def check_uncertainty(u):
    """Uncertainty is optional and labelled with its method; it is never converted into another calculus."""
    if not isinstance(u, dict) or not str(u.get("method", "")).strip():
        return "uncertainty needs a method (e.g. nal, pln, qualitative)"
    method = u["method"]
    if method == "nal" and not (_unit(u.get("f")) and _unit(u.get("c"))):
        return "nal uncertainty needs f and c in [0, 1]"
    if method == "pln" and not (_unit(u.get("strength")) and _unit(u.get("confidence"))):
        return "pln uncertainty needs strength and confidence in [0, 1]"
    if method == "qualitative" and not str(u.get("status", "")).strip():
        return "qualitative uncertainty needs a status"
    return None


def validate_graph(program_id, describe, graph, stage, fail):
    """Check a work graph against contract 0.1; raises fail(message) on the first problem."""
    def bad(message):
        raise fail(message)

    if not isinstance(graph, dict):
        bad("view() must return a dict")
    if not str(graph.get("revision", "")).strip():
        bad("a work graph needs a revision (any string that changes when the content changes)")
    items, links, groups = graph.get("items") or [], graph.get("links") or [], graph.get("groups") or []
    if len(items) > MAX_ITEMS or len(links) > MAX_LINKS:
        bad(f"a view holds at most {MAX_ITEMS} items and {MAX_LINKS} links "
            f"(got {len(items)} and {len(links)}); narrow the view instead of cutting it")
    kinds = {k["id"] for k in describe["kinds"]}
    rels = {r["id"] for r in describe["relations"]}
    ids = set()
    for item in items:
        if not item.get("id") or item["id"] in ids:
            bad(f"item ids must be present and unique ({item.get('id')!r})")
        ids.add(item["id"])
        if item.get("kind") not in kinds:
            bad(f"item {item['id']} has unknown kind {item.get('kind')!r}")
        if item.get("uncertainty") is not None:
            problem = check_uncertainty(item["uncertainty"])
            if problem:
                bad(f"item {item['id']}: {problem}")
        status = item.setdefault("status", "current")
        if status not in ITEM_STATUSES:
            bad(f"item {item['id']} has status {status!r}; use one of {sorted(ITEM_STATUSES)}")
        for source in item.setdefault("sources", []):
            if not source.get("id") or not source.get("label"):
                bad(f"item {item['id']} has a source without id or label")
            if source.get("status", "cited") not in SOURCE_STATUSES:
                bad(f"source {source['id']} has status {source.get('status')!r}; use one of {sorted(SOURCE_STATUSES)}")
        item.setdefault("label", item["id"])
        item.setdefault("flags", [])
    link_ids = set()
    for link in links:
        if link.get("from") not in ids or link.get("to") not in ids:
            bad(f"link {link.get('from')} -> {link.get('to')} points outside the graph")
        if link.get("rel") not in rels:
            bad(f"link uses unknown relation {link.get('rel')!r}")
        link.setdefault("id", f"{link['from']}|{link['rel']}|{link['to']}")
        if link["id"] in link_ids:
            bad(f"link ids must be unique ({link['id']!r})")
        link_ids.add(link["id"])
    for group in groups:
        missing = [i for i in group.get("items", []) if i not in ids]
        if missing:
            bad(f"group {group.get('id')} names items not in the graph: {missing[:3]}")
    if graph.get("focus") and graph["focus"] not in ids:
        bad(f"focus {graph['focus']!r} is not an item")
    return {"contract": CONTRACT, "program": program_id, "revision": str(graph["revision"]), "stage": stage,
            "focus": graph.get("focus"), "title": graph.get("title") or program_id,
            "suggested_stage": graph.get("suggested_stage") if graph.get("suggested_stage") in STAGES else None,
            "items": items, "links": links, "groups": groups, "notes": list(graph.get("notes") or [])}


def validate_result(program_id, describe, result, fail):
    if not isinstance(result, dict) or result.get("status") not in RESULT_STATUSES:
        raise fail(f"act() must return a dict with status in {sorted(RESULT_STATUSES)}")
    out = dict(result)
    if out.get("graph") is not None:
        out["graph"] = validate_graph(program_id, describe, out["graph"],
                                      out["graph"].get("suggested_stage") or "unfold", fail)
    if out["status"] == "started" and not (out.get("task") or {}).get("id"):
        raise fail("a started action must return task.id (a goal id, so its status can be followed)")
    return out
