# Public URL for a project (VM side)

Date: 2026-09-24
Status: proposed
Issue: #23

## 1. Problem

A signed-in user wants to share a running project with someone outside their
computer. The Omelet service (`OMELET_CLOUD_URL`) runs the control plane on top of
Cloudflare Tunnel: it owns the tunnel, its routing config in Cloudflare, the public
hostnames and the limits. This spec is the part inside the VM: asking the service
for a public URL, running the tunnel client, and showing the result.

Everything here lives in `runtime/`. No host change and no host release.

## 2. Decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | The VM is written against the service contract in section 3, not the one live on 2026-09-24. | The service dev is changing the contract. As with sign-in, no client-side workarounds for service gaps. |
| 2 | The service rewrites the Host header to the project's local hostname; project routing and overlays do not change. | Verified: project routers are `Host(<local hostname>)` with no entrypoint restriction (`core/overlay.py`), and Traefik v3's `Host()` ignores the port. |
| 3 | Apps that build absolute URLs from the Host header send public visitors to `*.127-0-0-1.sslip.io`. Accepted as a known limit (section 10). | Most dev apps use relative links. The fix (public-host routes via a Traefik dynamic file) is a follow-up. |
| 4 | Only the console turns a public URL on or off. The in-VM `omelet` CLI and coding agents never see public URLs. | Putting a project on the internet is a human decision. Agents only need local URLs. |
| 5 | The tunnel client is a `stack.yml` service behind a compose profile, started and stopped by the API. | Absent when unused, visible in the stack, and the API already runs compose. |
| 6 | The tunnel client sits on its own network, shared only with Traefik. | Cloudflare, not us, decides where the client sends traffic. A bad remote config must not reach the api container (it holds the Docker socket) or project containers directly. |
| 7 | The VM hardcodes no limits: no duration, no "one at a time" check. | Limits come from the service (`expires_at`, 409) and will vary by plan. |
| 8 | URLs are stored only while a public URL is on. | The URL changes every time; an old one is never shown or reused. |
| 9 | Local URLs keep working unchanged while a public URL is on. | The tunnel is an extra way into the same Traefik. |

## 3. Service contract (required service changes)

All calls use the device's account token through `Account.authed()`. `{id}` is
the service project id already stored in `cloud_projects` by sync.

### `POST /v1/tunnels/projects/{id}/url` — turn on

```json
request: {"hostnames": ["recipe-box.127-0-0-1.sslip.io", "api.recipe-box.127-0-0-1.sslip.io"],
          "origin": "http://traefik:39080"}

201:     {"id": "…", "project_id": "…",
          "urls": [{"hostname": "recipe-box.127-0-0-1.sslip.io", "url": "https://k3x9.example.dev"},
                   {"hostname": "api.recipe-box.127-0-0-1.sslip.io", "url": "https://p2m7.example.dev"}],
          "expires_at": "2026-09-24T15:00:00Z",
          "credentials": {"provider": "cloudflare", "token": "…"}}
```

- `origin` is where the tunnel client sends traffic; only the VM knows it (the edge
  port is configurable).
- `urls` has exactly one entry per hostname sent.
- `credentials` is always present on 201: the token for this VM's single tunnel,
  tied by the service to the device behind the bearer token.
- Errors, in the usual `{"error":{"code","message"}}` body:
  - `409 public_url_active` — the account already has an active public URL.
  - `403 public_url_unavailable` — the account's plan has no public URLs.
  - `404` — the service does not know the project.
  - `422` — bad hostnames or origin.

### `GET /v1/tunnels/projects/{id}/url`

200 with the shape above minus `credentials`, or 404 when no URL is live.

### `DELETE /v1/tunnels/projects/{id}/url`

204, or 404 when there is nothing to release. The VM treats both as released.

### Required behaviour

- The service stops routing at `expires_at` on its own, whether or not the VM is
  online. The VM's expiry handling is display and cleanup, never the security
  boundary.
- Every successful POST mints a new URL; none is reused.
- Deleting a service project releases its public URL (the backstop if the VM's own
  release call is lost).

### Gaps against the live service (2026-09-24)

