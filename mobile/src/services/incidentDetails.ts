import { api, ApiError } from './api';
import { isPosition } from './navigation';
import type { Incidente } from '../types';

export async function getIncidentDetail(id: number, signal?: AbortSignal): Promise<Incidente> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError('El incidente indicado no es válido.', 400);
  const item = await api<Incidente>(`/incidents/${id}`, { signal });
  if (!item || Array.isArray(item) || item.id !== id || typeof item.tipo !== 'string' ||
      typeof item.estado !== 'string' || !isPosition(item) ||
      (item.descripcion != null && typeof item.descripcion !== 'string') ||
      (item.adjuntos != null && (!Array.isArray(item.adjuntos) || !item.adjuntos.every(attachment =>
        attachment && typeof attachment.id === 'string' && typeof attachment.mimeType === 'string' &&
        (attachment.url === null || typeof attachment.url === 'string'))))) {
    throw new ApiError('No se recibió un detalle válido del incidente.', 502, 'INVALID_RESPONSE');
  }
  return item;
}
