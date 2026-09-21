"""Invariants of the bundled UI, not its rendering.

There is no JS test runner in this repo and one is not being added to assert
that a template renders. What is worth pinning is the boundary: a desktop app
whose fonts come from a CDN is broken on a train, and one that can reach any
remote origin has a bridge worth attacking.
"""
from __future__ import annotations

import re
from pathlib import Path

UI = Path(__file__).resolve().parents[3] / "host" / "desktop" / "ui"

# Matches a remote origin in markup, CSS or JS. Deliberately not anchored to
# src=/href=: a fetch() or an @import is the same problem.
REMOTE = re.compile(r"https?://(?!localhost|127\.0\.0\.1)", re.IGNORECASE)


def _assets() -> list[Path]:
    files = [p for p in UI.rglob("*") if p.suffix in {".html", ".css", ".js"}]
    # A relative Path() would pass vacuously from another directory; this has
    # bitten the repo three times, so assert we scanned something.
    assert files, f"no UI assets found under {UI}"
    return files


def test_no_asset_reaches_a_remote_origin():
    offenders = []
    for path in _assets():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if REMOTE.search(line):
                offenders.append(f"{path.relative_to(UI)}:{number}: {line.strip()}")
    assert not offenders, "UI assets must work offline:\n" + "\n".join(offenders)


def test_the_three_typefaces_are_bundled():
    names = {p.name for p in (UI / "fonts").glob("*.woff2")}
    for family in ("bricolage-grotesque", "hanken-grotesk", "ibm-plex-mono"):
        assert any(n.startswith(family) for n in names), f"missing {family}"


def test_the_font_licenses_ship_with_them():
    # All three are SIL OFL 1.1, which requires the license to travel with
    # the binary.
    assert (UI / "fonts" / "OFL.txt").is_file()


def test_the_page_forbids_remote_origins_at_runtime():
    head = (UI / "index.html").read_text()
    assert "Content-Security-Policy" in head
    assert "default-src 'self'" in head


def test_every_home_state_has_a_template():
    markup = (UI / "index.html").read_text()
    for screen in ("home:not_installed", "home:stopped", "home:running",
                   "home:wrong", "unreachable", "first-run",
                   "updates-unavailable"):
        assert f'data-screen="{screen}"' in markup, f"no template for {screen}"


def test_the_update_tile_promises_nothing_it_cannot_do():
    # There is no update backend. The tile ships because the board has it,
    # but it must not claim to have checked anything.
    markup = (UI / "index.html").read_text()
    assert "nothing to check for yet" in markup.lower()
