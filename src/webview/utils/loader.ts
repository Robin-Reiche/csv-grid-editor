export function showLoader(label?: string): void {
    const el = document.getElementById('loading-label');
    if (el) el.textContent = label ?? 'Loading\u2026';
    document.getElementById('loading-overlay')?.classList.remove('hidden');
}

export function hideLoader(): void {
    document.getElementById('loading-overlay')?.classList.add('hidden');
}
