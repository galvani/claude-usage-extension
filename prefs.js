/* Preferences UI (GTK4 / libadwaita) for Claude Usage Monitor. */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeUsagePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Display -------------------------------------------------------
        const display = new Adw.PreferencesGroup({title: _('Display')});
        page.add(display);

        const metricRow = new Adw.ComboRow({
            title: _('Progress metric'),
            subtitle: _('What the bar fills against'),
            model: new Gtk.StringList({strings: [_('Tokens'), _('Cost (USD)'), _('Time in block')]}),
        });
        const metricKeys = ['tokens', 'cost', 'time'];
        metricRow.selected = Math.max(0, metricKeys.indexOf(settings.get_string('metric')));
        metricRow.connect('notify::selected', r => settings.set_string('metric', metricKeys[r.selected]));
        display.add(metricRow);

        display.add(this._spin(settings, 'bar-width', _('Bar width (px)'), null, 16, 200, 2));
        display.add(this._switch(settings, 'show-percentage', _('Show percentage label'), null));

        // --- Thresholds ----------------------------------------------------
        const thresh = new Adw.PreferencesGroup({
            title: _('Thresholds'),
            description: _('Colour turns amber at the warning level and red (with a warning icon) at the critical level.'),
        });
        page.add(thresh);
        thresh.add(this._spin(settings, 'warn-threshold', _('Warning (%)'), null, 1, 100, 1));
        thresh.add(this._spin(settings, 'critical-threshold', _('Critical (%)'), null, 1, 100, 1));

        // --- Limits --------------------------------------------------------
        const limits = new Adw.PreferencesGroup({
            title: _('Limits'),
            description: _('0 = auto: use your largest past 5-hour block as 100%.'),
        });
        page.add(limits);
        limits.add(this._spin(settings, 'token-limit', _('Token limit'), _('Tokens that count as 100%'),
            0, 100000000000, 1000000, true));
        limits.add(this._spin(settings, 'cost-limit', _('Cost limit (USD)'), _('Cost that counts as 100%'),
            0, 100000, 5, false, true));

        // --- Data source ---------------------------------------------------
        const src = new Adw.PreferencesGroup({title: _('Data source')});
        page.add(src);
        src.add(this._spin(settings, 'refresh-interval', _('Refresh interval (s)'), null, 5, 3600, 5));

        const cmdRow = new Adw.EntryRow({title: _('ccusage command (blank = auto)')});
        cmdRow.text = settings.get_string('ccusage-command');
        cmdRow.connect('notify::text', r => settings.set_string('ccusage-command', r.text));
        src.add(cmdRow);
    }

    // SpinRow helper. `big` uses the 64-bit setter; `dbl` uses the double setter.
    _spin(settings, key, title, subtitle, lower, upper, step, big = false, dbl = false) {
        const value = dbl ? settings.get_double(key)
            : big ? Number(settings.get_value(key).unpack())
            : settings.get_int(key);
        const row = new Adw.SpinRow({
            title, subtitle,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, value}),
            digits: dbl ? 2 : 0,
        });
        row.connect('notify::value', r => {
            const v = r.get_value();
            if (dbl) settings.set_double(key, v);
            else if (big) settings.set_value(key, new GLib.Variant('x', v));
            else settings.set_int(key, v);
        });
        return row;
    }

    _switch(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle, active: settings.get_boolean(key)});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
