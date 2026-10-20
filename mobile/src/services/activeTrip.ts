import { isPosition, isRoute } from './navigation';
import type { Ruta } from '../types';

export interface TripStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface ActiveTrip {
  version: 1;
  ownerId: number;
  startedAt: number;
  savedAt: number;
  covered: number;
  route: Ruta;
}
export const ACTIVE_TRIP_MAX_AGE = 12 * 60 * 60 * 1000;
const MAX_TRIP_BYTES = 750_000;
const key = (owner: number) => `civigo:active-trip:v1:user:${owner}`;
const queues = new WeakMap<TripStorage, Promise<void>>();

function serial<T>(storage: TripStorage, task: () => Promise<T>): Promise<T> {
  const result = (queues.get(storage) ?? Promise.resolve()).then(task);
  queues.set(storage, result.then(() => {}, () => {}));
  return result;
}
export function clearActiveTrip(owner: number | null | undefined, storage: TripStorage): Promise<void> {
  return Number.isSafeInteger(owner) && Number(owner) > 0
    ? serial(storage, () => storage.remove(key(owner!))) : Promise.resolve();
}
export function parseActiveTrip(raw: string | null, owner: number, now = Date.now()): ActiveTrip | null {
  if (!raw || raw.length > MAX_TRIP_BYTES) return null;
  try {
    const trip = JSON.parse(raw) as ActiveTrip;
    if (trip.version !== 1 || trip.ownerId !== owner || !Number.isSafeInteger(owner) || owner < 1 ||
      !Number.isFinite(trip.savedAt) || now - trip.savedAt > ACTIVE_TRIP_MAX_AGE || trip.savedAt > now + 5000 ||
      !Number.isFinite(trip.startedAt) || trip.startedAt > trip.savedAt || trip.startedAt < 0 ||
      !isRoute(trip.route) || !isPosition(trip.route.destino) ||
      !['walking', 'cycling', 'driving'].includes(trip.route.modo || '') ||
      !Number.isFinite(trip.covered) || trip.covered < 0 || trip.covered > trip.route.distancia) return null;
    return trip;
  } catch { return null; }
}

function tripRoute(route: Ruta): Ruta {
  // Preserve the route contract, not extra transport fields, sensor metadata or tokens.
  const safe: Record<string, unknown> = {};
  for (const field of ['id', 'nombre', 'tipo', 'distancia', 'duracion', 'geometria', 'puntosRiesgo', 'nivelRiesgo',
    'advertencias', 'pasos', 'modo', 'destinoNombre', 'criterios', 'riesgoConocido', 'llegadaEstimada',
    'copiaGuardada', 'trafico', 'actualizadoEn', 'fuente', 'paradaIntermedia'] as const) {
    if (field in route) safe[field] = (route as unknown as Record<string, unknown>)[field];
  }
  if (isPosition(route.origen)) safe.origen = { latitud: route.origen.latitud, longitud: route.origen.longitud };
  if (isPosition(route.destino)) safe.destino = { latitud: route.destino.latitud, longitud: route.destino.longitud };
  return safe as unknown as Ruta;
}

/** No credentials or live GPS fixes are persisted. A fresh fix is required on return. */
export class ActiveTripController {
  private owner: number | null = null;
  private revision = 0;
  constructor(private storage: TripStorage) {}
  setOwner(owner: number | null) {
    const next = Number.isSafeInteger(owner) && Number(owner) > 0 ? owner : null;
    if (next !== this.owner) { this.owner = next; this.revision++; }
  }
  load(now = Date.now()): Promise<ActiveTrip | null> {
    const owner = this.owner, revision = this.revision;
    return serial(this.storage, async () => {
      if (owner === null || owner !== this.owner || revision !== this.revision) return null;
      const raw = await this.storage.get(key(owner));
      if (owner !== this.owner || revision !== this.revision) return null;
      const trip = parseActiveTrip(raw, owner, now);
      if (raw && !trip) await this.storage.remove(key(owner));
      return owner === this.owner && revision === this.revision ? trip : null;
    });
  }
  save(route: Ruta, covered = 0, startedAt = Date.now(), now = Date.now()): Promise<boolean> {
    const owner = this.owner, revision = this.revision;
    if (owner === null) return Promise.resolve(false);
    const raw = JSON.stringify({ version: 1, ownerId: owner, startedAt, savedAt: now,
      covered: Math.max(0, Math.min(route.distancia, covered)), route: tripRoute(route) });
    if (!parseActiveTrip(raw, owner, now)) return Promise.reject(new Error('No se pudo guardar el recorrido para recuperarlo.'));
    return serial(this.storage, async () => {
      if (owner !== this.owner || revision !== this.revision) return false;
      await this.storage.set(key(owner), raw);
      return owner === this.owner && revision === this.revision;
    });
  }
  clear(owner = this.owner): Promise<void> {
    if (owner === this.owner) this.revision++;
    if (owner === null) return Promise.resolve();
    return clearActiveTrip(owner, this.storage);
  }
}
