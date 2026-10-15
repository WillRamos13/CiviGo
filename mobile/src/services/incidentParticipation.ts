import type { Posicion } from '../types';
import type { OperationToken } from './operationScope';

export interface ProximityActionPorts {
  locate(): Promise<Posicion>;
  send(path: string, body: Posicion, options: { signal: AbortSignal }): Promise<unknown>;
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
