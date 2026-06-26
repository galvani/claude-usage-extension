/* Preferences UI (GTK4 / libadwaita) for Claude Usage Monitor. */

import Gio from 'gi://Gio';
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
        display.add(this._spin(settings, 'bar-width', _('Bar width (px)'), null, 16, 200, 2));
        display.add(this._switch(settings, 'show-percentage', _('Show percentage label'), null));

        // --- Pace thresholds ----------------------------------------------
        const thresh = new Adw.PreferencesGroup({
            title: _('Pace thresholds'),
            description: _('Colour by projected end-of-window usage (current 5-hour utilisation ÷ fraction of the window elapsed). 100% = on track to land exactly at the limit; 150% = on track for 1.5× the limit. Amber at the warning level, red at the critical level.'),
        });
        page.add(thresh);
        thresh.add(this._spin(settings, 'warn-threshold', _('Warning pace (%)'), null, 50, 500, 5));
        thresh.add(this._spin(settings, 'critical-threshold', _('Critical pace (%)'), null, 50, 500, 5));

        // --- Data source ---------------------------------------------------
        const src = new Adw.PreferencesGroup({
            title: _('Data source'),
            description: _('Usage is read from Anthropic’s own endpoint (the same numbers as Claude Code’s /usage), using the OAuth token Claude Code stores locally. The endpoint is aggressively rate-limited, so keep the fetch interval high; the panel shows the last value between fetches.'),
        });
        page.add(src);
        src.add(this._spin(settings, 'usage-poll-interval', _('Usage fetch interval (s)'), null, 60, 3600, 30));
        src.add(this._spin(settings, 'refresh-interval', _('Panel update interval (s)'), null, 5, 3600, 5));
    }

    _spin(settings, key, title, subtitle, lower, upper, step) {
        const row = new Adw.SpinRow({
            title, subtitle,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, value: settings.get_int(key)}),
            digits: 0,
        });
        row.connect('notify::value', r => settings.set_int(key, r.get_value()));
        return row;
    }

    _switch(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title, subtitle, active: settings.get_boolean(key)});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
