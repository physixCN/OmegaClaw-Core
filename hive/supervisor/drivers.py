"""Supervisor and drivers.  A driver only knows how to run one agent process.

Drivers implement ``start(agent, env) / stop(agent_id) / status(agent_id) ->
"running" | "exited" | "absent" / logs(agent_id, tail)``.  Built in: ``local``
(a process on this host) and ``docker`` (one container per agent).  Other
substrates (Kubernetes, VMs, Omega Cloud) are new drivers with the same shape.
"""

from __future__ import annotations

import os
import pathlib
import signal
import subprocess
import threading
import time

from .workspace import Workspace


class Driver:
    name = "base"

    def start(self, agent, env):  # pragma: no cover - interface
        raise NotImplementedError

    def stop(self, agent_id):  # pragma: no cover - interface
        raise NotImplementedError

    def status(self, agent_id):  # pragma: no cover - interface
        raise NotImplementedError

    def logs(self, agent_id, tail=200):  # pragma: no cover - interface
        raise NotImplementedError


def _tail(path, lines):
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - 256 * 1024))
            data = handle.read().decode("utf-8", errors="replace")
    except FileNotFoundError:
        return []
    return data.splitlines()[-lines:]


class LocalDriver(Driver):
    """Runs each agent as a process group on this host."""

    name = "local"

    def __init__(self, workspace: Workspace, petta_path):
        self.workspace = workspace
        self.petta_path = petta_path
        self.procs: dict[str, subprocess.Popen] = {}

    def start(self, agent, env):
        if self.status(agent["id"]) == "running":
            return
        if agent.get("kind") == "iter" and os.environ.get("HIVE_ALLOW_LOCAL_ITER") != "1":
            raise RuntimeError("Iter workers rewrite their own tools and must run sandboxed: use the docker "
                               "driver, or set HIVE_ALLOW_LOCAL_ITER=1 to accept running one on this host")
        root = self.workspace.path(agent["id"])
        log = open(root / "agent.log", "ab")
        full_env = dict(os.environ, **env)
        self.procs[agent["id"]] = subprocess.Popen(
            self.workspace.command(agent, self.petta_path),
            cwd=root, env=full_env, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        log.close()

    def stop(self, agent_id):
        proc = self.procs.pop(agent_id, None)
        if proc is None or proc.poll() is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=10)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()

    def status(self, agent_id):
        proc = self.procs.get(agent_id)
        if proc is None:
            return "absent"
        return "running" if proc.poll() is None else "exited"

    def logs(self, agent_id, tail=200):
        return _tail(self.workspace.path(agent_id) / "agent.log", tail)


