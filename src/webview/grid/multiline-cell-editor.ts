import { state } from '../state';
import { updateButtons } from '../features/undo-redo';
import { fileWithOpenValue } from './builder';

// ── Cell editor: multi-line aware ────────────────────────────────────────────
// AG Grid's stock text editor is an <input>, which cannot hold a line break — so
// a cell could never be given one from the grid (issue #29), even though the
// parser and the writer have carried them all along (a quoted field may span
// lines per RFC 4180; see utils/csv.ts).
//
// This is a <textarea> that grows with its content and adds the two shortcuts
// people reach for: Alt+Enter (what Excel uses) and Shift+Enter. Plain Enter
// still commits, so nothing about single-line editing changes.
//
// Ctrl/Cmd+Enter used to insert a break here too. It inserts a row below the
// current one now (issue #36) — the job VS Code's own editor puts on that key,
// and the one thing a grid has that a text editor does not is rows. Alt+Enter
// is the break every spreadsheet agrees on, so the break kept a key people
// already know.
//
// It is a POPUP editor, not an inline one: an inline editor is clipped to the
// row height, which would hide the second line while it is being typed.
//
// The start value follows AG Grid's own SimpleCellEditor rules exactly, so
// typing over a cell, F2 and double-click behave as they did before:
//   Backspace / Delete start the edit → empty value
//   a printable key starts the edit   → that character replaces the value
//   anything else (Enter, dblclick)   → full value, selected (F2: caret at end)

// Widest the popup gets before it stops following the column, and the point at
// which the textarea stops growing and starts scrolling instead.
const MIN_WIDTH_PX = 220;
const MAX_ROWS     = 12;

// A <textarea> hands its value back with every line break normalised to LF, per
// the HTML spec. A cell that came out of the file as CRLF therefore turned into
// LF the moment it was edited, even when the edit never went near the break
// (issue #31), and saving wrote back a line nobody had touched. Whatever style
// the value carried into the editor is the style it carries out.
//
// A value with a lone CR or with CRLF and LF mixed has no one style to put
// back. Committed without a change it comes back exactly as it went in, so an
// editor opened and closed again writes nothing. Changed, it takes CRLF when
// it had any.
export function restoreLineBreaks(original: string, edited: string): string {
    if (edited === original.replace(/\r\n?/g, '\n')) return original;
    return original.includes('\r\n') ? edited.replace(/\r?\n/g, '\r\n') : edited;
}

// Which Enter combination puts a line break into the cell instead of reaching
// the grid. Kept out of the class so it can be asserted on without a DOM.
// Ctrl/Cmd+Enter is deliberately absent: keyboard.ts claims it for "insert a row
// below" (issue #36), and a key cannot mean two things at once.
export function isLineBreakKey(e: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
    if (e.key !== 'Enter') return false;
    if (e.ctrlKey || e.metaKey) return false;
    return e.altKey || e.shiftKey;
}

// ── Getting the focus back after a Tab ───────────────────────────────────────
// Once an edit has changed a value, AG Grid puts the browser focus back on the
// CELL a moment later (rowRenderer.restoreFocusedCell, which runs off a
// setTimeout). For AG Grid's own editors that is where the input sits, so it
// lands right. This one is a popup and lives OUTSIDE the cell, so the focus
// landed on the cell's bare div and every keystroke went nowhere. That is what
// Tab did: it moved on, opened the next cell for editing, and then nothing typed
// there ever arrived. Whenever the focus ends up on the cell this editor is open
// over, it belongs in the textarea.
//
// Kept pure so the rule can be asserted on without a DOM. `attached` is false
// once the editor has been closed and taken out of the page: the focus is on the
// cell for a good reason then (Enter, Escape, a click) and must be left alone.
export function shouldReclaimFocus(attached: boolean, active: unknown, eGridCell: unknown): boolean {
    return attached && eGridCell != null && active === eGridCell;
}

// ── The cell's own undo history ──────────────────────────────────────────────
// While a cell is open for editing, undo has to mean "take back what I am typing
// in here" and leave the editor open, the way a spreadsheet does. The browser's
// built-in textarea undo cannot carry that on its own: setting .value from code
// wipes its history, and this editor does exactly that when it inserts a line
// break, which is how Alt+Enter ended up not being undoable at all.
//
// So the editor keeps its own. Kept as plain functions over a plain object so the
// stepping rules can be asserted on without a DOM.
export type TextHistory = { entries: string[]; index: number };

