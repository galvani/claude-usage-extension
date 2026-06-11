# Claude Usage Monitor — Specification

## Identity
- **Name:** claude-usage-extension (UUID `claude-usage@galvani78`)
- **Type:** GNOME Shell extension (GJS / ESM)
- **Language:** JavaScript (GJS), GTK4/libadwaita for prefs
- **Created:** 2026-06-11

## Purpose

Show Claude Code usage for the current 5-hour rolling window as a colour-coded
progress bar in the GNOME top panel, so heavy users can see at a glance how
close they are to their limit without opening a terminal.

## Motivation

Claude Code enforces a rolling 5-hour usage window, but nothing surfaces that
on the desktop. `ccusage` already aggregates `~/.claude` logs into 5-hour
"blocks"; this extension turns that into an always-visible panel gauge.

## Core Behavior

- A `PanelMenu.Button` in the top panel containing: an optional ⚠ icon, an
  optional percentage label, and a fixed-width progress bar.
- The bar fills against a configurable metric — **tokens** (default), **cost**,
  or **time** elapsed in the block.
- **Background colour indication** via three levels: normal (green), warning
  (amber, ≥ warn threshold), critical (red, ≥ critical threshold).
- The **⚠ icon** appears at the critical threshold and on data errors.
- Clicking opens a popup with: tokens, cost, burn rate, projected end-of-block
  cost, and minutes until the window resets. Plus "Refresh now" and "Settings".
- Data is refreshed on a timer by running `ccusage blocks --json` and reading
  the `isActive` block. The "auto" limit (0) is the largest past block.

## Tech Stack

- GNOME Shell 45–50 ESM extension API (`Extension`, `PanelMenu`, `PopupMenu`).
- `St`/`Clutter` for the widget, CSS classes for colour levels.
- `Gio.Subprocess` (async) to invoke `ccusage`.
- `GSettings` schema `org.gnome.shell.extensions.claude-usage` + Adw prefs.

## Constraints

- **No network access** from the extension — local `ccusage`/`~/.claude` only.
- Must tolerate GNOME Shell's minimal `PATH` (nvm/volta/bun node not inherited)
  → builds an augmented PATH and/or honours an explicit command override.
- ccusage must never block the shell → all invocations are async + cancellable,
  and overlapping refreshes are skipped.

## What This Project Is NOT

- Not an Anthropic API client; it does not authenticate or fetch live quota.
- Not a cost-history/reporting tool — `ccusage` itself covers that.
- Does not expose or enforce the true server-side subscription limit (which is
  not published locally); the gauge is relative to a configurable/auto ceiling.
