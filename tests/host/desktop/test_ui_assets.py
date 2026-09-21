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


def test_no_template_renders_a_separator_with_nothing_after_it():
    """engine_version is "" on every machine where the engine never installed,
    so a hard-coded separator between two fields renders as "0.1.0 · "."""
    markup = (UI / "index.html").read_text()
    # Every engine_version field must sit inside a section gated on it.
    for chunk in markup.split('data-field="engine_version"')[1:]:
        pass
    assert 'data-when="engine_version"' in markup
    assert '</span> &middot; <span data-field="engine_version">' not in markup
    assert '</span> · <span data-field="engine_version">' not in markup


def test_nothing_installed_offers_no_uninstall():
    """There is no VM to remove; the button could only error or no-op."""
    markup = (UI / "index.html").read_text()
    start = markup.index('data-screen="home:not_installed"')
    end = markup.index("</template>", start)
    assert 'data-action="uninstall"' not in markup[start:end]


def test_nothing_installed_disables_the_tiles_that_need_a_vm():
    markup = (UI / "index.html").read_text()
    start = markup.index('data-screen="home:not_installed"')
    end = markup.index("</template>", start)
    screen = markup[start:end]
    for action in ("import", "ports"):
        tile = screen.index(f'data-action="{action}"')
        assert "disabled" in screen[tile:tile + 80], f"{action} tile must be disabled"


def test_no_user_facing_copy_names_one_platform():
    """The app ships on Windows and macOS and may not branch on platform, so a
    sentence naming either one is false on the other."""
    import re
    markup = (UI / "index.html").read_text()
    assert not re.search(r"\b(Mac|macOS|Windows|PC)\b", markup), \
        "platform-specific copy in a cross-platform UI"


def test_every_install_state_has_a_template():
    markup = (UI / "index.html").read_text()
    for screen in ("install:running", "install:reboot", "install:failed"):
        assert f'data-screen="{screen}"' in markup, f"no template for {screen}"


def test_the_install_panel_has_no_hard_coded_step_count():
    # "Step 4 of 7" is a macOS fact. Windows runs nine.
    markup = (UI / "index.html").read_text()
    assert "of 7" not in markup


def test_the_resume_notice_is_the_exact_sentence_from_install_py():
    """The old tkinter UI's RESUME_NOTICE is copied character for character
    into the HTML, gated so it only shows on a resumed launch."""
    install_py = (Path(__file__).resolve().parents[3] / "host" / "core"
                  / "install.py").read_text()
    match = re.search(r'RESUME_NOTICE = "(.+)"', install_py)
    assert match, "RESUME_NOTICE not found in host/core/install.py"
    notice = match.group(1)

    markup = (UI / "index.html").read_text()
    start = markup.index('data-screen="install:running"')
    end = markup.index("</template>", start)
    screen = markup[start:end]
    assert notice in screen
    notice_line = next(line for line in screen.splitlines() if notice in line)
    assert 'data-when="resumed"' in notice_line
