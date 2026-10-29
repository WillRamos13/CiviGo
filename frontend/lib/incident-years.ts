type IncidentDate = { fechaEvento?: string | null; fechaCreacion?: string | null };
export const LAST_YEAR = 'ultimos-12-meses';
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
    return [...new Set([...incidents.map(incidentYear), ...(selected ?? []).filter(year=>year!==LAST_YEAR)])].sort((a,b) => a === 'sin-fecha' ? 1 : b === 'sin-fecha' ? -1 : Number(b) - Number(a));
}
export function filterIncidentsByYears<T extends IncidentDate>(incidents: T[], selected: IncidentYears): T[] {
    if (selected === null) return incidents;
    if (selected.includes(LAST_YEAR)) {
        const now = new Date(), cutoff = new Date(now); cutoff.setUTCFullYear(now.getUTCFullYear()-1);
        return incidents.filter(item=>{const date=new Date(item.fechaEvento||item.fechaCreacion||'');return Number.isFinite(date.getTime())&&date>=cutoff&&date<=now;});
    }
    const chosen = new Set(selected);
    return incidents.filter(incident => chosen.has(incidentYear(incident)));
}
export function toggleIncidentYear(selected: IncidentYears, year: string, options: string[]): string[] {
    const chosen = new Set(selected?.includes(LAST_YEAR) ? [] : selected ?? options);
    if (chosen.has(year)) chosen.delete(year); else chosen.add(year);
    return [...chosen];
}
