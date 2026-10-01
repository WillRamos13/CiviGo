import type { Incidente } from './types';

export function isHistoricalAntecedent(incident: Incidente) {
    const source = incident.fuente?.trim().toUpperCase();
    return Boolean((incident.estado === 'RESUELTO' && incident.historico) || (source && source !== 'CIUDADANO'));
}

export function incidentSource(incident: Incidente) {
    const source = incident.fuente?.trim();
    if (!source) return null;
    return source.toUpperCase() === 'CIUDADANO' ? 'Reporte ciudadano' : source.replaceAll('_', ' ');
}
