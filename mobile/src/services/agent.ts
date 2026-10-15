import { api, post } from './api';
import type { Usuario } from '../types';

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
    evidenciaPrivada?: boolean;
    fechaCreacion: string;
    usuario?: { nickname?: string };
    adjuntos?: { id: string; url: string | null; privado: boolean; mimeType: string }[];
  }[];
  flags?: AgentFlag[];
}

export interface AgentFlag {
  id: number;
  tipo: string;
  motivo: string;
  estado: string;
  creadoEn: string;
}

export interface AgentMessage {
  id: number;
  mensaje: string;
  creadoEn: string;
  retirado: boolean;
  usuario?: { nickname?: string };
}

export interface ReviewActionPayload {
  accion: 'VALIDAR' | 'GRAVEDAD' | 'FALSO' | 'RESOLVER' | 'REABRIR';
  motivo: string;
  nivelRiesgo?: number;
}

function validId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('El identificador no es válido.');
}

function reviewReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 5 || reason.length > 2000) throw new Error('El motivo debe contener entre 5 y 2000 caracteres.');
  return reason;
}

function checkGravity(value: number | undefined): void {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 5) {
    throw new Error('Asigna una gravedad entre 1 y 5.');
  }
}

export interface AgentIncidentPage {
  total: number;
  items: IncidentReviewSummary[];
}

export function normalizeAgentIncidents(value: unknown): AgentIncidentPage {
  if (Array.isArray(value)) return { total: value.length, items: value };
  if (value && typeof value === 'object' && 'items' in value && Array.isArray(value.items)) {
    const total = 'total' in value && typeof value.total === 'number' && Number.isFinite(value.total)
      ? value.total
      : value.items.length;
    return { total, items: value.items };
  }
  throw new Error('La respuesta de la cola de incidentes no es válida.');
}

export const AgentService = {
  async getIncidents(params: {
    distrito?: string;
    estado?: string;
    pagina?: number;
  } = {}): Promise<AgentIncidentPage> {
    const query = new URLSearchParams();
    if (params.distrito) query.set('distrito', params.distrito);
    if (params.estado) query.set('estado', params.estado);
    if (params.pagina) query.set('page', String(params.pagina));
    const value = await api<unknown>(`/admin/incidents?${query.toString()}`);
    return normalizeAgentIncidents(value);
  },

  async applyIncidentReview(id: number, payload: ReviewActionPayload, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    validId(id);
    if (payload.accion === 'VALIDAR' || payload.accion === 'GRAVEDAD') checkGravity(payload.nivelRiesgo);
    return post(`/admin/incidents/${id}/review`, { ...payload, motivo: reviewReason(payload.motivo) }, options);
  },

  async applyReportReview(
    reportId: number,
    payload: { accion: 'VALIDAR' | 'FALSO'; motivo: string; nivelRiesgo?: number },
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    validId(reportId);
    if (payload.accion === 'VALIDAR') checkGravity(payload.nivelRiesgo);
    return post(`/admin/reports/${reportId}/review`, { ...payload, motivo: reviewReason(payload.motivo) }, options);
  },

  async classifyIncident(id: number, payload: { tipoId: number; motivo: string }, options: { signal?: AbortSignal } = {}): Promise<unknown> {
    validId(id);
    validId(payload.tipoId);
    return post(`/admin/incidents/${id}/classify`, { ...payload, motivo: reviewReason(payload.motivo) }, options);
  },

  async reviewFlag(id: number, flagId: number, motivo: string, options: { signal?: AbortSignal } = {}): Promise<AgentFlag> {
    validId(id);
    validId(flagId);
    return post(`/admin/incidents/${id}/flags/${flagId}/review`, { motivo: reviewReason(motivo) }, options);
  },

  async getMessages(id: number): Promise<AgentMessage[]> {
    validId(id);
    return api<AgentMessage[]>(`/admin/incidents/${id}/messages`);
  },

  async moderateMessage(id: number, messageId: number, payload: { accion: 'RETIRAR' | 'RESTAURAR'; motivo: string }, options: { signal?: AbortSignal } = {}): Promise<Pick<AgentMessage, 'id' | 'mensaje' | 'retirado'>> {
    validId(id);
    validId(messageId);
    return post(`/admin/incidents/${id}/messages/${messageId}/moderate`, { ...payload, motivo: reviewReason(payload.motivo) }, options);
  },
};
