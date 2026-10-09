import type { Posicion } from './types';
import { isPosition } from './route-cache';

export type PlaceResult = Posicion & { nombre: string; descripcion?: string };
export type PlaceSearchState = { query: string; status: 'idle' | 'loading' | 'ready' | 'error'; results: PlaceResult[]; error: string };

export function normalizePlaceQuery(value: string) {
    return value.trim().replace(/\s+/g, ' ');
}

export function parsePlaceResults(value: unknown): PlaceResult[] {
    if (!Array.isArray(value)) throw new Error('El buscador devolvió datos incompletos. Inténtalo de nuevo.');
    const seen = new Set<string>();
    const results: PlaceResult[] = [];
    for (const item of value) {
        if (!isPosition(item)) continue;
        const record = item as Posicion & { nombre?: unknown; descripcion?: unknown };
        if (typeof record.nombre !== 'string') continue;
        const nombre = normalizePlaceQuery(record.nombre);
        if (!nombre) continue;
        const key = `${nombre.toLocaleLowerCase('es')}:${item.latitud.toFixed(6)}:${item.longitud.toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ nombre, latitud: item.latitud, longitud: item.longitud,
            ...(typeof record.descripcion === 'string' && record.descripcion.trim() ? { descripcion: record.descripcion.trim() } : {}) });
        if (results.length === 12) break;
    }
    return results;
}

export function startPlaceSearch(
    query: string,
    request: (query: string, signal: AbortSignal) => Promise<unknown>,
    update: (state: PlaceSearchState) => void,
    delay = 350,
) {
    const text = normalizePlaceQuery(query);
    if (text.length < 3) return () => {};
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
        if (!active) return;
        update({ query: text, status: 'loading', results: [], error: '' });
        Promise.resolve().then(() => {
            if (!active) return;
            return request(text, controller.signal);
        }).then(value => {
            if (!active || controller.signal.aborted) return;
            update({ query: text, status: 'ready', results: parsePlaceResults(value), error: '' });
        }).catch(error => {
            if (!active || controller.signal.aborted) return;
            update({ query: text, status: 'error', results: [], error: error instanceof Error ? error.message : 'No se pudo buscar este lugar. Inténtalo de nuevo.' });
        });
    }, delay);
    return () => {
        active = false;
        clearTimeout(timer);
        controller.abort();
    };
}
