// The switches in the settings menu (features/settings-menu.ts) and what each
// one starts as. Shared by both sides: the extension reads the remembered
// values out of VS Code globalState (csvGridEditor.<key>) and hands them to the
// webview, and it only accepts writes for the keys listed here. Nothing in this
// file touches the DOM, so the extension can load it too.
//
// The defaults are what the grid did before the menu existed, so an update
// changes nothing for anyone until they open the menu. The new switches start
// off for the same reason.

export const SETTING_DEFAULTS = {
    colorMode:      false,
    rowHighlight:   true,
    typeBadges:     true,
    alignNumbers:   false,
    markEmpty:      false,
    boolCheckboxes: false,
    trimDisplay:    true,
    enterMovesDown: true,
};

export type Settings   = { [K in keyof typeof SETTING_DEFAULTS]: boolean };
export type SettingKey = keyof Settings;

export function isSettingKey(key: unknown): key is SettingKey {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key);
}

// A full set of settings from whatever arrived: every known key, each a real
// boolean, the default wherever the input has nothing usable. Unknown keys are
// dropped rather than carried along.
export function readSettings(raw: unknown): Settings {
    const out: Settings = { ...SETTING_DEFAULTS };
    if (raw && typeof raw === 'object') {
        for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
            const v = (raw as Record<string, unknown>)[key];
            if (typeof v === 'boolean') out[key] = v;
        }
    }
    return out;
}
