import { distance } from './api';
import type { Incidente, Posicion } from '../types';

export function incidentRisk(incident: Incidente): number | null {
  const risk = incident.nivelRiesgo;
  return typeof risk === 'number' && Number.isInteger(risk) && risk >= 0 && risk <= 5 ? risk : null;
}

export function incidentDate(incident: Incidente): string | null {
  for (const value of [incident.fechaEvento, incident.fechaPublicacion, incident.fechaCreacion, incident.creadoEn, incident.fecha]) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

export function incidentState(incident: Incidente): string | null {
  if (typeof incident.estado !== 'string' || !incident.estado.trim()) return null;
  const labels: Record<string, string> = { ACTIVO: 'Activo', VALIDADO: 'Validado', PENDIENTE: 'Pendiente', RESUELTO: 'Resuelto', PUBLICADO: 'Publicado', EN_VERIFICACION: 'En verificación' };
  return labels[incident.estado] ?? incident.estado.trim().slice(0, 80);
}

/** Preserve server publication order, but never show more than ten within 1 km. */
export function visibleNearbyIncidents(incidents: readonly Incidente[], position?: Posicion | null): Incidente[] {
  const seen = new Set<number>();
  return incidents.filter(incident => {
    if (!Number.isSafeInteger(incident.id) || incident.id <= 0 || seen.has(incident.id)) return false;
    if (position && (!Number.isFinite(distance(position, incident)) || distance(position, incident) > 1000)) return false;
    seen.add(incident.id); return true;
  }).slice(0, 10);
}