| # | Live today | Needed |
|---|------------|--------|
| T1 | POST takes no body | `{hostnames, origin}` |
| T2 | one `url` string | `urls[]`, one per hostname |
| T3 | no expiry | `expires_at` |
| T4 | `credentials` optional, unclear when sent | always on 201 |
| T5 | no documented 409/403 codes | `public_url_active`, `public_url_unavailable` |
| T6 | undocumented | release on project delete; expiry enforced by the service |

## 4. Stack and installer

### `runtime/stack.yml`

```yaml
  tunnel:
    image: cloudflare/cloudflared:<pinned version>
    profiles: [tunnel]
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token-file /run/omelet/token
    volumes:
      - /opt/omelet/tunnel:/run/omelet:ro
    group_add:
      - "${OMELET_DOCKER_GID:-999}"
    networks:
      - tunnel
```

- `traefik` joins a new compose-managed `tunnel` network. `api`, `web` and
  projects do not.
- The installer's profile-less `up -d` never starts `tunnel`, so without a token it
  is absent.
- `--token-file` keeps the token off the command line and out of the container's
  environment.
- The token's directory is mounted read-only, not the file: docker creates a missing
  file mount source as a root-owned directory, which would wedge every later write
  and removal of the token. A missing directory just mounts empty.
- The cloudflared image runs as a non-root user; `group_add` lets it read the 0640
  docker-group token, the same way `api` reads `api.token`.

### `runtime/install/install.sh`

`docker compose -f /opt/omelet/stack.yml pull` becomes `... --profile tunnel pull`,
so the first "turn on" never waits for an image download. `up -d` stays
profile-less. Nothing else changes: after a repair the API's startup reconcile
brings the client back if a URL is on.

### The API drives the client

Through `LocalRunner`, inside the api container, where `/opt/omelet/stack.yml` and
`/opt/omelet/.env` are visible at the same paths:

- on: `docker compose -f <stack_file> --profile tunnel up -d --no-deps tunnel`
- off: `docker compose -f <stack_file> --profile tunnel rm -sf tunnel`

The compose project name is derived from `/opt/omelet`, the same on both sides.

## 5. Runtime: `core/public.py`

Platform-free. Takes `account`, `cloud`, `state`, `runner`, the token path and the
stack file, plus injectable `clock` and `spawn` (the `Account` pattern).

### Config

`ApiConfig` gains `stack_file` (default `/opt/omelet/stack.yml`, env
`OMELET_STACK_FILE`) and `tunnel_token_path` (default `/opt/omelet/tunnel/token`,
env `OMELET_TUNNEL_TOKEN`). `origin` is `http://{traefik_host}:{edge_port}`, from
values that already exist.

### Storage

Migration `_v5_public_urls`:

```
public_urls(local_id TEXT PRIMARY KEY,
            cloud_id TEXT NOT NULL,     -- kept so a release survives sync dropping the mapping
            state TEXT NOT NULL,        -- enabling | on | releasing | failed | ended
            urls TEXT,                  -- JSON, only while state = 'on'
            expires_at REAL,            -- only while state = 'on'
            reason_code TEXT, reason_message TEXT)
```

### Token file

`/opt/omelet/tunnel/token`, in a directory created on first write and mounted
read-only into the client: written to a temp file created with mode 0640 in the
same directory, then renamed over; group `docker` via `/opt/omelet`'s setgid bit.
It exists only while a URL is on. Turning off, expiry, sign-out and delete remove it.

### Turn on

1. Refuse at once, as `unavailable`, when: not signed in (`signed_out`); the project
   has no `cloud_projects` mapping yet (`not_registered`); the project has no web
   service (`no_web`). A project already `enabling` answers 409 `project_busy`, and so
   does turning it off while it is `enabling`. A row already `on` is returned as is,
   unless its `expires_at` has passed: it is ended as `expired` and a new URL is made.
   A `releasing` row is released first; if that fails the row stays `releasing`
   with `cloud_unavailable` as its reason.
2. Set the row to `enabling`, return, and do the rest on a spawned thread.
3. `POST` with the project's local hostnames (`host_for` for each web service) and
   `origin`.
