"""Pure mappings from host/core values to what a screen needs.

Everything here is a function of its arguments. No provider, no client, no
clock, no I/O -- which is what makes this the only module in host/desktop
worth testing, and why api.py stays thin enough to read in one sitting.

No user-facing copy lives here. These functions return state identifiers;
ui/index.html holds the words, so the design board stays the single source
for them.
"""
from __future__ import annotations

from host.core import constants
from host.core.status import Readiness


def route_for(readiness: Readiness) -> tuple[str, str]:
    """`(route, state)` for a probe result.

    Ordered to match `status.probe()`'s own early returns, with one
    deliberate exception: `problem` is checked before `vm_exists`. A provider
    that threw in `exists()` reports vm_exists=False, which is shape-identical
    to "no VM yet" -- and routing that to "not installed" would offer a Set up
    button on a machine where setup cannot run.
    """
    if readiness.problem:
        # The agent refusing /health is the only failure the unreachable
        # screen describes truthfully: its copy claims we can see the machine
        # humming, which is only established once `true` ran in it and the
        # engine marker was read.
        if readiness.vm_reachable and readiness.engine_version:
            return ("unreachable", "")
        return ("home", "wrong")
    if not readiness.vm_exists:
        return ("home", "not_installed")
    if not readiness.vm_reachable:
        return ("home", "stopped")
    if not readiness.engine_version:
        return ("home", "wrong")
    if readiness.agent_api not in constants.SUPPORTED_API:
        return ("home", "wrong")
    return ("home", "running")


from host.core.install import Step

# Carried over from host/setup_app/wizard.py. install_runtime is absent on
# purpose: its text comes from provider.runtime().label, because the version
# in it is Lima's fact, not the installer's -- a second copy here would go
# stale the first time the pinned version changes.
STEP_LABELS = {
    "preflight": "Checking this computer",
    "remediate": "Turning on Windows features",
    "reboot_gate": "Restart needed",
    "fetch_image": "Downloading Linux image",
    "create_vm": "Preparing the virtual machine",
    "bootstrap": "Installing Omelet",
    "connect": "Connecting to the Omelet service",
    "verify": "Testing the setup",
    "finish": "Finishing up",
}


def step_label(step: Step) -> str:
    return step.label or STEP_LABELS.get(step.name, step.name)


def rows_for(steps: list[Step]) -> list[dict]:
    """One row per step the factory actually returned.

    Never a fixed seven: default_steps drops install_runtime on Windows (wsl
    ships with the OS) and drops remediate, reboot_gate and fetch_image on
    macOS (no features to enable, and limactl fetches its own image). The
    "Step N of M" counter is derived from this list for the same reason.
    """
    return [{"name": s.name, "label": step_label(s), "progress": s.progress}
            for s in steps]


from host.core.install import DeadEnd, InstallError, Progress, RebootRequired


def progress_event(progress: Progress) -> dict:
    return {
        "type": "step",
        "step": progress.step,
        "status": progress.status,
        "message": progress.message,
        # None, never 0.0: only a step that declared progress=True has a
        # fraction, and a zero here would draw an empty bar on every other row.
        "fraction": progress.fraction,
    }


def terminal_event(exc: BaseException | None) -> dict:
    """How the run ended, in the three shapes the board draws differently.

    run_install has already reported a `failed` Progress naming the row, so
    nothing here needs the step name -- only the ending, because each offers
    a different pair of buttons.
    """
    if exc is None:
        return {"type": "done"}
    if isinstance(exc, RebootRequired):
        return {"type": "reboot"}
    if isinstance(exc, DeadEnd):
        # No code can fix this one, so the failed screen's "Try this step
        # again" is the wrong offer and the UI hides it for this type.
        return {"type": "dead_end", "message": f"{exc}"}
    if isinstance(exc, InstallError):
        return {"type": "failed", "message": exc.message, "action": exc.action}
    return {"type": "failed", "message": f"{exc}", "action": ""}
