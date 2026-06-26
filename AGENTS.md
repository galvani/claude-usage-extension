# Claude Usage Monitor — Agent instructions

## What
GNOME Shell 45–50 extension (GJS/ESM) showing your **real Claude subscription
usage** (the same numbers as Claude Code's `/usage`) as a colour-coded panel
progress bar. See [SPEC.md](SPEC.md).

## Tech / layout
- `extension.js` — panel indicator, usage-endpoint fetch + caching, pace math, lifecycle.
- `prefs.js` — GTK4/libadwaita preferences.
- `stylesheet.css` — `level-*` colour classes (all colour lives here).
- `schemas/org.gnome.shell.extensions.claude-usage.gschema.xml` — GSettings.
- `Makefile` — install (symlink), schemas, enable/disable, logs, pack.

## Conventions
- Modern ESM only: `import … from 'gi://…'` and `resource:///org/gnome/shell/…`.
  No legacy `imports.*`.
- Colours never hard-coded in JS — toggle one `level-*` class on the track.
- Every `GLib` source / signal / `Cancellable` / `Soup.Session` created in
  `enable()`/`_init()` MUST be torn down in `disable()`/`destroy()`. Lock-screen
  disables the extension; leaks crash the shell.
- All I/O is **async** (`Soup.Session.send_and_read_async`, `Gio` async file
  read) with a `Cancellable`; never sync — a blocking call freezes the whole
  shell. Skip a fetch if one is in flight.
- Comment the *why* for non-obvious bits (microsecond timestamps, pace floor).

## Credential & network rules (deliberate)
This widget **does** make a network call and **does** read a credential — both
were forbidden in the original design, then deliberately reversed once we proved
the official usage figure is obtainable *only* this way. Constraints:
- **Only** call `https://api.anthropic.com/api/oauth/usage` (the same host +
  token Claude Code uses). No other network.
- Read the OAuth token from `~/.claude/.credentials.json` **per fetch**; pass it
  **in-process** via a `Soup` header — **never** in argv/env/logs (a curl
  subprocess would leak it to the process table).
- **Never** persist, copy, or log the token. Honour `expiresAt`; do **not**
  implement OAuth refresh — Claude Code rewrites the file, we just re-read it.
- The endpoint throttles **hard**: cache aggressively, back off on 429, keep the
  last-good value. Default fetch interval 300s — do not lower the floor.

## Dev loop
`make install && make enable`, then log out/in (Wayland can't hot-reload the
shell). `make logs` tails errors. Quick checks: `glib-compile-schemas schemas/`
and `node --check` on `.mjs` copies of the JS.

## Agent notes
<!-- Append 1–2 line discoveries here: hidden constraints, quirks, failed approaches. -->
- Official 5-hour figure: `GET api.anthropic.com/api/oauth/usage` with
  `Authorization: Bearer <token>` + `anthropic-beta: oauth-2025-04-20`. Returns
  `five_hour/seven_day/seven_day_sonnet/...` each `{utilization (0-100 float), resets_at}`.
- `resets_at` is ISO 8601 with **microsecond** precision + numeric offset
  (`...099437+00:00`). JS `Date.parse` needs ms — trim to 3 fractional digits first.
- The endpoint is **aggressively rate-limited**: a burst of test calls earns a
  long (~hour-ish) 429 cooldown. The active Claude Code session also competes for
  the per-token budget. One call per ~5 min is fine.
- **Dead ends** (do not re-investigate): ccusage `totalTokens` is ~98% cache-read
  noise and its blocks don't align with the official rolling window; `claude -p
  "/usage"` prints only *local* behavioural insights, never the gauge; the model
  in chat has **NO_ACCESS** to usage (it's client-side); session JSONs hold no
  usage; there is **no on-disk cache** of the usage payload.
- The 5-hour window start = `resets_at − 5h` (rolling), used for the pace timeFrac.
- To overlay multiple children in one St widget (fill + time marker on the track),
  use `St.Widget` with `layout_manager: new Clutter.FixedLayout()` and position
  children via explicit `set_position`/`set_size`. `St.Bin` holds only one child.
- Bar colour = *pace* (projected end-of-window usage = `utilization / timeFrac`),
  not raw usage. `PACE_FLOOR_PCT` keeps fresh windows green (tiny `timeFrac` spikes
  the projection); utilisation ≥ 100% forces critical.