4. On 201: write the token, start the client, store `urls` and `expires_at`, set `on`.
5. If the client does not start: stop it, delete the token, `DELETE` on the service,
   set `failed` / `client_failed`.
6. On a service error or `CloudUnavailable`: set `failed` with the code (section 6).
   `NotSignedIn` mid-call: set `unavailable` / `signed_out` by deleting the row.

### Turn off

Stop the client and delete the token first, then `DELETE` on the service. 204 or 404
deletes the row. `CloudUnavailable` or any other failure sets `releasing`; the next
reconcile retries. Locally the URL is off at once either way.

### Reconcile

Runs once at API startup (from `routes/__main__.py`, like `account.resume()`) and at
the start of every sync pass:

- `on` with `expires_at` passed → stop the client, delete the token, `ended` /
  `expired`, clear `urls` and `expires_at`.
- `on` and `GET` answers 404 → the same cleanup, `ended` / `released_elsewhere`.
- `releasing` → retry `DELETE`; 204/404 deletes the row if it is still `releasing`.
- `enabling` with no enable thread running (the API restarted mid-call) → `DELETE`
  on the service, then `failed` / `interrupted`.
- No row `on` but the client is running → stop it and delete the token.
  A row `on` but the client is not running → start it; with no token file, end it
  as `client_failed` and `DELETE` it on the service.
- Rows for projects that no longer exist → treated as a delete (below).
- Each row is re-read before it is handled; one whose state moved since the pass's
  snapshot (an enable finished meanwhile) is left for the next pass. A failing
  reconcile is logged and never stops the rest of the sync pass.

Status reads compare `expires_at` with the clock and report `off` with the
`expired` note the moment it passes, before reconcile has cleaned up.

### Project delete

`DELETE /projects/{id}` turns the public URL off (falling back to `releasing`)
before the existing removal and `sync.wake()`. Section 3's release-on-project-delete
is the backstop.

### Sign-out and account change

`Account.sign_out()` turns every live URL off while the token is still valid, before
forgetting it. `_forget` (sign-out, revoked) stops the client, deletes the token and
clears `public_urls`. A revoked account cannot call the service; the service's own
expiry covers it.

## 6. API routes and states

`GET` is on the shared router (`/api/...` for the console, `/...` behind the bearer
token). `POST` and `DELETE` are console-only: mounted at `/api/...` alone, so the
guest token the CLI and coding agents hold cannot turn a public URL on or off.
Additive: `API_VERSION` does not change and the host never calls them.

- `GET /projects/{id}/public` — the status.
- `POST /projects/{id}/public` — 202 with `enabling`. A precondition failure answers
  409 with the unavailable reason's code and message; a project already `enabling`
  answers 409 `project_busy`.
- `DELETE /projects/{id}/public` — the `off` status.
- The project payload (list and single) gains `public` with the same status. The
  in-VM CLI does not print it.

```json
{"state": "unavailable", "reason": {"code": "…", "message": "…"}}
{"state": "off", "note": null}
{"state": "off", "note": {"code": "expired", "message": "…"}}
{"state": "enabling"}
{"state": "on", "urls": [{"url": "https://…", "service": "web", "local_url": "http://…"}],
 "expires_at": 1790000000}
{"state": "failed", "reason": {"code": "…", "message": "…"}}
```

`ended` and `releasing` rows both read as `off`, except a `releasing` row whose
release blocked a new turn-on: it carries a reason and reads as `failed`. `unavailable` is computed on each
read (account and mapping), never stored.

### Wording

The API owns these sentences so every surface says the same thing. A service error
code not listed here reads "The Omelet service refused: <its message>".

| code | shown as | message |
|---|---|---|
| `signed_out` | unavailable | Public addresses need an Omelet account. Sign in to use them. |
| `not_registered` | unavailable | This project isn't linked to your account yet. Try again in a minute. |
| `no_web` | unavailable | This project has no web page to share. |
| `public_url_active` | failed | Only one public address can be on at a time. Turn off the one on "<project>" first. — or, when none is on in this VM: One is already on for another project or computer. Turn it off there first. |
| `public_url_unavailable` | failed | Your plan doesn't include public addresses. |
| `cloud_unavailable` | failed | The Omelet service couldn't be reached. Check the internet connection and try again. |
| `client_failed` | failed | The public connection couldn't start on this computer. |
| `interrupted` | failed | Omelet restarted while turning this on. Try again. |
| `expired` | off note | The public address expired. Start a new one; it will be a different address. |
| `released_elsewhere` | off note | The public address was turned off from the Omelet website. |

