import type { Incidente } from './types';

export function incidentEvaluationLabel(incident: Pick<Incidente, 'evaluacion' | 'porEvaluar'>) {
    if (incident.porEvaluar || incident.evaluacion === 'PENDIENTE') return 'Pendiente de revisión';
    if (incident.evaluacion === 'IA') return 'Evaluación preliminar por IA';
    if (incident.evaluacion === 'AGENTE') return 'Evaluación por un agente';
    return 'Evaluación sin registrar';
}
