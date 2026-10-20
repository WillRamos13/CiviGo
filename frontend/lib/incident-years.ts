type IncidentDate = { fechaEvento?: string | null; fechaCreacion?: string | null };
export type IncidentYears = string[] | null;
export type IncidentYearControl = { options: string[]; selected: IncidentYears; onChange: (value: IncidentYears) => void };
const yearFormatter = new Intl.DateTimeFormat('en', {year: 'numeric', timeZone: 'America/Lima'});
export function incidentYear(incident: IncidentDate): string {
    const value = incident.fechaEvento || incident.fechaCreacion;
    if (!value) return 'sin-fecha';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parsed = new Date(value + 'T12:00:00Z');
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value.slice(0, 4) : 'sin-fecha';
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? yearFormatter.format(date) : 'sin-fecha';
}
export function incidentYearOptions(incidents: IncidentDate[], selected: IncidentYears = null): string[] {
    return [...new Set([...incidents.map(incidentYear), ...(selected ?? [])])].sort((a,b) => a === 'sin-fecha' ? 1 : b === 'sin-fecha' ? -1 : Number(b) - Number(a));
}
export function filterIncidentsByYears<T extends IncidentDate>(incidents: T[], selected: IncidentYears): T[] {
    if (selected === null) return incidents;
    const chosen = new Set(selected);
    return incidents.filter(incident => chosen.has(incidentYear(incident)));
}
export function toggleIncidentYear(selected: IncidentYears, year: string, options: string[]): string[] {
    const chosen = new Set(selected ?? options);
    if (chosen.has(year)) chosen.delete(year); else chosen.add(year);
    return [...chosen];
}
