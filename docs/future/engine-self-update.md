# Runtime self-update (deferred)

Not implemented. Recorded during the host-shell/engine split design
(`docs/superpowers/specs/2026-09-14-host-shell-engine-split-design.md`) so the shape is not
re-derived later. Revisit once the runtime has a remote home (GitHub releases or an own domain).

## Why it will be needed

- The host deliberately does not update the runtime: re-running setup on an installed VM does
  nothing. Today the only way to a newer runtime is a repair or a fresh VM.
- Accounts created after install get no skills or Codex `AGENTS.md` block until the runtime is
  installed again.
- A cloud VM has no host at all, so updating has to be something the guest can do itself.

## Proposed shape

**`omelet self-update [--repair]`** in the guest CLI (`runtime/cli/omelet.py`):

- Reads `OMELET_RUNTIME_URL` and `OMELET_RUNTIME_REPO` from `/opt/omelet/runtime.env`, which
  `get.sh` would start writing on every install so the update uses the same source the VM was
  installed from.
- Re-executes itself through `sudo` when not root (WSL sessions are root; Lima's user has
  passwordless sudo), then fetches and runs `get.sh` exactly as the host bootstrap does.
- Plain `self-update` resolves the newest `runtime-v*` tag; `--repair` sets
  `OMELET_RUNTIME_REPAIR=1`, which keeps the installed ref and recreates the API container.
- `omelet version` prints the installed runtime ref (`/opt/omelet/runtime.version`) and the API's
  own `/version`.

Once it exists, the host's connect-step repair can call `omelet self-update --repair` through
`exec(root=True)` instead of re-running the bootstrap command — same behaviour, one fewer place
that knows the entrypoint URL.

## Automatic updates, later

- A systemd timer calling `omelet self-update` on a schedule is the smallest step, but it replaces
  the API container mid-session; it should skip while any project job is running (the API's
  job registry already knows) or only run at boot.
- `npx skills update` is now a real candidate for Omelet's own skills too: `install.sh` installs
  them from the remote `ihorklymchukdev/omelet-skills` repo, not an unpacked local folder, so
  `npx skills update -g -y` per account could refresh them without a full `install.sh` re-run. It
  still would not touch anything else a runtime release changes (the stack, the guest CLI, Docker
  itself) — those still need `self-update` or a repair.
- An `api` bump in a runtime release must not reach a VM whose host does not speak it yet —
  auto-update needs to check the host's supported range, or the release has to keep serving the
  old `api` alongside the new one for a while.
