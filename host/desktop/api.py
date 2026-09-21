"""The only object JavaScript can reach.

Everything here is a security boundary, so the surface is a fixed list of
method names taking scalars. No path, command or URL arriving from JS is
passed to a shell, and nothing is eval'd. Slow work goes through
JobRegistry rather than blocking the thread that owns the window.

Thin on purpose: the decisions live in view.py, which is testable without a
window.
"""
from __future__ import annotations

import webbrowser

from host.core import constants
from host.core.status import probe

from .jobs import JobRegistry
from .view import inspect_folder, progress_event, route_for, rows_for, terminal_event


class DesktopApi:
    IMPORT_MODES = ("merge", "replace")

    def __init__(self, provider, state, *, push,
                 probe_fn=probe, browser_open=webbrowser.open, steps_factory=None,
                 client_factory=None):
        self._provider = provider
        self._state = state
        self._probe = probe_fn
        self._open = browser_open
        self._steps_factory = steps_factory
        self._client_factory = client_factory or self._default_client_factory
        self.jobs = JobRegistry(push)

    @staticmethod
    def _default_client_factory(provider):
        from host.client import AgentClient

        return AgentClient.for_provider(provider)

    # --- what to draw -------------------------------------------------

    def home(self) -> dict:
        readiness = self._probe(self._provider)
        route, state = route_for(readiness)
        return {
            "route": route,
            "state": state,
            # Carried over from host/setup_app/app.py's _should_auto_start:
            # true only where nothing has ever been recorded. Once any step
            # has completed the answer flips, because "not vm_exists" stays
            # true across every failed create_vm relaunch too.
            "first_run": not readiness.vm_exists and not self._state.completed(),
            "app_version": constants.APP_VERSION,
            "engine_version": readiness.engine_version or "",
            "problem": readiness.problem,
            # Set by __main__.run() when RunOnce reopened the window after a
            # restart, so the install screen can explain why it appeared.
            "resumed": getattr(self, "resumed", False),
        }

    # --- actions ------------------------------------------------------

    def open_omelet(self) -> dict:
        # The edge port, never the agent port: this is whatever Traefik is
        # routing, and becomes the web app for free when that ships.
        self._open(f"http://localhost:{constants.EDGE_PORT}")
        return {"ok": True}

    def start_install(self) -> dict:
        from host.core.install import run_install

        # A fresh list per run: the steps close over provider state
        # (provider.rootfs is assigned while the list is built), so re-running
        # a list built for an earlier run installs against stale bindings.
        steps = self._steps_factory()

        def work(emit):
            def report(progress):
                emit(progress_event(progress))

            try:
                run_install(steps, self._state, report)
            except Exception as e:
                return terminal_event(e)
            return terminal_event(None)

        job_id = self.jobs.start("install", work)
        return {"job": job_id, "rows": rows_for(steps)}

    def reboot_now(self) -> dict:
        import sys
        # Order matters and is pinned by a test: a machine that goes down
        # before RunOnce is written never comes back to setup.
        self._provider.register_resume(sys.executable)
        self._provider.reboot()
        return {"ok": True}

    def reset_install(self) -> dict:
        """Forget every recorded step so the next run starts from preflight."""
        self._state.clear()
        return {"ok": True}

    def choose_folder(self) -> dict:
        """Native folder picker. pywebview supplies it on both platforms."""
        import webview
        window = webview.windows[0]
        chosen = window.create_file_dialog(webview.FOLDER_DIALOG)
        if not chosen:
            return {"cancelled": True}
        return self.inspect_folder(chosen[0])

    def inspect_folder(self, path: str) -> dict:
        from host.client import project_id_for

        summary = inspect_folder(path)
        project_id = project_id_for(summary["name"])
        try:
            self._client_factory(self._provider).get_project(project_id)
            conflict = True
        except Exception:
            # Any refusal means "no project by that name to merge into". A
            # conflict banner shown because the agent was briefly unreachable
            # would offer Replace -- which deletes -- over nothing.
            conflict = False
        return {**summary, "path": path, "project_id": project_id,
                "conflict": conflict}

    def start_import(self, path: str, mode: str) -> dict:
        from host.client import project_id_for

        if mode not in self.IMPORT_MODES:
            # Never guessed: one of the two modes deletes a project.
            raise ValueError(f"unknown import mode {mode!r}")

        summary = inspect_folder(path)
        project_id = project_id_for(summary["name"])
        client = self._client_factory(self._provider)

        def work(emit):
            if mode == "replace":
                # Delete first. The other order merges the folder in and then
                # wipes it, losing the import along with the old project.
                client.delete_project(project_id)
            client.ensure_project(project_id)

            def on_progress(phase, done, total):
                emit({"type": "progress", "phase": phase,
                      "done": done, "total": total})

            client.upload_directory(project_id, path, on_progress=on_progress)
            return {"type": "done", "project_id": project_id}

        return {"job": self.jobs.start("import", work),
                "project_id": project_id, **summary}