export function newHistory(value: string): TextHistory {
    return { entries: [value], index: 0 };
}

function countBreaks(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++;
    return n;
}

// Where one undo step ends and the next begins. Word by word, which is what a
// browser's own text field does and what VS Code does: one step per word rather
// than one per letter (too slow to undo anything) or one for the whole edit (too
// blunt to take back a typo). A line break, a deletion and a paste each get a
// step of their own as well — Alt+Enter has to be undoable by itself, which is
// the whole reason this exists.
export function startsNewUndoStep(prev: string, next: string): boolean {
    if (next.length < prev.length) return true;                // deletion
    if (countBreaks(next) !== countBreaks(prev)) return true;  // line break added
    if (next.length - prev.length > 1) return true;            // paste, not typing
    // The space belongs to the word in front of it, so the step ends AFTER the
    // space: the first letter of the next word opens the next one.
    return /\s$/.test(prev);
}

// Takes a new value into the history. Anything that had been undone is dropped,
// the way redo works everywhere. The value the editor opened with is never
// overwritten, so the first thing typed always leaves a step to come back to.
export function recordHistory(h: TextHistory, next: string): void {
    const prev = h.entries[h.index];
    if (next === prev) return;
    h.entries.length = h.index + 1;
    if (h.index === 0 || startsNewUndoStep(prev, next)) {
        h.entries.push(next);
        h.index++;
    } else {
        h.entries[h.index] = next;
    }
}

// Moves one step back (-1) or forward (+1). Returns the value to show, or null
// when there is nothing in that direction.
export function stepHistory(h: TextHistory, delta: -1 | 1): string | null {
    const target = h.index + delta;
    if (target < 0 || target > h.entries.length - 1) return null;
    h.index = target;
    return h.entries[target];
}

// ── Telling the extension a value is being typed ─────────────────────────────
// A value typed into a cell reaches the file only when the cell is committed.
// Until then VS Code knew nothing of it. Ctrl+W or the tab's close button
// closed the tab without asking and the value was lost. Auto-save and Save All
// saved the file without it. So the editor says 'typing' on every change,
// which marks the tab unsaved. A save then asks for the value and gets the
// file with it in (flushOpenEditor in grid/builder.ts). The cell stays open.
// When the cell closes the extension is told with 'typingEnded'.
//
// Told only of the first change, VS Code took a backup or an auto-save about
// every second while the typing went on. Each had the grid write out the
// whole file, a pause on a large one. Told of every change, VS Code waits
// until the typing pauses, as it does for its own editor.
//
// Whether the extension was told about the editor that is open now. Kept here
// and not in the editor: the editor is gone by the time the grid reports it
// closed (editorClosed).
let typingReported = false;
// The text the last save took from the open editor, see flushOpenEditor.
let handedOver: string | null = null;

// The editor was closed, committed or not. Called once the grid has reported
// the value it committed, so the edit reaches the extension before this does.
// When a save took the file with the value in it and the cell was then left
// with Escape, the grid holds another text than the one the save took. The
// extension is given that text so it drops the value as well.
export function editorClosed(): void {
    stopSending();
    const handed = handedOver;
    handedOver = null;
    if (!typingReported) return;
    typingReported = false;
    vscodeApi.postMessage(handed !== null && handed !== state.rawCsvText
        ? { type: 'typingEnded', text: state.rawCsvText }
        : { type: 'typingEnded' });
}

// A save took `text` from the open editor. It is null when the value was the
// cell's. The tab is marked saved either way, so the next change of the value
// has to mark it unsaved again.
export function handOver(editor: MultilineCellEditor, text: string | null): void {
    if (text !== null) handedOver = text;
    editor.reportFrom(editor.getValue());
    stopSending();
}

// Whether a save took a text from the open editor.
export function handedOverBefore(): boolean {
    return handedOver !== null;
}

