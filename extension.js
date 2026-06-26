/* Claude Usage Monitor — GNOME Shell 45+ (ESM) panel indicator.
 *
 * Shows your real Claude subscription usage in the top panel: the 5-hour
 * rolling-window utilisation as a colour-coded progress bar, coloured by
 * *pace* (are you burning faster than the clock?), plus weekly limits in the
 * popup.
 *
 * Data source: Anthropic's own usage endpoint — the same numbers Claude Code's
 * `/usage` command shows. This is the only source of the official figure;
 * local logs (e.g. ccusage) cannot reproduce it because the subscription limit
 * is a weighted/internal measure on a rolling window that does not align with
 * any locally-derivable block. See JOURNAL.md (2026-06-16) for the full story.
 *
 * Credential handling: we read the OAuth access token Claude Code already
 * stores in ~/.claude/.credentials.json and send it (in-process, never on a
 * command line) to api.anthropic.com over HTTPS — the same host/credential
 * Claude Code itself uses. The token is never persisted, copied, or logged. We
 * do not refresh it: Claude Code rewrites the file when it runs, and we just
 * re-read it. An expired token surfaces a clear "open Claude Code" state.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Soup from 'gi://Soup'; // GNOME Shell 45+ bundles libsoup 3
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// Required beta header — the endpoint rejects the OAuth token without it.
const OAUTH_BETA = 'oauth-2025-04-20';
const CREDS_PATH = `${GLib.get_home_dir()}/.claude/.credentials.json`;

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

// Below this utilisation a window reads green regardless of pace: early in a
// window timeFrac is tiny, so a few percent of use extrapolates to absurd
// projected values. Keeps a fresh window calm.
const PACE_FLOOR_PCT = 10;

// At/above this utilisation the window is red regardless of pace: you're a
// prompt or two from the cap, so "on pace" is irrelevant — what matters is the
// thin headroom left. Absolute usage trumps projection near the ceiling.
const ABS_CRIT_PCT = 90;

// Bar geometry (width is user-configurable; these are fixed).
const BAR_HEIGHT = 10;
const MARKER_WIDTH = 2;

// Network backoff ceiling when the endpoint rate-limits us (it throttles hard).
const MAX_BACKOFF_MS = 30 * 60 * 1000;

// ----------------------------------------------------------------------------
// Data acquisition
// ----------------------------------------------------------------------------

// Read the OAuth access token Claude Code stores locally. Resolves
// {token, expiresAt(ms)}; rejects if the file is missing/unparseable.
function readCredentials(cancellable) {
    return new Promise((resolve, reject) => {
        const f = Gio.File.new_for_path(CREDS_PATH);
        f.load_contents_async(cancellable, (file, res) => {
            try {
                const [, contents] = file.load_contents_finish(res);
                const json = JSON.parse(new TextDecoder().decode(contents));
                const o = json.claudeAiOauth ?? {};
                if (!o.accessToken)
                    throw new Error('no claudeAiOauth.accessToken in credentials');
                resolve({token: o.accessToken, expiresAt: Number(o.expiresAt) || 0});
            } catch (e) {
                reject(e);
            }
        });
    });
}

// GET the usage endpoint. Resolves {status, text}; rejects only on transport
// failure (a 429/401 is a normal resolve so the caller can branch on it).
function fetchUsage(session, token, cancellable) {
    return new Promise((resolve, reject) => {
        const msg = Soup.Message.new('GET', USAGE_URL);
        const h = msg.get_request_headers();
        h.append('Authorization', `Bearer ${token}`);
        h.append('anthropic-beta', OAUTH_BETA);
        h.append('User-Agent', 'claude-usage-gnome-extension');
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable, (sess, res) => {
            try {
                const bytes = sess.send_and_read_finish(res);
                const text = bytes ? new TextDecoder().decode(bytes.get_data()) : '';
                resolve({status: msg.get_status(), text});
            } catch (e) {
                reject(e);
            }
        });
    });
}

// `resets_at` comes as ISO 8601 with microsecond precision and a numeric
// offset, e.g. "2026-06-16T16:40:00.099437+00:00". JS Date only groks
// millisecond precision, so trim the fractional part to 3 digits first.
function parseResetMs(s) {
    if (!s)
        return 0;
    const t = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
    return Number.isFinite(t) ? t : 0;
}

// One limit bucket from the payload → {pct, resetMs} or null if absent.
function pickLimit(o) {
    return o && typeof o.utilization === 'number'
        ? {pct: o.utilization, resetMs: parseResetMs(o.resets_at)}
        : null;
}

// Flatten the raw `oauth/usage` JSON into the buckets we display.
function parseUsage(text) {
    const d = JSON.parse(text);
    return {
        five: pickLimit(d.five_hour),
        week: pickLimit(d.seven_day),
        sonnet: pickLimit(d.seven_day_sonnet),
        opus: pickLimit(d.seven_day_opus),
    };
}

// ----------------------------------------------------------------------------
// Usage math
// ----------------------------------------------------------------------------

// Project the 5-hour bucket to the end of its window. timeFrac is 0 at the
// window start and 1 at reset; projectedPercent linearly extrapolates current
// usage (15% used at 45% elapsed -> projected 33%) and drives the colour.
function fiveHourView(five) {
    if (!five || !five.resetMs)
        return null;
    const pct = Math.max(0, five.pct);
    const end = five.resetMs;
    const start = end - FIVE_HOURS_MS;
    const now = Date.now();
    const timeFrac = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;
    const projectedPercent = timeFrac > 0 ? pct / timeFrac : pct;
    const resetMin = Math.max(0, Math.round((end - now) / 60000));
    return {pct, projectedPercent, timeFrac, resetMin};
}

// Compact human duration from milliseconds, for reset countdowns.
function fmtDuration(ms) {
    if (ms <= 0)
        return _('now');
    const min = Math.round(ms / 60000);
    if (min < 60)
        return _('%dm').format(min);
    const h = Math.floor(min / 60);
    if (h < 24)
        return _('%dh %dm').format(h, min % 60);
    const d = Math.floor(h / 24);
    return _('%dd %dh').format(d, h % 24);
}

function resetIn(resetMs) {
    return fmtDuration(resetMs - Date.now());
}

// ----------------------------------------------------------------------------
// Panel indicator
// ----------------------------------------------------------------------------

const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('Claude Usage Monitor'));
        this._extension = extension;
        this._settings = extension.getSettings();
        this._session = new Soup.Session({timeout: 15});
        this._timerId = null;
        this._cancellable = null;
        this._busy = false;

        // Cache + fetch state. We render every tick from the cache (so the time
        // marker / countdown advance), but only hit the network occasionally.
        this._cache = null;          // {five, week, sonnet, opus}
        this._lastFetchMs = 0;
        this._backoffUntilMs = 0;
        this._consecutive429 = 0;
        this._errState = null;       // null | 'expired' | 'ratelimited' | 'error'
        this._lastError = '';

        // --- panel contents: [warning icon] [percent label] [progress bar] ---
        const box = new St.BoxLayout({style_class: 'claude-usage-box', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(box);

        this._warnIcon = new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            style_class: 'claude-usage-warn-icon',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        box.add_child(this._warnIcon);

        this._label = new St.Label({
            text: '…',
            style_class: 'claude-usage-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);

        // Track holds two overlaid children: the usage fill (width = usage %)
        // and a thin time marker (x = how far through the 5-hour window we are).
        // Fill past the marker = burning faster than the clock. FixedLayout lets
        // us position both by explicit set_position/set_size.
        this._track = new St.Widget({
            style_class: 'claude-usage-track',
            layout_manager: new Clutter.FixedLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill = new St.Widget({style_class: 'claude-usage-fill'});
        this._marker = new St.Widget({style_class: 'claude-usage-marker', visible: false});
        this._track.add_child(this._fill);
        this._track.add_child(this._marker);
        box.add_child(this._track);

        this._buildMenu();
        this._applySizing();

        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'refresh-interval')
                this._restartTimer();
            else if (key === 'bar-width' || key === 'show-percentage')
                this._applySizing();
            this._render();
        });

        this._restartTimer();
        this._tick(); // immediate first fetch+paint
    }

    _buildMenu() {
        this._mFive = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._mPace = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._mWeek = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._mSonnet = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._mMeta = new PopupMenu.PopupMenuItem('', {reactive: false});
        for (const it of [this._mFive, this._mPace, this._mWeek, this._mSonnet, this._mMeta])
            this.menu.addMenuItem(it);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refresh = new PopupMenu.PopupMenuItem(_('Refresh now'));
        refresh.connect('activate', () => {
            // Force past the cache gate and any backoff.
            this._lastFetchMs = 0;
            this._backoffUntilMs = 0;
            this._tick();
        });
        this.menu.addMenuItem(refresh);

        const prefs = new PopupMenu.PopupMenuItem(_('Settings…'));
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    _applySizing() {
        this._barWidth = this._settings.get_int('bar-width');
        this._track.set_size(this._barWidth, BAR_HEIGHT);
        this._label.visible = this._settings.get_boolean('show-percentage');
    }

    _restartTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // One timer tick: maybe hit the network (gated), then always re-render so
    // the marker / countdown advance with the clock between fetches.
    async _tick() {
        await this._maybeFetch();
        this._render();
    }

    async _maybeFetch() {
        if (this._busy)
            return;
        const now = Date.now();
        const pollMs = this._settings.get_int('usage-poll-interval') * 1000;
        if (this._cache && now - this._lastFetchMs < pollMs)
            return; // cache still fresh enough
        if (now < this._backoffUntilMs)
            return; // backing off after a 429

        this._busy = true;
        this._cancellable = new Gio.Cancellable();
        try {
            const creds = await readCredentials(this._cancellable);
            if (creds.expiresAt && creds.expiresAt <= now) {
                // Token expired and we won't refresh it ourselves — Claude Code
                // rewrites the file when it next runs. Keep any last-good value.
                this._errState = 'expired';
                return;
            }

            const {status, text} = await fetchUsage(this._session, creds.token, this._cancellable);
            if (status === 200) {
                this._cache = parseUsage(text);
                this._lastFetchMs = now;
                this._consecutive429 = 0;
                this._errState = null;
            } else if (status === 429) {
                // Endpoint throttles aggressively; back off exponentially.
                this._consecutive429 += 1;
                const backoff = Math.min(MAX_BACKOFF_MS, pollMs * 2 ** this._consecutive429);
                this._backoffUntilMs = now + backoff;
                if (!this._cache)
                    this._errState = 'ratelimited';
            } else if (status === 401 || status === 403) {
                this._errState = 'expired';
            } else {
                this._lastError = `HTTP ${status}`;
                if (!this._cache)
                    this._errState = 'error';
            }
        } catch (e) {
            if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                this._lastError = String(e?.message ?? e);
                if (!this._cache)
                    this._errState = 'error';
            }
        } finally {
            this._busy = false;
            this._cancellable = null;
        }
    }

    _render() {
        // No data yet → show whatever error state we have, else "loading".
        if (!this._cache) {
            this._renderEmpty();
            return;
        }

        const view = fiveHourView(this._cache.five);
        if (!view) {
            this._renderEmpty();
            return;
        }

        const warn = this._settings.get_int('warn-threshold');
        const crit = this._settings.get_int('critical-threshold');
        const pct = view.pct;
        const proj = view.projectedPercent;

        // Colour = pace, with two guards: a fresh window stays green below the
        // floor (tiny-timeFrac spike), and near/at the cap absolute usage forces
        // red regardless of pace (little headroom left → projection irrelevant).
        let level;
        if (pct < PACE_FLOOR_PCT)
            level = 'normal';
        else if (pct >= ABS_CRIT_PCT || proj >= crit)
            level = 'critical';
        else if (proj >= warn)
            level = 'warning';
        else
            level = 'normal';
        this._setLevel(level);
        this._warnIcon.visible = level === 'critical';

        this._label.text = `${Math.round(pct)}%`;
        const fillW = Math.round(Math.min(1, pct / 100) * this._barWidth);
        this._fill.set_position(0, 0);
        this._fill.set_size(fillW, BAR_HEIGHT);
        const markerX = Math.min(this._barWidth - MARKER_WIDTH,
            Math.round(view.timeFrac * this._barWidth));
        this._marker.set_position(markerX, 0);
        this._marker.set_size(MARKER_WIDTH, BAR_HEIGHT);
        this._marker.visible = true;

        this._mFive.label.text = _('5-hour limit: %d%%  ·  resets in %s')
            .format(Math.round(pct), resetIn(this._cache.five.resetMs));
        this._mPace.label.text = _('Pace: %d%% used at %d%% of window → projected %d%%')
            .format(Math.round(pct), Math.round(view.timeFrac * 100), Math.round(proj));
        this._mWeek.label.text = this._cache.week
            ? _('Weekly: %d%%  ·  resets in %s')
                .format(Math.round(this._cache.week.pct), resetIn(this._cache.week.resetMs))
            : '';
        this._mSonnet.label.text = this._cache.sonnet
            ? _('Weekly (Sonnet): %d%%').format(Math.round(this._cache.sonnet.pct))
            : '';
        this._mMeta.label.text = this._metaText();
    }

    _renderEmpty() {
        this._setLevel('error');
        this._fill.set_size(0, BAR_HEIGHT);
        this._marker.visible = false;
        const msg = this._errState === 'expired'
            ? _('Claude credentials expired — open Claude Code to refresh')
            : this._errState === 'ratelimited'
                ? _('Rate-limited by Anthropic — will retry shortly')
                : this._errState === 'error'
                    ? _('Could not read usage: %s').format(this._lastError)
                    : _('Loading usage…');
        const loading = !this._errState;
        this._label.text = loading ? '…' : '!';
        this._warnIcon.visible = !loading;
        this._mFive.label.text = msg;
        this._mPace.label.text = '';
        this._mWeek.label.text = '';
        this._mSonnet.label.text = '';
        this._mMeta.label.text = this._errState === 'error'
            ? _('Is Claude Code installed and signed in?')
            : '';
    }

    // Freshness / status footer line for the popup.
    _metaText() {
        const parts = [];
        if (this._lastFetchMs)
            parts.push(_('updated %s ago').format(fmtDuration(Date.now() - this._lastFetchMs)));
        if (this._errState === 'expired')
            parts.push(_('token expired'));
        else if (Date.now() < this._backoffUntilMs)
            parts.push(_('rate-limited, backing off'));
        parts.push(_('source: Claude /usage'));
        return parts.join('  ·  ');
    }

    // Swap the single active level class on the track so CSS drives all colours.
    _setLevel(level) {
        for (const l of ['idle', 'normal', 'warning', 'critical', 'error'])
            this._track.remove_style_class_name(`level-${l}`);
        this._track.add_style_class_name(`level-${level}`);
    }

    destroy() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        super.destroy();
    }
});

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._indicator = new ClaudeIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        // null out everything so nothing survives a lock-screen disable cycle.
        this._indicator?.destroy();
        this._indicator = null;
    }
}
