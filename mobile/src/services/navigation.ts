import { api, post, del } from './api';
import type { Posicion, Ruta, RouteCriterion, RouteStep } from '../types';

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

export type { RoadRisk, RoadGeometry } from './roadMap';
import type { RoadRisk, RoadGeometry } from './roadMap';

export const NavigationService = {
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
    return res.rutas || [];
  },

  async recordHistory(
    ruta: Ruta,
    origen?: Posicion,
    destino?: Posicion,
    modo?: string
  ): Promise<void> {
    await post('/navigation/history', { ruta, origen, destino, modo });
  },

  async getFavorites(signal?: AbortSignal): Promise<SavedRoute[]> {
    return api<SavedRoute[]>('/navigation/favorites', { signal });
  },

  async addFavorite(
    nombre: string,
    tags: string[],
    ruta: Ruta,
    origen: Posicion,
    destino: Posicion,
    modo: string
  ): Promise<SavedRoute> {
    return post<SavedRoute>('/navigation/favorites', {
      nombre,
      tags,
      ruta,
      origen,
      destino,
      modo,
    });
  },

  async removeFavorite(id: number): Promise<void> {
    await del(`/navigation/favorites/${id}`);
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
    typeof r.id === 'string' &&
    typeof r.distancia === 'number' &&
    typeof r.duracion === 'number' &&
    r.geometria?.type === 'LineString' &&
    Array.isArray(r.geometria.coordinates)
  );
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hours} h ${remMin} min`;
}