## 7. Console

- `projects/public.ts` — `publicView(status, now)`: the API's `public` field plus the
  time to what screens show. An `on` whose `expires_at` has passed becomes `off` with
  the `expired` note. Time left is formatted from `expires_at` only.
- `screens/project/Tiles.tsx` — the Public address tile becomes live. Its small line:
  Off / Turning on… / 42 min left / Didn't work, or the unavailable reason with the
  tile disabled. It opens `PublicModal`.
- `screens/project/PublicModal.tsx`:
  - off — "Anyone with the link can open <project> until it expires. You get a new
    address each time." The ended note above it, if any. **Make it public**.
  - enabling — "Turning on…"; the project query polls while in this state.
  - on — each public URL with Copy and Open (`openExternal`), the time left,
    **Turn off**. When the project is stopped: "Start the project so visitors can
    see it."
  - failed — the reason, **Try again**.
- `screens/project/AddressRows.tsx` — while on, each address row gains a second
  line: `Public · <host> · Copy`.
- `screens/list/ProjectRow.tsx` — a "Public" marker with time left on the project
  that is on.
- Mocks — `?scenario=public-on|public-expiring|public-active-elsewhere|public-unavailable`;
  `public-expiring` ends 20 s after load.

## 8. Release

A runtime release: `__version__`, the Dockerfile's `SERVICE_VERSION` and
`stack.yml`'s api and web tags go to 0.3.0 together. `API_VERSION` and `get.sh`
are unchanged. No host change.

## 9. Testing

Only where a wrong result is plausible:

- `core/public.py`, against a fake cloud, a fake runner, a fake clock and a temp
  token path:
  - a successful enable writes a 0640 token, starts the client, stores the URLs;
  - `public_url_active` names a project that is on in this VM and falls back to the
    "elsewhere" wording otherwise;
  - a client that does not start is released on the service;
  - turning off while the service is unreachable leaves `releasing`, and the next
    reconcile deletes the row;
  - reconcile: an expired URL ends (client stopped, token gone, URLs cleared); a
    `GET` 404 ends as `released_elsewhere`; a leftover `enabling` is released and
    marked `interrupted`;
  - status reports `off`/`expired` once the clock passes `expires_at`, before
    reconcile runs.
- Routes: deleting a project and signing out both release a live URL.
- `core/cloud.py` seam: the POST body is `{hostnames, origin}`; the real error body
  maps to the codes above.
- `stack.yml` boundary guard: `tunnel` is profile-gated, reads a token file, is not
  on `edge`; `api` is not on `tunnel`.
- `install.sh` text assertion: the pull uses `--profile tunnel`.
- Migration: a v4 database migrates to v5 with its rows intact.
- Console: `publicView` flips to off at expiry, formats time left, and maps each
  status to its view.

Not tested: the enable thread and event wiring, the modal's rendering (glue).

### Manual live checks

- Re-running the installer leaves a running `tunnel` container alone.
- cloudflared reads the 0640 token.
- End to end, once the service ships section 3.

## 10. Out of scope and known limits

- **Absolute URLs.** An app that builds links or redirects from its Host header
  (Django `build_absolute_uri`, Rails `url_for`, WordPress site URL, OAuth
  callbacks, emailed links) sends public visitors to `*.127-0-0-1.sslip.io`, which is
  their own machine. Follow-up: the service passes the public host through and the
  API writes Traefik dynamic-file routes for it.
- Residual reach: the tunnel client can reach Traefik's edge entrypoint with any
  Host the service's config sets, including the console's. The console's API still
  needs its session cookie and Origin check, so this exposes only the static page.
  The `tunnel` network also reaches the VM through its gateway, so every port
  published on 0.0.0.0 (the api's, and any `ports:` a user project publishes) is
  reachable from the tunnel client.
- A CLI command for public URLs, host changes, and the service changes themselves.