class DockerDriver(Driver):
    """One container per agent from the omegadots agent image.

    The checkout and the chromadb library are mounted read-only; the agent's
    memory directory is the only writable mount.
    """

    name = "docker"

    def __init__(self, workspace: Workspace, image=None, network=None, command=None):
        self.workspace = workspace
        self.image = image or os.environ.get("HIVE_AGENT_IMAGE", "omegadots/agent:dev")
        self.network = network or os.environ.get("HIVE_DOCKER_NETWORK", "host")
        self.command = command or ["sh", "/opt/PeTTa/run.sh", "/agent/run.metta"]

    @staticmethod
    def container(agent_id):
        return f"hive-agent-{agent_id}"

    def _docker(self, *args, check=False):
        return subprocess.run(["docker", *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, check=check)

    def start(self, agent, env):
        name = self.container(agent["id"])
        if self.status(agent["id"]) == "running":
            return
        self._docker("rm", "-f", name)
        root = self.workspace.path(agent["id"])
        settings = self.workspace.settings
        if agent.get("kind") == "iter":
            args = ["run", "-d", "--name", name, "--network", self.network, "--label", "omegadots.agent=" + agent["id"],
                    "--memory", "1g", "--pids-limit", "256", "-v", f"{root}:/agent", "-w", "/agent"]
            for key, value in env.items():
                args += ["-e", f"{key}={value}"]
            args += [os.environ.get("HIVE_ITER_IMAGE", "omegadots/iter:dev"), "python3", "/agent/iter.py"]
            result = self._docker(*args)
            if result.returncode != 0:
                raise RuntimeError(f"docker run failed: {result.stdout.strip()}")
            return
        env = dict(env, OMEGACLAW_MEMORY_DIR="/agent/memory")
        args = ["run", "-d", "--name", name, "--network", self.network,
                "--label", "omegadots.agent=" + agent["id"],
                "-v", f"{root / 'memory'}:/agent/memory",
                "-v", f"{root / 'run.metta'}:/agent/run.metta:ro",
                "-v", f"{settings.core_root}:/agent/repos/OmegaClaw-Core:ro",
                "-v", f"{self.workspace.chromadb_lib()}:/agent/repos/petta_lib_chromadb:ro",
                "-w", "/agent"]
        for key, value in env.items():
            args += ["-e", f"{key}={value}"]
        args += [self.image, *self.command]
        result = self._docker(*args)
        if result.returncode != 0:
            raise RuntimeError(f"docker run failed: {result.stdout.strip()}")

    def stop(self, agent_id):
        self._docker("stop", "-t", "10", self.container(agent_id))
        self._docker("rm", "-f", self.container(agent_id))

    def status(self, agent_id):
        result = self._docker("inspect", "-f", "{{.State.Running}}", self.container(agent_id))
        if result.returncode != 0:
            return "absent"
        return "running" if result.stdout.strip() == "true" else "exited"

    def logs(self, agent_id, tail=200):
        result = self._docker("logs", "--tail", str(int(tail)), self.container(agent_id))
        return result.stdout.splitlines() if result.returncode == 0 else []


class Supervisor:
    """Owns drivers and keeps agents in their desired state."""

    def __init__(self, settings, drivers=None):
        self.settings = settings
        self.workspace = Workspace(settings)
        self.drivers = drivers or {
            "local": LocalDriver(self.workspace, settings.petta_path),
            "docker": DockerDriver(self.workspace),
        }
        self.hive = None
        self.hub_url = settings.public_url.replace("http", "ws", 1).rstrip("/") + "/agent-hub"
        self._restarts: dict[str, list[float]] = {}
        self._stop = threading.Event()

    def attach(self, hive):
        self.hive = hive

    def driver(self, agent):
        return self.drivers[agent.get("driver") or self.settings.default_driver]

    def _agent(self, agent_id):
        return self.hive.agent(agent_id)

    def prepare(self, agent, token):
        self.workspace.create(agent, token)

    def reconfigure(self, agent):
        self.workspace.write_prompt(agent)

    def env(self, agent):
        return self.workspace.env(agent, self.hub_url, self.settings.public_url)

    def start(self, agent_id):
        agent = self._agent(agent_id)
        self.driver(agent).start(agent, self.env(agent))

    def stop(self, agent_id):
        try:
            agent = self._agent(agent_id)
        except Exception:
            return
        self.driver(agent).stop(agent_id)

    def logs(self, agent_id, tail=200):
        return self.driver(self._agent(agent_id)).logs(agent_id, tail)

    def check(self):
        """One reconciliation pass: restart crashed agents that should be awake."""
        if self.hive is None:
            return
        for row in self.hive.db.all("SELECT * FROM agents WHERE deleted = 0 AND kind != 'module'"):
            agent = self.hive.agent_view(row)
            state = self.driver(agent).status(agent["id"])
            if row["desired"] != "awake" or state == "running":
                continue
            recent = [t for t in self._restarts.get(agent["id"], []) if time.time() - t < 300]
            if len(recent) >= 5:
                if row["status"] != "error":
                    tail = " | ".join(line.strip() for line in self.logs(agent["id"], 5) if line.strip())
                    self.hive.set_status(agent["id"], "error",
                                         error=f"crashed 5 times in 5 minutes; last log: {tail[-400:]}")
                continue
            recent.append(time.time())
            self._restarts[agent["id"]] = recent
            self.hive.set_status(agent["id"], "starting")
            try:
                self.start(agent["id"])
            except Exception as exc:
                self.hive.set_status(agent["id"], "error", error=f"start failed: {exc}")
