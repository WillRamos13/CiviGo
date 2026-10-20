import { distance } from './api';
import type { PlaceResult as NavigationPlace } from './place-search';
import type { Posicion, Ruta } from './types';

export const PLACE_CATEGORIES = [
  { id: 'food', label: 'Alimentos', query: 'restaurantes', icon: 'food' },
  { id: 'fuel', label: 'Combustible', query: 'grifos', icon: 'fuel' },
  { id: 'parking', label: 'Estacionamiento', query: 'estacionamientos', icon: 'parking' },
  { id: 'pharmacy', label: 'Farmacias', query: 'farmacias', icon: 'pharmacy' },
  { id: 'hospital', label: 'Hospitales', query: 'hospitales', icon: 'hospital' },
  { id: 'shops', label: 'Tiendas', query: 'tiendas', icon: 'shops' },
] as const;

export function cleanPlace(value: unknown): NavigationPlace | null {
  if (!value || typeof value !== 'object') return null;
  const place = value as Partial<NavigationPlace>;
  if (typeof place.nombre !== 'string' || !place.nombre.trim() || place.nombre.length > 240 ||
      typeof place.latitud !== 'number' || !Number.isFinite(place.latitud) || Math.abs(place.latitud) > 90 ||
      typeof place.longitud !== 'number' || !Number.isFinite(place.longitud) || Math.abs(place.longitud) > 180) return null;
  return { nombre: place.nombre.trim(), latitud: place.latitud, longitud: place.longitud,
    ...(typeof place.descripcion === 'string' && place.descripcion.trim() ? { descripcion: place.descripcion.trim().slice(0, 500) } : {}),
    ...(typeof place.fuente === 'string' && place.fuente.trim() ? { fuente: place.fuente.trim().slice(0, 80) } : {}),
  };
}

export function placeKey(place: NavigationPlace): string {
  return `${place.latitud.toFixed(6)}:${place.longitud.toFixed(6)}:${place.nombre.trim().toLocaleLowerCase('es')}`;
}

/** Geometric proximity only: this is never a driving distance or a detour time. */
export function distanceToRoute(place: Posicion, route: Pick<Ruta, 'geometria'>): number | null {
  const points = route?.geometria?.coordinates;
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(place.latitud) || !Number.isFinite(place.longitud)) return null;
  let nearest = Infinity;
  const scaleX = 111320 * Math.cos(place.latitud * Math.PI / 180), scaleY = 111320;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!Array.isArray(a) || !Array.isArray(b) || ![a[0], a[1], b[0], b[1]].every(Number.isFinite)) return null;
    const ax = (a[0] - place.longitud) * scaleX, ay = (a[1] - place.latitud) * scaleY;
    const dx = (b[0] - a[0]) * scaleX, dy = (b[1] - a[1]) * scaleY;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return Number.isFinite(nearest) ? nearest : null;
}

export function placesNearRoute(places: readonly NavigationPlace[], route: Pick<Ruta, 'geometria'>, radius = 500): NavigationPlace[] {
  if (!Number.isFinite(radius) || radius < 0 || radius > 5000) return [];
  return places.map(place => ({ place, offset: distanceToRoute(place, route) }))
    .filter((item): item is { place: NavigationPlace; offset: number } => item.offset !== null && item.offset <= radius)
    .sort((a, b) => a.offset - b.offset).map(item => item.place);
}

export function placeMapUrl(place: NavigationPlace): string {
  const point = cleanPlace(place);
  if (!point) throw new Error('El lugar no tiene una ubicación válida.');
  return `https://www.openstreetmap.org/?mlat=${point.latitud}&mlon=${point.longitud}#map=18/${point.latitud}/${point.longitud}`;
}

export function placeShareText(place: NavigationPlace): string {
  const point = cleanPlace(place);
  if (!point) throw new Error('El lugar no tiene una ubicación válida.');
  return [point.nombre, point.descripcion, placeMapUrl(point)].filter(Boolean).join('\n');
}

export function straightLineDistance(origin: Posicion | null | undefined, place: NavigationPlace): number | null {
  if (!origin || ![origin.latitud, origin.longitud].every(Number.isFinite)) return null;
  const meters = distance(origin, place);
  return Number.isFinite(meters) ? meters : null;
}
