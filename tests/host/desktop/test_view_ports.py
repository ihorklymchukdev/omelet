"""What the ports table may accept.

The reserved pair is the one that matters: the providers forward 39099 and
39080 for themselves, and a user who takes 39099 silently severs the host from
the agent -- every screen afterwards reads as "can't reach the kitchen" with
no clue why.
"""
from __future__ import annotations

import pytest

from host.core import constants
from host.desktop.view import validate_port


def test_an_ordinary_pair_is_allowed():
    assert validate_port(3000, 3000, []) == ""


@pytest.mark.parametrize("guest, host_port", [(0, 3000), (3000, 0),
                                              (70000, 3000), (3000, 70000)])
def test_ports_outside_the_range_are_refused(guest, host_port):
    assert validate_port(guest, host_port, []) == "range"


def test_a_host_port_already_in_the_table_is_refused():
    assert validate_port(4000, 3000, [(3000, 3000)]) == "duplicate"


def test_the_same_host_port_is_refused_even_for_a_different_guest_port():
    # netsh keys its table by the listening port; a second rule would silently
    # replace the first rather than coexist.
    assert validate_port(9999, 3000, [(3000, 3000)]) == "duplicate"


def test_the_agent_port_may_not_be_taken():
    assert validate_port(1234, constants.API_PORT, []) == "reserved"


def test_the_edge_port_may_not_be_taken():
    assert validate_port(1234, constants.EDGE_PORT, []) == "reserved"
