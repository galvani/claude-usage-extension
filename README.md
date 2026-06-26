# Claude Usage Monitor

A GNOME Shell extension that shows your **real Claude subscription usage** — the
same 5-hour rolling-window figure as Claude Code's `/usage` — as a small progress
bar in the top panel.

![The panel bar at 5% usage early in the window — green, with the tick marking time elapsed](docs/panel.png)

- **Progress bar** in the panel showing your 5-hour `utilization`, with a thin
  tick marking how far through the window you are.
- **Pace colouring** — green → amber → red driven by *projected* end-of-window
  usage, not raw usage. The bar goes amber when you're on track to hit the limit
  by reset and red when you're on track to overshoot it. Fill past the time tick
  means you're burning faster than the clock.
- **Warning icon (⚠)** appears once your pace crosses the critical threshold.
- Click for a popup with the 5-hour line + reset, the pace breakdown, and your
  weekly / weekly-Sonnet limits.

The number matches `/usage` because it comes from the same place: Anthropic's
usage endpoint (`/api/oauth/usage`), read with the OAuth token Claude Code
already stores in `~/.claude/.credentials.json`.

> **Note on credentials & network.** This extension reads your local Claude OAuth
> token and sends it (in-process, never on a command line) to `api.anthropic.com`
> over HTTPS — the same host and token Claude Code itself uses — to fetch your
> usage. The token is never persisted, copied, or logged, and no other network
> calls are made. The `/api/oauth/usage` endpoint is **undocumented** and may
> change without notice. If your token has expired, open Claude Code once to
> refresh it.

## Requirements

- GNOME Shell 45–50 (developed on 50.1, Wayland) — bundles libsoup 3.
- **Claude Code installed and signed in** (a Pro/Max subscription). The extension
  uses the OAuth token it stores; it does no login of its own.

## Install (development)

```bash
make install   # symlink into ~/.local/share/gnome-shell/extensions + compile schemas
make enable    # gnome-extensions enable
# Wayland: log out and back in to load the new extension.
make logs      # tail the shell journal for this extension
```

`make uninstall` removes the symlink. `make pack` builds a distributable zip.

## Configuration

Open **Settings** from the panel popup (or `gnome-extensions prefs claude-usage@galvani78`):

| Setting | Default | Meaning |
|---|---|---|
| Warning pace | 100% | Amber when projected to land *at* the limit by reset |
| Critical pace | 150% | Red + ⚠ when projected to land at 1.5× the limit |
| Usage fetch interval | 300 s | Min time between calls to the usage endpoint (it rate-limits hard — keep high) |
| Panel update interval | 60 s | How often the bar re-renders from cache (no network) |
| Bar width | 46 px | Width of the progress-bar track |
| Show percentage label | on | Numeric % next to the bar |

## Documentation

- [SPEC.md](SPEC.md) — what it is and why.
- [AGENTS.md](AGENTS.md) — conventions for AI/code agents.

## License

[MIT](LICENSE) — do what you want, just keep the notice.
