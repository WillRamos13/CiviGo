import type { Incidente, Reporte } from './types';

export function incidentEvaluationLabel(incident: Pick<Incidente, 'evaluacion' | 'porEvaluar'>) {
    if (incident.porEvaluar || incident.evaluacion === 'PENDIENTE') return 'Pendiente de revisión';
    if (incident.evaluacion === 'IA') return 'Evaluación preliminar por IA';
    if (incident.evaluacion === 'AGENTE') return 'Evaluación por un agente';
    return 'Evaluación sin registrar';
}

export function reportPublicationState(report: Pick<Reporte, 'estado'>, incident: Pick<Incidente, 'publicado' | 'porEvaluar' | 'evaluacion'>) {
    if (report.estado === 'EN_REVISION') return 'review';
    if (!incident.publicado) return 'pending';
    if (incident.porEvaluar || incident.evaluacion === 'PENDIENTE') return 'published-pending';
    return 'published';
}

export function isHistoricalAntecedent(incident: Incidente) {
    const source = incident.fuente?.trim().toUpperCase();
    return Boolean((incident.estado === 'RESUELTO' && incident.historico) || (source && source !== 'CIUDADANO'));
}

export function incidentSource(incident: Incidente) {
    const source = incident.fuente?.trim();
    if (!source) return null;
    return source.toUpperCase() === 'CIUDADANO' ? 'Reporte ciudadano' : source.replaceAll('_', ' ');
}