// ── Keeping another editor of the file up to date ───────────────────────────
// VS Code opens a second editor on the file for the modified side of a Source
// Control diff while the grid tab stays open. Closing the diff then does not
// ask to save. Neither Ctrl+W nor the close button takes the focus out of the
// page first. The value being typed in the diff was lost, while the grid tab
// went on showing the file unsaved and a save wrote it without the value. So
// while another editor shows the file (the extension says so), the extension
// is sent the file with the value in it once the typing pauses. A key with
// Ctrl or Cmd sends it at once, since it may be the one that closes the
// editor. The extension hands that text to the other editors when this one
// closes. Writing out a large file takes a moment, so a lone editor never
// does it.
const SEND_DELAY_MS = 300;
// A click on the diff's close button within that pause after the last key
// lost the whole value. A file of up to 1 MB of text is sent with every
// change instead, right after the key. At 0.9 MB each change reached the
// extension within 25 ms and no key was held up. A larger file keeps the
// pause.
const SEND_AT_ONCE_CHARS = 1024 * 1024;
let shared = false;
let sendTimer: ReturnType<typeof setTimeout> | null = null;

export function setShared(value: boolean): void {
    shared = value;
    if (!shared) stopSending();
    else if (typingReported) sendSoon();
}

// Right after the key rather than in it: a letter that opens the editor
// comes before the grid knows the editor, so the value could not be found.
function sendSoon(): void {
    if (sendTimer !== null) clearTimeout(sendTimer);
    sendTimer = setTimeout(sendNow, state.rawCsvText.length <= SEND_AT_ONCE_CHARS ? 0 : SEND_DELAY_MS);
}

// Sends what waits to be sent. Without a text when the value is the cell's
// own again.
function sendNow(): void {
    if (sendTimer === null) return;
    stopSending();
    const text = fileWithOpenValue();
    vscodeApi.postMessage(text === null ? { type: 'typedText' } : { type: 'typedText', text });
}

function stopSending(): void {
    if (sendTimer !== null) clearTimeout(sendTimer);
    sendTimer = null;
}

export class MultilineCellEditor {
    private eGui!: HTMLDivElement;
    private eTextArea!: HTMLTextAreaElement;
    private focusAfterAttached = false;
    private highlightAll = false;
    private originalValue = '';
    private history: TextHistory = newHistory('');
    private eGridCell: HTMLElement | null = null;
    // The value a change is measured against: the one the editor opened
    // with, the one of the last change told or the one the last save took
    // (handOver).
    private reported = '';

    init(params: any): void {
        const value = params.value == null ? '' : String(params.value);
        this.originalValue = value;

        let start = value;
        if (params.cellStartedEdit) {
            this.focusAfterAttached = true;
            const key: string | undefined = params.eventKey;
            if (key === 'Backspace' || key === 'Delete') {
                start = '';
            } else if (key && key.length === 1) {
                start = key;
            } else {
                this.highlightAll = key !== 'F2';
            }
        }

        this.eGui = document.createElement('div');
        this.eGui.className = 'csv-multiline-editor-wrap';
        // Follow the column so the editor lines up with the cell it covers, but
        // never get so narrow that a wrapped line is unreadable.
        const colWidth: number = params.column?.getActualWidth?.() ?? 0;
        this.eGui.style.width = Math.max(MIN_WIDTH_PX, colWidth) + 'px';

        this.eTextArea = document.createElement('textarea');
        this.eTextArea.className = 'csv-multiline-editor';
        this.eTextArea.rows = 1;
        this.eTextArea.spellcheck = false;
        this.eTextArea.value = start;
        this.history = newHistory(start);
        this.eGui.appendChild(this.eTextArea);

        this.eGridCell = params.eGridCell ?? null;

        this.eTextArea.addEventListener('keydown', this.onKeyDown);
        this.eTextArea.addEventListener('input', this.onInput);
        this.eTextArea.addEventListener('blur', this.onBlur);

        // A letter, Backspace or Delete opens the editor changed already.
        this.reportFrom(value);
    }

    // Tells the extension of every change of the value, the first one
    // measured from `from`, now or later.
    reportFrom(from: string): void {
        this.reported = from;
        this.reportChange();
    }

    private reportChange(): void {
        const value = this.getValue();
        if (value === this.reported) return;
        this.reported = value;
        typingReported = true;
        vscodeApi.postMessage({ type: 'typing' });
        if (shared) sendSoon();
    }

    getGui(): HTMLElement {
        return this.eGui;
    }

    afterGuiAttached(): void {
        this.autoGrow();
        updateButtons(); // this editor's history is empty, so both go grey
        if (!this.focusAfterAttached) return;
        this.eTextArea.focus();
        if (this.highlightAll) {
            this.eTextArea.select();
        } else {
            const end = this.eTextArea.value.length;
            this.eTextArea.setSelectionRange(end, end);
        }
    }

