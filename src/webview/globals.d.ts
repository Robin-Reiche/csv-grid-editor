declare const vscodeApi: { postMessage(msg: unknown): void };
declare const IS_PREVIEW: boolean;
declare const PREVIEW_MODE: string;
declare const TOTAL_LINE_COUNT: number;
declare const DELIMITER: string;
declare const FILENAME: string;
declare const IS_CHUNKED: boolean;
declare const INITIAL_ZOOM_INDEX: number;
declare const INITIAL_COLOR_MODE: boolean;
declare const INITIAL_WRAP_TEXT: boolean;
declare const INITIAL_PROFILE_LAYOUT: { dock: string; width: number; height: number };

declare const agGrid: {
    createGrid(container: HTMLElement, options: unknown): any;
};
