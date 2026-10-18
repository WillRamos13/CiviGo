import { api, post, del, distance } from './api';
import type { Posicion, Ruta, LocationFix, Usuario } from '../types';

export interface SavedRoute {
  id: number;
  nombre?: string;
  modo: string;
  origen: Posicion;
  destino: Posicion;
  datos: Ruta;
  creadoEn: string;
  tags?: string[];
}

export interface RouteStats {
  recorridos: number;
  metros: number;
  segundos: number;
  porModo: Record<string, number>;
}

export interface NavigationPlace extends Posicion {
  nombre: string;
  descripcion?: string;
  fuente?: string;
}

export type { RoadRisk, RoadGeometry } from './roadMap';
import type { RoadRisk, RoadGeometry } from './roadMap';

const favoritesListeners = new Set<() => void>();

/** Keep retained map and profile views in sync after a confirmed mutation. */
export function onFavoritesChanged(listener: () => void): () => void {
  favoritesListeners.add(listener);
  return () => { favoritesListeners.delete(listener); };
}

function notifyFavoritesChanged() {
  for (const listener of favoritesListeners) listener();
}

export const NavigationService = {
  async searchPlaces(query: string, signal?: AbortSignal): Promise<NavigationPlace[]> {
    const cleaned = query.trim();
    if (cleaned.length < 3) return [];
    if (cleaned.length > 160) throw new Error('La búsqueda admite hasta 160 caracteres.');
    const places = await api<NavigationPlace[]>(`/navigation/places?${new URLSearchParams({ q: cleaned })}`, { signal });
    if (!Array.isArray(places) || !places.every((place) => place && typeof place.nombre === 'string' && place.nombre.trim() &&
      (place.descripcion === undefined || typeof place.descripcion === 'string') &&
      (place.fuente === undefined || typeof place.fuente === 'string') && isPosition(place))) {
      throw new Error('La búsqueda devolvió lugares incompletos. Prueba con otro nombre o coordenadas.');
    }
    return places;
  },
  async planRoute(
    origen: Posicion,
    destino: Posicion,
    modo: 'walking' | 'cycling' | 'driving' = 'walking',
    signal?: AbortSignal
  ): Promise<Ruta[]> {
    const res = await post<{ rutas: Ruta[] }>(
      '/navigation/plan',
      { origen, destino, modo },
      { signal }
    );
    if (!Array.isArray(res?.rutas) || !res.rutas.every(isRoute)) {
      throw new Error('El servidor devolvió una ruta incompleta. Inténtalo de nuevo.');
    }
    return res.rutas.map((route) => ({ ...route, advertencias: route.advertencias || [] }));
  },

  async recordHistory(
    ruta: Ruta,
    origen?: Posicion,
    destino?: Posicion,
    modo?: string,
    signal?: AbortSignal
  ): Promise<void> {
    await post('/navigation/history', { ruta, origen, destino, modo }, { signal });
  },

  async getFavorites(signal?: AbortSignal): Promise<SavedRoute[]> {
    const favorites = await api<SavedRoute[]>('/navigation/favorites', { signal });
    if (!Array.isArray(favorites) || !favorites.every((favorite) => favorite && Number.isSafeInteger(favorite.id) && favorite.id > 0 && isPosition(favorite.origen) && isPosition(favorite.destino) && isRoute(favorite.datos))) {
      throw new Error('No se pudieron leer las rutas favoritas. Inténtalo de nuevo.');
    }
    return favorites;
  },

  async addFavorite(
    nombre: string,
    tags: string[],
    ruta: Ruta,
    origen: Posicion,
    destino: Posicion,
    modo: string
  ): Promise<SavedRoute> {
    const favorite = await post<SavedRoute>('/navigation/favorites', {
      nombre,
      tags,
      ruta,
      origen,
      destino,
      modo,
    });
    notifyFavoritesChanged();
    return favorite;
  },

  async removeFavorite(id: number, signal?: AbortSignal): Promise<void> {
    await del(`/navigation/favorites/${id}`, { signal });
    notifyFavoritesChanged();
  },

  async getStats(signal?: AbortSignal): Promise<RouteStats | null> {
    try {
      return await api<RouteStats>('/navigation/stats', { signal });
    } catch {
      return null;
    }
  },

  async getRoadRisks(signal?: AbortSignal): Promise<RoadRisk> {
    return api<RoadRisk>('/navigation/roads/risk', { signal });
  },

  async getRoadGeometry(version: string, signal?: AbortSignal): Promise<RoadGeometry> {
    return api<RoadGeometry>(
      `/navigation/roads/geometry?v=${encodeURIComponent(version)}`,
      { signal, cache: 'force-cache' }
    );
  },
};

export function isRoute(value: unknown): value is Ruta {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Ruta>;
  return (
    typeof r.id === 'string' && r.id.length > 0 &&
    Number.isFinite(r.distancia) && r.distancia! >= 0 &&
    Number.isFinite(r.duracion) && r.duracion! >= 0 &&
    r.geometria?.type === 'LineString' &&
    Array.isArray(r.geometria.coordinates) &&
    r.geometria.coordinates.length >= 2 &&
    r.geometria.coordinates.every((point) => Array.isArray(point) &&
      isPosition({ longitud: point[0], latitud: point[1] })) &&
    (r.pasos === undefined || (Array.isArray(r.pasos) && r.pasos.every((step) => step &&
      typeof step.instruccion === 'string' && Number.isFinite(step.distanciaAcumulada) &&
      step.distanciaAcumulada >= 0 && Number.isFinite(step.distancia) && step.distancia >= 0 &&
      Number.isFinite(step.duracion) && step.duracion >= 0 && Number.isFinite(step.duracionAcumulada) && step.duracionAcumulada >= 0))) &&
    (r.advertencias === undefined || (Array.isArray(r.advertencias) && r.advertencias.every((warning) =>
      typeof warning === 'string' || (!!warning && typeof warning.mensaje === 'string'))))
  );
}

