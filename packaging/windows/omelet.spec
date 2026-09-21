# PyInstaller one-dir. One-file unpacks to a temp dir on every launch and is
# the mode antivirus heuristics dislike most; the installer wraps this anyway.

# host.desktop is reached only through cli.setup()'s function-local import,
# so PyInstaller's static analysis never sees it -- a bundle missing one of
# these launches, shows a window, and dies on the first draw. webview and its
# platform backend are the same problem one layer down: pywebview picks its
# backend at runtime (`import webview.platforms.edgechromium` inside the
# library, not a top-level import of ours), so PyInstaller's analysis never
# sees that either. edgechromium is pywebview's Windows backend (WebView2 via
# pythonnet) -- unverified against an installed pywebview, since none is
# installed in this environment; confirm against the real package before a
# frozen build.
HIDDEN = ["host.desktop.__main__", "host.desktop.api", "host.desktop.view",
          "host.desktop.jobs", "webview", "webview.platforms.edgechromium"]

a = Analysis(
    ["../../host/cli.py"],
    pathex=["../.."],
    datas=[
        ("../../host/provision/nginx-hello/docker-compose.yml",
         "host/provision/nginx-hello"),
        ("../../host/providers/omelet.yaml", "host/providers"),
        ("../../host/desktop/ui", "host/desktop/ui"),
    ],
    # Nothing from agent/ or engine/ is bundled: the VM pulls the image and
    # fetches the engine itself, and tests/host/test_frozen_bundle.py fails if
    # an entry reappears. Every dest mirrors the repo path its reader resolves
    # from __file__, so the bundle and a source checkout look identical.
    hiddenimports=HIDDEN,
)
pyz = PYZ(a.pure)

# Two executables, one Analysis, one entry point. A GUI-subsystem exe has no
# console, so anything typer echoes from it is discarded and PowerShell does
# not wait on it ($LASTEXITCODE would be stale). The CLI therefore must be
# console; the setup window must not be, or it flashes a console behind itself.
cli_exe = EXE(pyz, a.scripts, exclude_binaries=True, name="omelet", console=True)
setup_exe = EXE(pyz, a.scripts, exclude_binaries=True, name="setup", console=False)

coll = COLLECT(cli_exe, setup_exe, a.binaries, a.datas, name="Omelet")
