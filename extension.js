/* Claude Usage Monitor — GNOME Shell 45+ (ESM) panel indicator.
 *
 * Renders the current 5-hour Claude Code "block" usage as a small progress
 * bar in the top panel. Data is pulled from the local `ccusage` CLI, which
 * aggregates ~/.claude session logs into rolling 5-hour blocks. We never talk
 * to the network ourselves — everything is read locally.
 */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// ----------------------------------------------------------------------------
// ccusage invocation
// ----------------------------------------------------------------------------

// GNOME Shell launches with a minimal PATH that excludes nvm/volta/bun shims,
// so `npx`/`ccusage` installed under a version manager are invisible unless we
// rebuild PATH ourselves. We glob the usual per-user node locations and prepend
// them. This is the single most common reason the extension "shows nothing".
function buildAugmentedPath() {
    const home = GLib.get_home_dir();
    const extra = [
        `${home}/.local/bin`,
        `${home}/bin`,
        `${home}/.bun/bin`,
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
    ];
    // Every installed nvm node version: ~/.nvm/versions/node/*/bin
    const nvmRoot = `${home}/.nvm/versions/node`;
    const dir = Gio.File.new_for_path(nvmRoot);
    try {
        const en = dir.enumerate_children('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let info;
        while ((info = en.next_file(null)) !== null) {
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                extra.unshift(`${nvmRoot}/${info.get_name()}/bin`);
        }
    } catch {
        // No nvm install — fine, the static entries above still apply.
    }
    const current = GLib.getenv('PATH') ?? '';
    return [...extra, current].filter(p => p).join(':');
}

// Resolve the argv to run. Honour an explicit user override, else prefer a
// plain `ccusage` on PATH, else fall back to `npx --yes ccusage`.
function resolveCcusageArgv(override, augmentedPath) {
    if (override && override.trim())
        return override.trim().split(/\s+/);
    if (GLib.find_program_in_path('ccusage'))
        return ['ccusage'];
    // find_program_in_path uses the *shell* PATH, not our augmented one, so
    // re-check the augmented dirs for a bare ccusage binary.
    for (const d of augmentedPath.split(':')) {
        if (d && GLib.file_test(`${d}/ccusage`, GLib.FileTest.IS_EXECUTABLE))
            return [`${d}/ccusage`];
    }
    return ['npx', '--yes', 'ccusage'];
}

// Run a command asynchronously and resolve its stdout. Rejects on non-zero exit
// or spawn failure. The cancellable lets disable() abort an in-flight call.
function runCommand(argv, augmentedPath, cancellable) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            launcher.setenv('PATH', augmentedPath, true);
            proc = launcher.spawnv(argv);
        } catch (e) {
            reject(e);
            return;
        }
        proc.communicate_utf8_async(null, cancellable, (p, res) => {
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                if (!p.get_successful())
                    reject(new Error(stderr?.trim() || 'ccusage exited non-zero'));
                else
                    resolve(stdout);
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ----------------------------------------------------------------------------
// Usage math
// ----------------------------------------------------------------------------

const METRIC_LABELS = {tokens: _('Tokens'), cost: _('Cost'), time: _('Time')};

function fmtTokens(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return `${n}`;
}

// Turn the raw `ccusage blocks --json` payload + settings into a flat view
// model the indicator can render. Returns null if there is no active block.
function computeUsage(payload, opts) {
    const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
    const active = blocks.find(b => b.isActive);
    if (!active)
        return null;

    // Past, real (non-gap, non-active) blocks define the "auto" ceiling.
    const past = blocks.filter(b => !b.isActive && !b.isGap);

    let percent, primary, limitStr;
    if (opts.metric === 'cost') {
        const limit = opts.costLimit > 0
            ? opts.costLimit
            : Math.max(0, ...past.map(b => b.costUSD ?? 0)) || (active.costUSD || 1);
        percent = (active.costUSD / limit) * 100;
        primary = `$${active.costUSD.toFixed(2)}`;
        limitStr = `$${limit.toFixed(2)}`;
    } else if (opts.metric === 'time') {
        const start = Date.parse(active.startTime);
        const end = Date.parse(active.endTime);
        const now = Date.now();
        percent = ((now - start) / (end - start)) * 100;
        const leftMin = Math.max(0, Math.round((end - now) / 60000));
        primary = `${leftMin}m left`;
        limitStr = '5h';
    } else {
        const limit = opts.tokenLimit > 0
            ? opts.tokenLimit
            : Math.max(0, ...past.map(b => b.totalTokens ?? 0)) || (active.totalTokens || 1);
        percent = (active.totalTokens / limit) * 100;
        primary = fmtTokens(active.totalTokens);
        limitStr = fmtTokens(limit);
    }

    percent = Math.max(0, percent);
    const resetMin = Math.max(0, Math.round((Date.parse(active.endTime) - Date.now()) / 60000));

    return {
        percent,
        primary,
        limitStr,
        costUSD: active.costUSD ?? 0,
        totalTokens: active.totalTokens ?? 0,
        resetMin,
        burnPerMin: active.burnRate?.tokensPerMinute ?? 0,
        projTokens: active.projection?.totalTokens ?? 0,
        projCost: active.projection?.totalCost ?? 0,
        models: active.models ?? [],
    };
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
        this._augmentedPath = buildAugmentedPath();
        this._timerId = null;
        this._cancellable = null;
        this._busy = false;

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
            text: '–',
            style_class: 'claude-usage-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._label);

        // The bar is a fixed-width track (background = "empty") with a fill
        // child whose width encodes the percentage. Colour comes from the
        // style class we toggle on the track (normal/warning/critical).
        this._track = new St.Bin({style_class: 'claude-usage-track', y_align: Clutter.ActorAlign.CENTER});
        this._fill = new St.Widget({style_class: 'claude-usage-fill', x_align: Clutter.ActorAlign.START});
        this._track.set_child(this._fill);
        box.add_child(this._track);

        this._buildMenu();
        this._applySizing();

        // React to settings without a full re-enable.
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'refresh-interval')
                this._restartTimer();
            else if (key === 'bar-width' || key === 'show-percentage')
                this._applySizing();
            this._refresh();
        });

        this._restartTimer();
        this._refresh(); // immediate first paint
    }

    _buildMenu() {
        // Info rows (non-reactive) updated on every refresh.
        this._mState = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._mTokens = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._mCost = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._mBurn = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._mReset = new PopupMenu.PopupMenuItem('', {reactive: false});
        for (const it of [this._mState, this._mTokens, this._mCost, this._mBurn, this._mReset])
            this.menu.addMenuItem(it);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refresh = new PopupMenu.PopupMenuItem(_('Refresh now'));
        refresh.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refresh);

        const prefs = new PopupMenu.PopupMenuItem(_('Settings…'));
        prefs.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(prefs);
    }

    _applySizing() {
        this._barWidth = this._settings.get_int('bar-width');
        this._track.set_width(this._barWidth);
        this._track.set_height(10);
        this._label.visible = this._settings.get_boolean('show-percentage');
    }

    _restartTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _refresh() {
        if (this._busy)
            return; // never overlap ccusage invocations
        this._busy = true;
        this._cancellable = new Gio.Cancellable();
        try {
            const argv = resolveCcusageArgv(
                this._settings.get_string('ccusage-command'), this._augmentedPath);
            const argvFull = [...argv, 'blocks', '--json'];
            const stdout = await runCommand(argvFull, this._augmentedPath, this._cancellable);
            const data = computeUsage(JSON.parse(stdout), {
                metric: this._settings.get_string('metric'),
                tokenLimit: Number(this._settings.get_value('token-limit').unpack()),
                costLimit: this._settings.get_double('cost-limit'),
            });
            this._render(data);
        } catch (e) {
            if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                this._renderError(e);
        } finally {
            this._busy = false;
        }
    }

    _render(data) {
        const warn = this._settings.get_int('warn-threshold');
        const crit = this._settings.get_int('critical-threshold');

        if (!data) { // no active block → idle
            this._setLevel('idle');
            this._label.text = '–';
            this._fill.set_width(0);
            this._warnIcon.visible = false;
            this._mState.label.text = _('No active session (last 5h idle)');
            this._mTokens.label.text = '';
            this._mCost.label.text = '';
            this._mBurn.label.text = '';
            this._mReset.label.text = '';
            return;
        }

        const pct = data.percent;
        const level = pct >= crit ? 'critical' : pct >= warn ? 'warning' : 'normal';
        this._setLevel(level);
        this._warnIcon.visible = pct >= crit;

        this._label.text = `${Math.round(pct)}%`;
        // Clamp the visual fill to the track; the % label still shows overflow.
        const fillW = Math.round(Math.min(1, pct / 100) * this._barWidth);
        this._fill.set_width(fillW);

        const metric = this._settings.get_string('metric');
        this._mState.label.text =
            `${METRIC_LABELS[metric] ?? metric}: ${data.primary} / ${data.limitStr}  (${Math.round(pct)}%)`;
        this._mTokens.label.text = _('Tokens this block: %s').format(fmtTokens(data.totalTokens));
        this._mCost.label.text = _('Cost this block: $%s').format(data.costUSD.toFixed(2));
        this._mBurn.label.text = _('Burn: %s tok/min  ·  proj $%s')
            .format(fmtTokens(Math.round(data.burnPerMin)), data.projCost.toFixed(2));
        this._mReset.label.text = _('Resets in %d min').format(data.resetMin);
    }

    _renderError(e) {
        this._setLevel('error');
        this._label.text = '!';
        this._fill.set_width(0);
        this._warnIcon.visible = true;
        this._mState.label.text = _('ccusage failed — is it installed?');
        this._mTokens.label.text = String(e?.message ?? e).slice(0, 120);
        this._mCost.label.text = _('Set a command in Settings if ccusage lives in a custom path.');
        this._mBurn.label.text = '';
        this._mReset.label.text = '';
    }

    // Swap the single active level class on the root so CSS drives all colours.
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