export function isPosition(value: Posicion | null | undefined): value is Posicion {
  return !!value && Number.isFinite(value.latitud) && Number.isFinite(value.longitud) &&
    Math.abs(value.latitud) <= 90 && Math.abs(value.longitud) <= 180;
}

export function isNavigationAccountCurrent(owner: number | undefined, user: Pick<Usuario, 'id' | 'bloqueado'> | null): boolean {
  return owner !== undefined && user?.id === owner && user.bloqueado !== true;
}

export function isUsableFix(position: LocationFix | null | undefined, now = Date.now()): position is LocationFix {
  return isPosition(position) &&
    (position.accuracy === undefined || (Number.isFinite(position.accuracy) && position.accuracy >= 0 && position.accuracy <= 100)) &&
    (position.timestamp === undefined || (Number.isFinite(position.timestamp) && now - position.timestamp <= 30000 && position.timestamp <= now + 5000));
}

/** Require sustained, precise GPS evidence; never loop requests on a single fix. */
export class AutoRerouteGuard {
  private startedAt: number | null = null;
  private samples = 0;
  private lastFix = -Infinity;
  private lastAttempt = -Infinity;

  reset() { this.startedAt = null; this.samples = 0; this.lastFix = -Infinity; }
  recordAttempt(now = Date.now()) { this.lastAttempt = now; }

  shouldReroute(position: LocationFix | null | undefined, offRoute: boolean, now = Date.now(), allowed = true): boolean {
    if (!offRoute || !isUsableFix(position, now) || position.accuracy === undefined || position.accuracy > 30 || position.timestamp === undefined) {
      this.reset(); return false;
    }
    if (position.timestamp <= this.lastFix) return false;
    this.lastFix = position.timestamp;
    if (this.startedAt === null) this.startedAt = now;
    this.samples += 1;
    if (!allowed || this.samples < 3 || now - this.startedAt < 8000 || now - this.lastAttempt < 20000) return false;
    this.recordAttempt(now);
    return true;
  }
}

/** Project a GPS fix onto the route; remote/poor fixes never advance guidance. */
export function getRouteProgress(route: Ruta, position?: LocationFix | null, now = Date.now()) {
  const coordinates = route.geometria.coordinates;
  let traveled = 0;
  let total = 0;
  let nearest = Infinity;
  if (isUsableFix(position, now)) {
    const scaleX = 111320 * Math.cos(position.latitud * Math.PI / 180);
    const scaleY = 111320;
    for (let i = 1; i < coordinates.length; i++) {
      const a = coordinates[i - 1], b = coordinates[i];
      const ax = (a[0] - position.longitud) * scaleX, ay = (a[1] - position.latitud) * scaleY;
      const dx = (b[0] - a[0]) * scaleX, dy = (b[1] - a[1]) * scaleY;
      const length = distance({ longitud: a[0], latitud: a[1] }, { longitud: b[0], latitud: b[1] });
      const ratio = dx * dx + dy * dy > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
      const offset = Math.hypot(ax + ratio * dx, ay + ratio * dy);
      if (offset < nearest) { nearest = offset; traveled = total + length * ratio; }
      total += length;
    }
  }
  const offRoute = Number.isFinite(nearest) && nearest > Math.max(50, (position?.accuracy || 0) * 1.5);
  const hasFix = isUsableFix(position, now);
  const covered = hasFix && !offRoute && total > 0 ? Math.min(route.distancia, traveled / total * route.distancia) : 0;
  const steps = (route.pasos || []).filter((step) => Number.isFinite(step.distanciaAcumulada) && typeof step.instruccion === 'string');
  let index = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].distanciaAcumulada <= covered + 3) index = i;
  }
  const step = steps[index];
  const nextStep = steps[index + 1];
  const remainingDistance = Math.max(0, route.distancia - covered);
  let elapsed = route.distancia > 0 ? covered / route.distancia * route.duracion : 0;
  if (step && Number.isFinite(step.duracionAcumulada) && Number.isFinite(step.duracion) && step.distancia > 0) {
    elapsed = step.duracionAcumulada + Math.max(0, Math.min(1, (covered - step.distanciaAcumulada) / step.distancia)) * step.duracion;
  }
  return { hasFix, offRoute, step, nextStep, remainingDistance,
    remainingDuration: Math.max(0, route.duracion - elapsed),
    distanceToNext: nextStep ? Math.max(0, nextStep.distanciaAcumulada - covered) : remainingDistance,
    arrived: hasFix && !offRoute && remainingDistance <= 20 &&
      !!position && distance(position, { longitud: coordinates[coordinates.length - 1][0], latitud: coordinates[coordinates.length - 1][1] }) <= 20 };
}

export function routeWarnings(route: Ruta): string[] {
  const warnings = (route.advertencias || []).map((warning) => typeof warning === 'string' ? warning : warning?.mensaje).filter(Boolean);
  if (route.riesgoConocido !== true) warnings.push('Riesgo sin verificar: faltan datos actuales para esta ruta.');
  if (route.trafico?.disponible !== true) warnings.push(route.modo && route.modo !== 'driving' && route.trafico?.motivo
    ? route.trafico.motivo : 'Sin tráfico en vivo. El tiempo de llegada es una estimación.');
  if (route.copiaGuardada) warnings.push('Copia guardada: las condiciones pueden haber cambiado.');
  return [...new Set(warnings)];
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hours} h ${remMin} min`;
}
