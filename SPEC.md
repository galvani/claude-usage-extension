# Claude Usage Monitor — Specification

## Identity
- **Name:** claude-usage-extension (UUID `claude-usage@galvani78`)
- **Type:** GNOME Shell extension (GJS / ESM)
- **Language:** JavaScript (GJS), GTK4/libadwaita for prefs
- **Created:** 2026-06-11

## Purpose

Show your **real Claude subscription usage** — the same 5-hour rolling-window
figure as Claude Code's `/usage` — as a colour-coded progress bar in the GNOME
top panel, so heavy users can see at a glance how close they are to their limit
without opening a terminal.

## Motivation

Claude Code enforces a rolling 5-hour usage window (and weekly limits), but
nothing surfaces that on the desktop. The official utilisation is available only
from Anthropic's own endpoint; this extension reads it and turns it into an
always-visible panel gauge, coloured by *pace* so it warns before you run out.

## Core Behavior

- A `PanelMenu.Button` in the top panel containing: an optional ⚠ icon, an
  optional percentage label, and a fixed-width progress bar. The bar carries a
  thin tick marking time elapsed in the current 5-hour window (the "on-pace"
  position); fill past the tick = burning faster than the clock.
- The bar shows the **5-hour `utilization`** (0–100%) from the usage endpoint.
- **Pace colouring** via three levels, driven by *projected* end-of-window usage
  (current utilisation ÷ fraction of the window elapsed): normal (green), warning
  (amber, projected ≥ warn threshold, default 100%), critical (red, projected ≥
  critical threshold, default 150%, or utilisation ≥ 100%). A pace floor keeps a
  near-empty fresh window green despite the tiny-`timeFrac` spike.
- The **⚠ icon** appears at the critical level and on data errors.
- Clicking opens a popup with: the 5-hour line + reset countdown, the pace
  breakdown (used % vs window elapsed % → projected %), the weekly and
  weekly-Sonnet limits, and a freshness/status footer. Plus "Refresh now" and
  "Settings".
- **Data flow:** every `usage-poll-interval` (default 300 s) the extension GETs
  Anthropic's usage endpoint and caches the result; every `refresh-interval`
  (default 60 s) it re-renders from cache so the marker/countdown advance without
  a network call. 429s trigger exponential backoff; the last-good value is kept.

## Tech Stack

- GNOME Shell 45–50 ESM extension API (`Extension`, `PanelMenu`, `PopupMenu`).
- `St`/`Clutter` for the widget, CSS classes for colour levels.
- `Soup` 3 (async) for the HTTPS GET; `Gio` async file read for the credential.
- `GSettings` schema `org.gnome.shell.extensions.claude-usage` + Adw prefs.

## Data source & credentials

- Source: `GET https://api.anthropic.com/api/oauth/usage` with
  `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`.
  Response: `five_hour`, `seven_day`, `seven_day_sonnet`, … each
  `{utilization (0–100), resets_at (ISO 8601, µs precision)}`.
- The OAuth token is the one Claude Code already stores in
  `~/.claude/.credentials.json`. Read **per fetch**, sent **in-process** (never
  in argv/env/logs), only to `api.anthropic.com` over HTTPS. Never persisted or
  copied. `expiresAt` is honoured; the extension does **not** refresh the token
  (Claude Code rewrites the file) — an expired token shows a clear prompt to open
  Claude Code.

## Constraints

- Exactly one external endpoint (the usage endpoint); no other network.
- Must never block the shell → all I/O async + cancellable, in-flight fetches
  skipped, `Soup.Session` aborted on `disable()`.
- Must degrade gracefully: rate-limit (429) → backoff + last-good; expired token
  → prompt; no data yet → "loading".

## What This Project Is NOT

- Not a general Anthropic API client — it calls exactly one usage endpoint and
  does no inference.
- Not a cost-history/reporting tool (use `ccusage` for local token/cost detail).
- Does not implement OAuth (no login/refresh flows); it piggybacks on the token
  Claude Code maintains.

## History

Originally (2026-06-11) built on the local `ccusage` CLI with a hard "no network,
no credentials" constraint, on the assumption the official quota wasn't
obtainable. That assumption was disproved (2026-06-16): the `ccusage`-derived
number never matched `/usage` (dominated by cache-read tokens, misaligned
windows), and the official figure exists only behind the OAuth usage endpoint.
The data source was rebuilt around that endpoint; ccusage was removed.
