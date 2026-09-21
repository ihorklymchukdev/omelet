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
