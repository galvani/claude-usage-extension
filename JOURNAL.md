# Claude Usage Monitor — Journal

Newest first. Records *what* changed and *why* (decisions, gotchas), not just files.

## 2026-06-11 — Project initialized & first implementation

- **Decision:** Target GNOME Shell **45–50** with the modern ESM extension API
  (developed on 50.1 / Wayland). Rationale: GNOME 45 was the ESM cutover; one
  codebase covers everything current.
- **Decision:** Data source is the local **`ccusage` CLI** (`blocks --json`),
  not the Anthropic API. Rationale: ccusage already parses `~/.claude` session
  logs into rolling 5-hour blocks with tokens/cost/burn-rate/projection; the API
  does not expose subscription quota, and a panel widget shouldn't hold creds.
- **Gotcha:** GNOME Shell launches with a minimal `PATH` that excludes
  nvm/volta/bun. On this box `ccusage` is only reachable via nvm's `npx`
  (`/home/jan/.nvm/versions/node/v24.15.0/bin/npx`). The extension rebuilds PATH
  (globbing `~/.nvm/versions/node/*/bin`, plus common bins) for the subprocess,
  and also accepts an explicit `ccusage-command` override. Without this the
  widget silently shows nothing.
- **Gotcha:** `ccusage blocks --json --token-limit max` does **not** embed a
  limit field in the JSON. So the extension computes "100%" itself: the largest
  past (non-active, non-gap) block, or a user-set token/cost limit.
- **Decision:** Colour is driven entirely by a single `level-*` CSS class
  toggled on the track (idle/normal/warning/critical/error); JS never hard-codes
  colours. Keeps theming in `stylesheet.css`.
- **Decision:** Three selectable metrics (tokens/cost/time). Tokens is default;
  time is always-meaningful even when limits are unknown.
- **Safety:** All ccusage calls are async via `Gio.Subprocess` + `Cancellable`,
  overlapping refreshes are skipped, and `disable()` cancels in-flight work and
  removes the timer — required for clean lock-screen disable cycles.

---

## Template for future entries

## YYYY-MM-DD — {title}

- **Decision:** {what} — {why}
- **Gotcha:** {non-obvious thing discovered}
