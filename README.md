# Claude Usage Monitor

A GNOME Shell extension that shows your **Claude Code usage for the current
5-hour rolling window** as a small progress bar in the top panel.

- **Progress bar** in the panel, filling toward your limit.
- **Background colour indication** — green → amber → red as you climb.
- **Warning icon (⚠)** appears once you cross the critical threshold.
- Click for a popup with tokens, cost, burn rate, projection, and time-to-reset.

Usage data comes entirely from the local [`ccusage`](https://github.com/ryoppippi/ccusage)
CLI, which parses your `~/.claude` session logs into rolling 5-hour blocks. No
network calls are made by the extension.

## Requirements

- GNOME Shell 45–50 (developed on 50.1, Wayland).
- Node.js with `ccusage` reachable — either installed globally, or runnable via
  `npx`. The extension auto-detects `npx`/`ccusage` even under nvm/volta/bun,
  whose `PATH` GNOME Shell does not normally inherit. If yours lives somewhere
  exotic, set an explicit command in **Settings → Data source**.

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
| Progress metric | Tokens | Bar fills against tokens, cost (USD), or time elapsed in the block |
| Token / Cost limit | 0 (auto) | `0` = use your largest past 5-hour block as 100% |
| Warning threshold | 75% | Bar turns amber |
| Critical threshold | 90% | Bar turns red and the ⚠ icon appears |
| Refresh interval | 60 s | How often `ccusage` is re-run |
| ccusage command | (auto) | Override the argv used to invoke ccusage |

## Documentation

- [SPEC.md](SPEC.md) — what it is and why.
- [JOURNAL.md](JOURNAL.md) — design decisions and rationale.
- [AGENTS.md](AGENTS.md) — conventions for AI/code agents.

## License

All rights reserved (personal project — change as desired).
