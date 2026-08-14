// ── Cell editor: multi-line aware ────────────────────────────────────────────
// AG Grid's stock text editor is an <input>, which cannot hold a line break — so
// a cell could never be given one from the grid (issue #29), even though the
// parser and the writer have carried them all along (a quoted field may span
// lines per RFC 4180; see utils/csv.ts).
//
// This is a <textarea> that grows with its content and adds the three shortcuts
// people reach for: Alt+Enter (what Excel uses), Shift+Enter and Ctrl/Cmd+Enter.
// Plain Enter still commits, so nothing about single-line editing changes.
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

export class MultilineCellEditor {
    private eGui!: HTMLDivElement;
    private eTextArea!: HTMLTextAreaElement;
    private focusAfterAttached = false;
    private highlightAll = false;

    init(params: any): void {
        const value = params.value == null ? '' : String(params.value);

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
        this.eGui.appendChild(this.eTextArea);

        this.eTextArea.addEventListener('keydown', this.onKeyDown);
        this.eTextArea.addEventListener('input', this.autoGrow);
    }

    getGui(): HTMLElement {
        return this.eGui;
    }

    afterGuiAttached(): void {
        this.autoGrow();
        if (!this.focusAfterAttached) return;
        this.eTextArea.focus();
        if (this.highlightAll) {
            this.eTextArea.select();
        } else {
            const end = this.eTextArea.value.length;
            this.eTextArea.setSelectionRange(end, end);
        }
    }

    // Called when focus returns to a cell that is already editing (Tab-back).
    focusIn(): void {
        this.eTextArea.focus();
        this.eTextArea.select();
    }

    getValue(): string {
        return this.eTextArea.value;
    }

    isPopup(): boolean {
        return true;
    }

    getPopupPosition(): string {
        return 'over';
    }

    private onKeyDown = (e: KeyboardEvent): void => {
        const key = e.key;

        // The whole point of the feature. preventDefault as well as stopPropagation:
        // Ctrl+Enter and Shift+Enter would otherwise ALSO insert the browser's own
        // line break on top of ours.
        if (key === 'Enter' && (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey)) {
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

    private insertNewline(): void {
        const ta    = this.eTextArea;
        const start = ta.selectionStart ?? ta.value.length;
        const end   = ta.selectionEnd   ?? start;
        ta.value = ta.value.slice(0, start) + '\n' + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 1;
        this.autoGrow();
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
