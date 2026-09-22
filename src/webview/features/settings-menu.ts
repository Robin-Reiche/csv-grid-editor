import { state } from '../state';
import { closeAllPopups } from './popups';
import { applyBoolCheckboxes } from './bool-checkbox';

/**
 * Settings menu (issue #41).
 *
 * The small display switches that are a matter of taste live here, behind the
 * gear in the toolbar, instead of in the VS Code settings, where they would be
 * findable only by people who already know they exist. Each one is a checkbox
 * with a line saying what it does, and each is remembered per user via VS Code
 * globalState exactly like zoom, color mode and text wrapping.
 *
 * Deliberately a list: the point of a menu over a toolbar button is that the
 * next small switch costs one entry and no toolbar space.
 *
 * Toolbar toggles that predate this menu (color mode, wrap text) keep their own
 * buttons. Moving them in here would tidy the toolbar but take away a one-click
 * control people already use, so that is a separate decision.
 */

type SettingItem = {
    id: string;
    label: string;
    hint: string;
    isOn: () => boolean;
    apply: (on: boolean) => void;
};

const ITEMS: SettingItem[] = [
    {
        id: 'bool-checkboxes',
        label: 'Checkboxes for true/false columns',
        hint: 'Draws a box instead of the word. The file keeps its own spelling.',
        isOn: () => state.boolCheckboxes,
        apply: (on) => {
            state.boolCheckboxes = on;
            applyBoolCheckboxes();
            vscodeApi.postMessage({ type: 'boolCheckboxesChanged', boolCheckboxes: on });
        },
    },
];

// The gear carries a marker while anything in here is switched on, so a grid
// that does not look like the default says why without being opened.
function updateButton(): void {
    const anyOn = ITEMS.some(item => item.isOn());
    document.getElementById('btn-settings')?.classList.toggle('btn-active', anyOn);
}

function buildList(): void {
    const list = document.getElementById('settings-list');
    if (!list) return;
    list.innerHTML = '';

    for (const item of ITEMS) {
        const row = document.createElement('label');
        row.className = 'settings-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = item.isOn();
        cb.addEventListener('change', () => {
            item.apply(cb.checked);
            updateButton();
        });

        const text = document.createElement('span');
        text.className = 'settings-item-text';

        const label = document.createElement('span');
        label.className = 'settings-item-label';
        label.textContent = item.label;

        const hint = document.createElement('span');
        hint.className = 'settings-item-hint';
        hint.textContent = item.hint;

        text.appendChild(label);
        text.appendChild(hint);
        row.appendChild(cb);
        row.appendChild(text);
        list.appendChild(row);
    }
}

function openMenu(): void {
    const pop = document.getElementById('settings-popover');
    const btn = document.getElementById('btn-settings');
    if (!pop || !btn) return;
    buildList();
    pop.classList.remove('hidden');
    const r  = btn.getBoundingClientRect();
    const pw = pop.offsetWidth || 260;
    // The gear sits at the right edge, so the menu hangs from its right side and
    // is clamped to the window rather than running off it.
    pop.style.top  = (r.bottom + 4) + 'px';
    pop.style.left = Math.max(4, Math.min(r.right - pw, window.innerWidth - pw - 4)) + 'px';
}

function closeMenu(): void {
    document.getElementById('settings-popover')?.classList.add('hidden');
}

export function setupSettingsMenu(): void {
    state.boolCheckboxes = !!INITIAL_BOOL_CHECKBOXES;
    updateButton();

    const btn = document.getElementById('btn-settings');
    btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const pop = document.getElementById('settings-popover');
        const wasOpen = pop != null && !pop.classList.contains('hidden');
        closeAllPopups();
        if (!wasOpen) openMenu();
    });

    document.addEventListener('mousedown', (evt) => {
        const pop = document.getElementById('settings-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        const t = evt.target as Node;
        if (pop.contains(t)) return;
        if (btn?.contains(t)) return; // toggle button handles itself
        closeMenu();
    }, true);
}
