import type { Posicion, Ruta } from './types';
import type { BrowserStorage } from './session';
export type RouteMode = 'walking' | 'cycling' | 'driving';
export type CachedRoute = { ruta: Ruta; fecha: string; origen?: Posicion | null; destino?: Posicion | null; modo?: RouteMode };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function isPosition(value: unknown): value is Posicion {
    return object(value) && finite(value.latitud) && finite(value.longitud) && Math.abs(value.latitud) <= 90 && Math.abs(value.longitud) <= 180;
}
export function routeMode(value: unknown): RouteMode { return value === 'cycling' || value === 'driving' ? value : 'walking'; }
export function isRoute(value: unknown): value is Ruta {
    if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.nombre !== 'string' || !['corta', 'rapida', 'segura', 'equilibrada'].includes(String(value.tipo))) return false;
    if (!finite(value.distancia) || value.distancia < 0 || !finite(value.duracion) || value.duracion < 0 || !finite(value.puntosRiesgo) || value.puntosRiesgo < 0 || !finite(value.nivelRiesgo) || !Number.isInteger(value.nivelRiesgo) || value.nivelRiesgo < 0 || value.nivelRiesgo > 5) return false;
    if (!object(value.geometria) || value.geometria.type !== 'LineString' || !Array.isArray(value.geometria.coordinates) || value.geometria.coordinates.length < 2 || value.geometria.coordinates.length > 100000) return false;
    if (!value.geometria.coordinates.every(c => Array.isArray(c) && finite(c[0]) && finite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)) return false;
    if (value.pasos !== undefined && (!Array.isArray(value.pasos) || !value.pasos.every(s => object(s) && typeof s.id === 'string' && typeof s.instruccion === 'string' && finite(s.distanciaAcumulada) && s.distanciaAcumulada >= 0 && finite(s.indiceInicio) && s.indiceInicio >= 0 && finite(s.indiceFin) && s.indiceFin >= s.indiceInicio))) return false;
    return Array.isArray(value.advertencias) && value.advertencias.every(w => typeof w === 'string' || (object(w) && typeof w.mensaje === 'string'));
}
export function parseRouteCache(raw: string | null, limit = 20): CachedRoute[] {
    if (!raw || raw.length > 4 * 1024 * 1024) return [];
    try {
        const data: unknown = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        return data.filter((entry): entry is Record<string, unknown> => object(entry) && isRoute(entry.ruta) && typeof entry.fecha === 'string' && Number.isFinite(new Date(entry.fecha).getTime())).slice(0, limit).map(entry => ({
            ruta: entry.ruta as unknown as Ruta,
            fecha: entry.fecha as string,
            origen: isPosition(entry.origen) ? entry.origen : null,
            destino: isPosition(entry.destino) ? entry.destino : null,
            modo: routeMode(entry.modo),
        }));
    } catch { return []; }
}
export function readRouteCache(storage: Pick<BrowserStorage, 'getItem'>, accountId: number, premium: boolean) {
    try { return parseRouteCache(storage.getItem(`civigo:rutas:${accountId}`), premium ? 20 : 1); } catch { return []; }
}
