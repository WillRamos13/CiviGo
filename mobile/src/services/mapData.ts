import { api, distance } from './api';
import { isPosition } from './navigation';
import type { Incidente, Posicion } from '../types';

export type MapBounds = [west: number, south: number, east: number, north: number];
export const DEFAULT_ICA_BOUNDS: MapBounds = [-76.3, -15, -75.1, -13.3];

export function expandMapBounds(current: MapBounds, viewport: MapBounds): MapBounds {
  const expanded: MapBounds = [Math.min(current[0], viewport[0]), Math.min(current[1], viewport[1]), Math.max(current[2], viewport[2]), Math.max(current[3], viewport[3])];
  return expanded.every((value, index) => value === current[index]) ? current : expanded;
}

/** DOM markers follow the visible area; the full snapshot still drives the heatmap. */
export function isInMarkerViewport(position: Posicion, bounds: MapBounds): boolean {
  if (!isPosition(position)) return false;
  const [west, south, east, north] = bounds;
  const width = east >= west ? east - west : east - west + 360;
  const height = north - south;
  const bufferedWest = west - width * 0.25;
  const longitudeOffset = ((position.longitud - bufferedWest) % 360 + 360) % 360;
  return position.latitud >= Math.max(-90, south - height * 0.25) &&
    position.latitud <= Math.min(90, north + height * 0.25) &&
    (width * 1.5 >= 360 || longitudeOffset <= width * 1.5);
}

function validateIncidents(value: unknown): Incidente[] {
  if (!Array.isArray(value) || !value.every((incident) => incident && Number.isSafeInteger(incident.id) && incident.id > 0 && typeof incident.tipo === 'string' && isPosition(incident))) {
    throw new Error('No se recibieron alertas válidas del mapa.');
  }
  return value;
}

/** Fetch the whole viewport; publish only a complete snapshot, never a partial page. */
export async function getMapIncidents(bounds: MapBounds, signal?: AbortSignal): Promise<Incidente[]> {
  const incidents = new Map<number, Incidente>();
  let after: number | null = null;
  do {
    const query = new URLSearchParams({ bbox: bounds.join(',') });
    if (after !== null) query.set('after', String(after));
    const page: { items: Incidente[]; nextCursor: number | null } = await api(`/incidents?${query}`, { signal });
    const items = validateIncidents(page?.items);
    const cursor = page.nextCursor;
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor <= 0 || (after !== null && cursor >= after))) {
      throw new Error('La paginación de alertas está incompleta. Reintenta cargar el mapa.');
    }
    items.forEach((incident) => incidents.set(incident.id, incident));
    after = cursor;
  } while (after !== null);
  return [...incidents.values()];
}

export async function getRecentIncidents(position: Posicion, signal?: AbortSignal): Promise<Incidente[]> {
  const query = new URLSearchParams({ latitud: String(position.latitud), longitud: String(position.longitud) });
  const items = validateIncidents(await api(`/incidents?${query}`, { signal }));
  return items.filter((incident) => distance(position, incident) <= 1000).slice(0, 10);
}
