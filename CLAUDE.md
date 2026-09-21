# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A PoC CLI (`omelet`) that creates a managed Linux VM, installs Docker inside it, runs any
`docker-compose` project in the guest, and hands back a working URL on the host. Windows/WSL2 is
the primary platform. macOS/Lima is **confirmed once, still mostly unverified**: a VM from this
project's own config booted and finished the engine install on Apple Silicon, but nobody has
recorded a run of `create_vm` through `verify`. `host/providers/lima.py` and `omelet.yaml` carry
banners saying what is and is not confirmed; `docs/lima-verification-report.md` has the detail.

`docs/architecture.md` is the current high-level architecture, including the gotchas list;
`docs/roadmap.md` is the phased plan: Phase 1 (MVP) fixes what exists (repo split, no host CLI,
SSH-only access, autostart, self-update, signing) and adds accounts, a web app, secrets and
public URLs; Phases 2 and 3 are VPS deploys, paid plans and an own cloud. Check it before adding a host CLI command or a
host-side guest asset.
`docs/superpowers/` holds the original blueprint plus every design spec and plan;
`.superpowers/sdd/` holds the per-task execution ledger.

## Architecture shape: the host is a VM shell, the engine is everything inside

Two halves, shipped and versioned independently:

- **Host** (`host/`, a frozen desktop binary) — creates and runs the VM, runs one bootstrap
  command in it (fetch `OMELET_ENGINE_URL` → `bash`), reads the token, forwards ports, and talks
  to the agent over HTTP. It holds no guest files and no knowledge of what the engine installs.
- **Engine** (`engine/` + `agent/`) — everything inside the VM: Docker, the Traefik+agent stack,
  the in-VM `omelet` CLI, agent instructions and skills (via `npx skills add`). Released as
  `engine-v*` tags with a matching `omelet-agent` image. The same `get.sh` provisions a cloud VM.

The seam between them is a fixed contract — token path, agent port + `/health` `api` number, edge
port, `/opt/omelet/engine.version` — and nothing else. A change inside the VM must never need a
host release; if it does, the logic is on the wrong side.

### Releasing the engine (manual until CI exists)

Before the first shipped host can install anything:

- The repository is public.
- `engine/get.sh` exists on `main` — hosts fetch `ENGINE_URL` from `main`, not from a tag.
- At least one `engine-vX.Y.Z` tag exists.
- The ghcr image named by that tag's `engine/stack.yml` is published and public.
- `agent/__init__.py`, the Dockerfile's `AGENT_VERSION` and `engine/stack.yml` are bumped together
  before the first tag — the agent gained `/health`'s `api` field after 0.1.0.

`engine/get.sh` on `main` is a live contract for every shipped host: keep its env vars
(`OMELET_ENGINE_REPO`, `OMELET_ENGINE_REF`, `OMELET_ENGINE_REPAIR`), marker path and exit
semantics backward compatible.

1. Bump `agent/__init__.py`'s `__version__`, the Dockerfile's `AGENT_VERSION` and
   `engine/stack.yml`'s image tag together (`tests/test_constants_agree.py` holds them equal).
2. `docker build -t ghcr.io/ihorklymchukdev/omelet-agent:X.Y.Z agent/ && docker push ghcr.io/ihorklymchukdev/omelet-agent:X.Y.Z`
3. `git tag engine-vX.Y.Z && git push origin engine-vX.Y.Z`

