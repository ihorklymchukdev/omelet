# Projects console inside the desktop app — design

Date: 2026-09-23
Issue: #14

## 1. Why

A user today meets two interfaces: the desktop app (install, start/stop, ports,
Doctor, uninstall, folder import) and the browser console at
`http://localhost:39080` (projects, files, uploads), which the desktop's
**Open Omelet** button opens in the system browser. For a non-technical user
those read as two different products. The console moves into the desktop
window; the browser stays available as a secondary route.

What the user decided:

- Host-only controls live behind a **native "Omelet" menu**, not a strip drawn
  around the console and not a "Machine" section inside the console.
- **Import folder stays** in the desktop app for now, even though the console
  has uploads.
- **"Open in browser" stays** as a menu item.

## 2. Shape: one window, two kinds of page

The window keeps loading the local desktop UI (`host/desktop/ui/index.html`)
first. When the machine is running it navigates the same window to the console
with `window.load_url`. There is no frame, no second window and no change on
the runtime side: the console, the API, `POST /sessions/handoff` and the
runtime version are untouched, so this ships as a host release alone.

Rejected:

- **Console in an iframe inside a desktop strip.** The top document is a
  `http://127.0.0.1:<random>` page (pywebview serves an absolute local path
  through its own bottle server) and the console is `http://localhost:39080`,
  so the console's
  session cookie is a cross-site cookie inside the frame and is not sent. It
  also needs a `postMessage` protocol between the two.
- **Two windows, one shown at a time** (the console window created without
  `js_api`). Strongest isolation, but keeping two native windows' size and
  position in step is visible jank on both platforms. The guard in §4 covers
  this threat except for the race it names.
- **A "Machine" section inside the console.** The runtime would start knowing
  about the host, and a new host control would need a runtime release.

## 3. Navigation

### Entering the console

A new `DesktopApi.enter_console()`:

1. asks the API for a handoff code (`ApiClient.handoff_code()`),
2. calls `window.load_url(f"http://localhost:{EDGE_PORT}/#handoff={code}")`,
3. returns `{"ok": True}`.

If the handoff throws (stopped VM, unreadable token, older API) it returns
`{"ok": False, "message": ...}` and the window stays where it is. It never
loads the console without a code: inside the app, the console's signed-out
screen tells the user to open Omelet from the desktop app — which is where
they already are — so a bare load is a dead end. `open_omelet` keeps its
bare-URL fallback, because in a real browser that screen is the right one.

### When it happens

- **At launch**, once. `home()` gains a one-shot `enter_console` flag, true
  only on the first call of the process and only when the route is
  `home · running` and neither `first_run` nor `resumed` applies. The JS boot
  calls `enter_console()` when it is set. One-shot for the same reason
  `resumed` is: without it, choosing *Machine* from the menu reloads the local
  UI, re-probes, sees "running" and bounces straight back into the console.
- **From the "The kitchen is open" screen**: its **Open Omelet** button calls
  `enter_console()` instead of `open_omelet()`. On `ok: false` the screen shows
  the message in the existing notice.
- **From the menu**, below.

### The Omelet menu

Passed to `webview.start(menu=...)`. Callbacks are Python functions; nothing
crosses the JS bridge.

| Item | Does |
|---|---|
| Projects | `enter_console()`; on failure a notice on the local UI, or — from the console — back to the local UI, whose Home state explains it |
| Machine | `window.load_url(<local UI>)` — the local UI boots, re-probes and shows Home in its real state; nothing when the local UI already shows |
| Open in browser | `open_omelet()` (today's behaviour: handoff, system browser) |

*Projects* does nothing while a desktop job (install, import, VM start/stop,
repair, uninstall) is running: the local screen is showing that job's
progress, which is the explanation, and leaving it would lose the job's
events (§4).

The window title is "Omelet" while the console is showing.

## 4. Security: the bridge is not the console's

pywebview injects `window.pywebview.api` into **every** page loaded in the
window, the console included. The console is served from inside the VM, where
coding agents run with root; anything there can replace the `omelet-web`
container. Unguarded, a page from the VM could call `reboot_now`,
`start_uninstall`, or `start_import` with an arbitrary host path.

So:

- **Every public `DesktopApi` method is guarded.** The shell records the
  local UI's URL the first time it sees an `http(s)` URL — before the first
  navigation away, the only page the window has shown is the local UI, and
  navigation is refused until that URL is known. A guarded method reads
  `window.get_current_url()` and raises unless it equals that URL (ignoring
  the fragment). The console can see the method names and run none of them.
  The guard is applied to the class as a whole, not method by method, so a
  method added later cannot forget it. The facade's members are bound
  methods, because pywebview before 6.2 exposes nothing else.
- **What the guard does not cover.** It checks the page showing when the call
  is handled, not the page that sent it; pywebview does not expose the
  sender. The local UI is plain `http://127.0.0.1:<port>`, so a console page
  that finds the port can navigate the window there itself. Landing on the
  genuine local UI gains it nothing — its own script is gone — but a call
  posted just before that navigation commits and handled just after would
  pass. Closing that needs the rejected two-window shape.
- **Job events are pushed only to the local UI.** `push` checks the current
  URL the same way before `evaluate_js`, so a console page that defines its
  own `window.omelet.on` never receives progress events.
- `private_mode` stays at its default (on): the console's session cookie does
  not outlive the app, and every launch starts from a fresh handoff.

## 5. Edge cases

- **VM dies while the console is open.** The console shows its own "Omelet
  isn't answering" screen. *Machine* re-probes and shows the real state with
  its buttons. No background polling.
- **Session expired or handoff spent.** The console shows "We've lost track of
  you"; *Projects* issues a fresh handoff.
- **Links to a user's app** (`*.localhost:39080`). The console opens them with
  `target="_blank"` and `window.open(..., "_blank")`; pywebview's
  `OPEN_EXTERNAL_LINKS_IN_BROWSER` (default on) sends them to the system
  browser. On WKWebView pywebview forwards only link activations, so the
  console's `window.open` buttons do nothing there until the console renders
  them as `<a target="_blank">` — a runtime-side change.
- **Install finishing.** The install screen returns to Home as today; there is
  no automatic jump into the console after an install (the launch flag is
  already spent). The user presses **Open Omelet**.

## 6. Testing

Tests where a wrong result is plausible:

- **The guard.** Every public `DesktopApi` method raises when the current URL
  is the console, or any URL other than the recorded local one, and works on
  the local one. The test enumerates the class's public methods rather than a
  hand-kept list.
- **`push`** drops events when the current URL is not the local UI.
- **`enter_console()`** loads `…/#handoff=<code>` on success; on a failing
  handoff it loads nothing and returns `ok: false`.
- **`home()`'s `enter_console` flag** is true once, only for `running`, and
  never alongside `first_run` or `resumed`.
- **Menu wiring**, through `run()`'s existing `create`/`start` seams: `start`
  receives a menu with Projects, Machine and Open in browser.

Left untested on purpose: pywebview's `load_url`, menu rendering and
external-link handling — that is the library. Covered by the manual
acceptance run instead: enter the console at launch, *Machine* and back,
*Open in browser*, a project link and a `window.open` button opening in the
system browser, and (from devtools in a debug build) a call to
`window.pywebview.api.doctor()` from the console being refused.
