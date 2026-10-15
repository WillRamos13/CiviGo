import type { Incidente, Posicion } from '../types';
import type { OperationToken } from './operationScope';

export interface ProximityActionPorts {
  locate(): Promise<Posicion>;
  send(path: string, body: Posicion, options: { signal: AbortSignal }): Promise<unknown>;
}

export function resolutionMessage(result: unknown): string {
  return result && typeof result === 'object' && 'estado' in result && result.estado === 'RESUELTO'
    ? '¡Incidente marcado como resuelto!'
    : 'Tu aviso de resolución quedó registrado. El incidente sigue activo hasta completar la revisión comunitaria.';
}

export function incidentAfterParticipation(incident: Incidente, result: unknown): Incidente | null {
  if (!result || typeof result !== 'object') return null;
  const value = result as Record<string, unknown>;
  if (!Number.isSafeInteger(value.id) || value.id !== incident.id || typeof value.estado !== 'string'
    || !['ACTIVO', 'VALIDADO', 'PENDIENTE', 'RESUELTO'].includes(value.estado)) return null;
  const updated: Incidente = { ...incident, estado: value.estado };
  for (const counter of ['confirmaciones', 'resoluciones'] as const) {
    if (Number.isSafeInteger(value[counter]) && Number(value[counter]) >= 0) updated[counter] = Number(value[counter]);
  }
  if (typeof value.validacion === 'number' && Number.isFinite(value.validacion) && value.validacion >= 0 && value.validacion <= 1) {
    updated.validacion = value.validacion;
  }
  if (typeof value.chatAbierto === 'boolean') updated.chatAbierto = value.chatAbierto;
  if (value.estado === 'RESUELTO') updated.chatAbierto = false;
  return updated;
}

export async function submitProximityAction(
  id: number,
  action: 'confirmar' | 'resolver',
  operation: OperationToken,
  ports: ProximityActionPorts,
): Promise<unknown> {
  operation.assertActive();
  const position = await ports.locate();
  operation.assertActive();
  if (!Number.isFinite(position.latitud) || !Number.isFinite(position.longitud)) throw new Error('No se obtuvo una ubicación GPS válida.');
  const result = await ports.send(`/incidents/${id}/${action}`, {
    latitud: position.latitud, longitud: position.longitud,
  }, { signal: operation.signal });
  operation.assertActive();
  return result;
}
