/** Provider durations are seconds; round once before splitting hours/minutes. */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    const hours = Math.floor(minutes / 60), remaining = minutes % 60;
    return hours ? `${hours} h${remaining ? ` ${remaining} min` : ''}` : `${minutes} min`;
}