    // Deferred by a timeout on purpose: AG Grid's own restore runs off one too,
    // so answering synchronously here would just be overwritten by it.
    private onBlur = (): void => {
        setTimeout(() => {
            if (!shouldReclaimFocus(this.eTextArea.isConnected, document.activeElement, this.eGridCell)) return;
            this.eTextArea.focus();
        });
    };

    // Called when focus returns to a cell that is already editing (Tab-back).
    focusIn(): void {
        this.eTextArea.focus();
        this.eTextArea.select();
    }

    getValue(): string {
        return restoreLineBreaks(this.originalValue, this.eTextArea.value);
    }

    isPopup(): boolean {
        return true;
    }

    getPopupPosition(): string {
        return 'over';
    }

    private onKeyDown = (e: KeyboardEvent): void => {
        const key = e.key;

        // Ctrl+W may close the editor right after this (see sendNow).
        if (e.ctrlKey || e.metaKey) sendNow();

        // The key that finishes a VS Code key chord is VS Code's (keyboard.ts).
        if (e === state.chordKey) return;

        // The whole point of the feature. preventDefault as well as stopPropagation:
        // Shift+Enter would otherwise ALSO insert the browser's own line break on
        // top of ours. Ctrl/Cmd+Enter is not in here — it must reach the document
        // handler that inserts a row below (keyboard.ts).
        if (isLineBreakKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            this.insertNewline();
            return;
        }

        // Caret movement belongs to the textarea, not to the grid — the same set
        // AG Grid's own large-text editor keeps to itself. Enter, Escape and Tab
        // are deliberately NOT in here: they must reach the grid so committing,
        // cancelling and moving on keep working.
        if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'
            || key === 'Home' || key === 'End') {
            e.stopPropagation();
        }
    };

    // Called by the grid's undo/redo (features/undo-redo.ts) while this editor is
    // open. Reports whether there was a step to take, and never closes the editor:
    // the cell's text is what is being undone here, not the last grid action.
    undoText(): boolean {
        return this.applyHistory(-1);
    }

    redoText(): boolean {
        return this.applyHistory(1);
    }

    // What the toolbar's Undo and Redo buttons go by while this editor is open.
    // Without them the buttons kept reporting the GRID's stacks, so on a file with
    // nothing undone yet they sat greyed out while there was plenty to take back
    // inside the cell.
    canUndo(): boolean {
        return this.history.index > 0;
    }

    canRedo(): boolean {
        return this.history.index < this.history.entries.length - 1;
    }

    private applyHistory(delta: -1 | 1): boolean {
        const value = stepHistory(this.history, delta);
        if (value === null) return false;
        this.eTextArea.value = value;
        this.eTextArea.focus();
        this.eTextArea.setSelectionRange(value.length, value.length);
        this.autoGrow();
        updateButtons();
        this.reportChange();
        return true;
    }

    private onInput = (): void => {
        recordHistory(this.history, this.eTextArea.value);
        this.autoGrow();
        updateButtons();
        this.reportChange();
    };

    private insertNewline(): void {
        const ta    = this.eTextArea;
        const start = ta.selectionStart ?? ta.value.length;
        const end   = ta.selectionEnd   ?? start;
        ta.value = ta.value.slice(0, start) + '\n' + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 1;
        // Setting .value from code fires no input event, so the break has to be
        // taken into the history by hand or Ctrl+Z would step straight over it.
        recordHistory(this.history, ta.value);
        this.autoGrow();
        updateButtons();
        this.reportChange();
    }

    // Height follows the content. 'auto' first so the textarea can also SHRINK
    // again when lines are deleted — scrollHeight never reports less than the
    // current height. The cap is applied here rather than in CSS so the value is
    // derived from the live line-height, which the zoom steps change.
    private autoGrow = (): void => {
        const ta = this.eTextArea;
        ta.style.height = 'auto';
        const lineHeight = parseFloat(getComputedStyle(ta).lineHeight);
        const maxPx = isNaN(lineHeight) ? Infinity : lineHeight * MAX_ROWS;
        ta.style.height = Math.min(ta.scrollHeight, maxPx) + 'px';
    };
}
