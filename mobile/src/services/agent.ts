import { api, post } from './api';
import type { Usuario, Incidente } from '../types';

export type AgentPermission =
  | 'consultar'
  | 'validar'
  | 'gravedad'
  | 'clasificar'
  | 'falsedad'
  | 'avisos'
  | 'resolver'
  | 'reabrir'
  | 'evidencia'
  | 'moderar';

const LEGACY_REVIEW = ['consultar', 'validar', 'gravedad', 'clasificar', 'falsedad', 'avisos'];

export function hasAgentPermission(user: Usuario | null | undefined, permission: string): boolean {
  if (!user || user.bloqueado) return false;
  const role = user.rol?.toUpperCase();
  // En CiviGo Mobile, el panel operativo de campo está reservado exclusivamente para AGENTE
  if (role !== 'AGENTE') return false;

  const grants = Array.isArray(user.permisos) ? user.permisos : [];
  return (
    grants.includes(permission) ||
    (grants.includes('revisar') && LEGACY_REVIEW.includes(permission)) ||
    (permission === 'consultar' && grants.some((g) => [...LEGACY_REVIEW, 'resolver', 'reabrir', 'evidencia', 'moderar'].includes(g)))
  );
}

export interface IncidentReviewSummary {
  id: number;
  tipo: string;
  tipoNombre?: string;
  tipoSlug?: string;
  descripcion: string;
  distrito?: string | null;
  latitud: number;
  longitud: number;
  estado: string;
  nivelRiesgo: number | null;
  gravedad?: number | null;
  individual: boolean;
  publicado: boolean;
  validacion: number;
  fechaCreacion: string;
  totalReportes: number;
  aportesPendientes?: number;
  evaluacion?: string;
  reportes?: {
    id: number;
    descripcion: string;
    estado: string;
    fechaCreacion: string;
    usuario?: { nickname?: string };
    adjuntos?: { id: string; url: string | null; privado: boolean; mimeType: string }[];
  }[];
}

export interface ReviewActionPayload {
  accion: 'VALIDAR' | 'GRAVEDAD' | 'CLASIFICAR' | 'FALSO' | 'RESOLVER' | 'REABRIR' | 'RETIRAR_PUNTOS';
  motivo: string;
  gravedad?: number;
  tipoId?: number;
}

export const AgentService = {
  async getIncidents(params: {
    distrito?: string;
    estado?: string;
    pagina?: number;
  } = {}): Promise<{ total: number; incidentes: IncidentReviewSummary[] }> {
    const query = new URLSearchParams();
    if (params.distrito) query.set('distrito', params.distrito);
    if (params.estado) query.set('estado', params.estado);
    if (params.pagina) query.set('pagina', String(params.pagina));
    return api<{ total: number; incidentes: IncidentReviewSummary[] }>(
      `/admin/incidents?${query.toString()}`
    );
  },

  async getIncidentDetail(id: number): Promise<IncidentReviewSummary> {
    return api<IncidentReviewSummary>(`/admin/incidents/${id}`);
  },

  async applyIncidentReview(id: number, payload: ReviewActionPayload): Promise<unknown> {
    return post(`/admin/incidents/${id}/review`, payload);
  },

  async applyReportReview(
    reportId: number,
    payload: { accion: string; motivo: string }
  ): Promise<unknown> {
    return post(`/admin/reports/${reportId}/review`, payload);
  },
};
