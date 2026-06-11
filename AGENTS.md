# Claude Usage Monitor — Agent instructions

## What
GNOME Shell 45–50 extension (GJS/ESM) showing Claude Code 5-hour-block usage as
a colour-coded panel progress bar. See [SPEC.md](SPEC.md).

## Tech / layout
- `extension.js` — panel indicator, ccusage invocation, usage math, lifecycle.
- `prefs.js` — GTK4/libadwaita preferences.
- `stylesheet.css` — `level-*` colour classes (all colour lives here).
- `schemas/org.gnome.shell.extensions.claude-usage.gschema.xml` — GSettings.
- `Makefile` — install (symlink), schemas, enable/disable, logs, pack.

## Conventions
- Modern ESM only: `import … from 'gi://…'` and `resource:///org/gnome/shell/…`.
  No legacy `imports.*`.
- Colours never hard-coded in JS — toggle one `level-*` class on the track.
- Every `GLib` source / signal / `Cancellable` created in `enable()`/`_init()`
  MUST be torn down in `disable()`/`destroy()`. Lock-screen disables the
  extension; leaks crash the shell.
- ccusage runs **async** (`Gio.Subprocess` + `Cancellable`); never sync — a
  blocking call freezes the whole shell. Skip a refresh if one is in flight.
- Comment the *why* for non-obvious bits (PATH augmentation, limit derivation).

## What NOT to do
- No network calls. Data is local `ccusage` / `~/.claude` only.
- Don't assume `npx`/`ccusage` is on `PATH` — GNOME Shell's PATH is minimal.
- Don't store Anthropic credentials anywhere.

## Dev loop
`make install && make enable`, then log out/in (Wayland can't hot-reload the
shell). `make logs` tails errors. Quick checks: `glib-compile-schemas schemas/`
and `node --check` on `.mjs` copies of the JS.

## Agent notes
<!-- Append 1–2 line discoveries here: hidden constraints, quirks, failed approaches. -->
- ccusage on this box is only reachable via nvm's npx; GNOME Shell PATH excludes it.
- `ccusage blocks --json` does not include a token-limit field even with `--token-limit max`.