Bump `agent/core/constants.API_VERSION` (and the host's `SUPPORTED_API`) only when a route the host
calls changes incompatibly — that one needs a host release.

## Commands

```bash
pip install -e ".[dev]"

python3 -m pytest -q                                    # full suite (~530 tests, ~7s)
python3 -m pytest tests/agent/test_project.py -q        # one file
python3 -m pytest -k classify -q                        # one test by name
```

In this WSL sandbox `/tmp/pytest-of-$USER` is root-owned, which breaks `tmp_path` fixtures, and
`tkinter` is absent, so `tests/host/test_setup_app_logic.py` and the two `selfcheck` tests in
`tests/test_setup_cli.py` fail. Prefix with `TMPDIR=<writable dir>` and ignore those; sandbox
artifacts, not code bugs.

There is no linter or formatter configured.

## Architecture

**The VM is abstracted, not Docker.** The guest is plain Ubuntu 24.04 running plain Docker on both
host platforms, so everything above the guest OS is platform-independent. The OS difference collapses
into the two provider classes.

```
host CLI (typer)  →  AgentClient (urllib)  →  127.0.0.1:39099 → agent (FastAPI in the VM)
                  →  VmProvider.exec()     →  guest: the engine bootstrap, the token read
                                              /opt/omelet/projects/<id>/
host localhost:39080 ─────────────────────────→  traefik :39080 → routes by Host header
```

### Hard invariant: `host/` never imports `agent/`

The host ships as a PyInstaller-frozen binary and reaches the agent over HTTP; the agent ships as a
Docker image built from `agent/` alone. `tests/host/test_no_agent_import.py` and
`tests/agent/test_no_host_import.py` enforce both directions by AST, anchored to `__file__`. The
host's only runtime dependency is `typer` — it parses no YAML, and
`tests/host/test_host_dependencies.py` fails on a declared or imported one. Names both packages
need are declared twice and held equal by `tests/test_constants_agree.py`.

### Hard invariant: no platform branching outside `host/providers/`

`tests/test_no_platform_leak.py` greps every `host/**/*.py` and `agent/**/*.py` outside
`providers/` for `sys.platform`, `platform.system()`, `os.name` and fails on any hit. Like the
two import-boundary tests it resolves the tree from `__file__` and asserts it scanned something
— a cwd-relative `Path("host")` passes vacuously from any other directory, which has now bitten
this repo three times. Reach for repo files that way in every test.
`host/providers/__init__.py` is the single place the host platform is resolved
(`get_provider()`, `default_install_dir()`).
Do not add an `if windows` anywhere else — push the difference into a provider method.

### Layers

- `host/core/provider.py` — the `VmProvider` Protocol plus `Completed` / `CheckResult` /
  `Diagnosis` value types. Providers are **duck-typed against the Protocol, not subclasses**.
- `host/providers/` — `Wsl2Provider` (shells `wsl.exe`), `LimaProvider` (shells `limactl`).
  Both take an injectable `runner` callable (defaults to `subprocess.run(..., capture_output=True)`),
  which is what makes them unit-testable.
- `host/client.py` — the only way the host reaches project logic: `AgentClient` over stdlib
  `urllib.request` (the host is PyInstaller-frozen, so it may never gain an HTTP dependency).
  It reads `/opt/omelet/agent.token` through `provider.exec()`, turns every non-2xx body into
  `AgentError(code, message, status)`, a refused connection into `AgentUnavailableError`, and a
  failed job into `JobFailedError` carrying the guest's own stderr.
- `agent/core/` — all platform-free logic: compose parsing, web detection, Traefik overlay
  generation, project identity, failure classification, guest lifecycle, sqlite state.
- `host/core/bootstrap.py` — the host's whole share of provisioning: unless
  `/opt/omelet/engine.version` exists (or `repair=True`), it runs a base64 stub as one `bash -lc`
  argument that downloads `OMELET_ENGINE_URL` in full and runs it, forwarding `OMELET_ENGINE_REF`
  when set and `OMELET_ENGINE_REPAIR=1` on repair. Values are checked against a shell-safe pattern
  because the argument is re-parsed by wsl.exe/ssh. `host/provision/` holds only the installer's
  `nginx-hello` smoke-test project (`tests/host/test_no_guest_assets.py`).
- `engine/get.sh` — the entrypoint: `resolve_ref` (explicit `OMELET_ENGINE_REF` → installed ref on
  repair → highest `engine-v*` tag by `sort -V`), downloads that ref's tarball, replaces
  `/opt/omelet/engine/` with its `engine/`, runs `install.sh <ref> [--repair]`.
- `engine/install.sh` — Docker, `edge`, `/opt/omelet` permissions, token, the stack (recreating the
  agent on a new token or repair), Node ≥ 22.20 from NodeSource, `/usr/local/bin/omelet`,
  `/etc/claude-code/CLAUDE.md`, then per account (root + `lib/login-users.sh`) the Codex block and
  `~/projects` link (`lib/install-agents.sh`) and
  `npx -y skills@1.5.26 add /opt/omelet/engine/skills -s '*' -g -a claude-code codex -y </dev/null`.
  Writes `engine.version` last.
- `engine/cli/omelet.py` — the `omelet` command **inside** the VM, used by coding agents:
  `up`/`new`/`clone`/`status`/`logs`/`down` over the agent API with the guest token. One
  stdlib-only file, loaded by tests by path (`tests/engine/cli/loader.py`); it shares constants
  with both sides, held equal by `tests/test_constants_agree.py`. `engine/instructions/` and
  `engine/skills/` hold what those agents read. The engine itself writes nothing into user
  repositories; the skills tell the coding agent to keep a project's own `docs/` and `AGENTS.md`.
- `engine/skills/` — five skills, one folder each, every folder installed by `install.sh`'s
  `npx skills add` (no per-skill wiring): `omelet-setup` orchestrates; `omelet-brainstorm`
  writes `docs/brief.md` or `docs/specs/<date>-<slug>.md` from a plain-words interview;
  `omelet-stack` chooses adopt → assemble → build with no default language and records
  `docs/stack.md` (compose recipes in its `references/`); `omelet-rules` writes the project's
  `AGENTS.md` (+ `CLAUDE.md` = `@AGENTS.md`) from `assets/AGENTS.md`; `omelet-plan` writes and
  works `docs/plans/<date>-<slug>.md`. `tests/engine/test_skills.py` holds frontmatter `name` equal
  to the folder, descriptions starting `Use when`, and every hand-off name and bundled file
  resolvable — skills reference each other by name only. Design:
  `docs/superpowers/specs/2026-09-15-agent-skills-library-design.md`.
- `agent/api/` — the FastAPI app the host talks to. `app.py::create_app(config, runner, state)` is
  a factory on purpose (no module-level `app`, so importing it opens no sqlite file); `jobs.py` is
  the in-process job registry that keeps slow compose work off the request; `__main__.py` is the
  uvicorn entrypoint on `0.0.0.0:39099`. Every non-2xx body is
  `{"error": {"code": ..., "message": ...}}`, produced by one exception handler.
- `agent/core/exec.py` — `LocalRunner`, the in-VM twin of `VmProvider.exec`: same `Completed`
  contract, never raises. `agent/core/config.py` — `AgentConfig`, the only place the domain and
  edge port may come from.
- `agent/core/files.py` — project file transfer over HTTP (`POST/GET /projects/{id}/files`,
  `PUT/GET/DELETE /projects/{id}/files/{path}`), replacing the 32,767-character `wsl.exe`
  command-line ceiling with a streamed request body. `extract_archive` merges an uploaded
  tar.gz into the project directory rather than replacing it, and rejects any entry (absolute
  path, `..` escape, symlink/hardlink escaping the tree) via `tarfile`'s `filter="data"` plus an
  explicit absolute-path check, since that filter silently normalizes an absolute name instead
  of refusing it.

### Things that will bite you

Moved to `docs/architecture.md`, section 9. Read that section before touching the providers,
the upload path, `install.sh`, the packaging specs or the agent's locking. Add a new entry there,
not here.

## Testing conventions

- No test spawns `wsl.exe`/`limactl`, touches a real VM, or reaches the network. Provider tests
  inject a `FakeRunner` that records `argv` and returns scripted bytes; CLI tests monkeypatch
  `cli._provider_factory` with a `FakeProvider`. Assertions are about **constructed argv and decoded
  output**, not side effects. Engine shell scripts are the exception that still runs a real process:
  they are exercised with `bash` against fakes on `PATH` (see the engine-scripts bullet below).
- `tests/agent/test_acceptance_detection.py` runs the five real-world compose shapes in
  `tests/fixtures/compose/` through `detect_web` — add a fixture there when changing detection rules.
- Engine scripts are tested under `tests/engine/`: `bash -n` plus text assertions over
  `install.sh`, `resolve_ref` sourced from `get.sh` with a fake `git` on `PATH`, and
  `install-agents.sh`/`login-users.sh` run against temporary homes. Nothing there touches the
  network; the live-VM acceptance run covers apt, NodeSource, npm and ghcr.

## Conventions

- Python 3.12+, `from __future__ import annotations`, frozen dataclasses for value types.
- Host runtime deps are `typer` alone; the agent's are declared in `agent/pyproject.toml`. Keep
  it that way unless there's a reason.
- Packaging lives in `packaging/<platform>/`: Inno Setup on Windows (`build.ps1`), `pkgbuild`/
  `productbuild` on macOS (`build.sh` → `dist/OmeletSetup-<version>.pkg`). Both freeze with
  PyInstaller one-dir and smoke-test the frozen binary (`version`, then `selfcheck`) *before*
  packaging it. The mac build needs a Python 3.12+ with tkinter and is native-arch only. Manual
  release gates: `docs/installer-test-matrix.md`, `docs/macos-install-test-matrix.md`.
- Live WSL2 run needs an Ubuntu 24.04 rootfs tarball path in `OMELET_ROOTFS` (README has the
  current download URL); the provider factory reads it, and `omelet vm create` without it raises
  `ValueError`. The value must be a Windows path — it goes straight to `wsl.exe --import`.
