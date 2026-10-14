import type { Incidente } from './types';
export type MapBounds = [number, number, number, number];
export const ICA_MAP_BOUNDS: MapBounds = [-76.3, -15, -75.1, -13.3];
export function normalizeMapBounds(bounds: MapBounds): MapBounds {
    const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
    if (!bounds.every(Number.isFinite)) throw new Error('Ubicación del mapa inválida.');
    // Round outwards so even a close street view keeps a nonempty query area.
    const south = Math.min(89.999, clamp(Math.floor(bounds[1] * 1000) / 1000, 90));
    const north = clamp(Math.ceil(bounds[3] * 1000) / 1000, 90);
    // A repeated world / antimeridian view needs both sides of the longitude range.
    const wrapped = bounds[0] < -180 || bounds[2] > 180 || bounds[0] > bounds[2];
    const west = wrapped ? -180 : Math.min(179.999, Math.floor(bounds[0] * 1000) / 1000);
    const east = wrapped ? 180 : Math.ceil(bounds[2] * 1000) / 1000;
    return [west, south, Math.max(east, west + .001), Math.max(north, south + .001)];
}

// Keep the province and every already visited area in the next complete
// snapshot. Panning inside this envelope neither drops markers nor interrupts
// an in-flight multi-page provincial request.
export function expandMapBounds(current: MapBounds, next: MapBounds): MapBounds {
    const rounded = normalizeMapBounds(next);
    const expanded: MapBounds = [Math.min(current[0], rounded[0]), Math.min(current[1], rounded[1]), Math.max(current[2], rounded[2]), Math.max(current[3], rounded[3])];
    return expanded.every((coordinate, index) => coordinate === current[index]) ? current : expanded;
}

export function mapQueryBounds(coverage: MapBounds, route: readonly (readonly number[])[] = []): MapBounds {
    let area = coverage;
    for (const point of route) {
        if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) continue;
        area = expandMapBounds(area, [point[0] - .002, point[1] - .002, point[0] + .002, point[1] + .002]);
    }
    return area;
}

// The paginated map snapshot is authoritative inside its confirmed coverage.
// A stale nearby list must not restore a removed incident or overwrite a newer
// severity. It can still supply a GPS area outside the map's loaded coverage.
export function mergeMapIncidents(items: Incidente[], nearby: Incidente[], confirmed: MapBounds | null): Incidente[] {
    const merged = new Map(items.map(item => [item.id, item]));
    for (const item of nearby) {
        const covered = confirmed && item.longitud >= confirmed[0] && item.longitud <= confirmed[2] && item.latitud >= confirmed[1] && item.latitud <= confirmed[3];
        if (!merged.has(item.id) && !covered) merged.set(item.id, item);
    }
    return [...merged.values()];
}
type Page = { items: Incidente[]; nextCursor: number | null };
export async function loadMapIncidents(bounds: MapBounds, request: (path: string) => Promise<Page>, signal?: AbortSignal): Promise<Incidente[]> {
    const items = new Map<number, Incidente>();
    let cursor: number | null = null;
    do {
        signal?.throwIfAborted();
        const query = new URLSearchParams({ bbox: bounds.join(',') });
        if (cursor !== null) query.set('after', String(cursor));
        const page = await request(`/incidents?${query}`);
        signal?.throwIfAborted();
        for (const item of page.items) items.set(item.id, item);
        if (page.nextCursor !== null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= 0 || (cursor !== null && page.nextCursor >= cursor))) throw new Error('No se pudo completar la actualización del mapa.');
        cursor = page.nextCursor;
    } while (cursor !== null);
    return [...items.values()].sort((a, b) => b.id - a.id);
}
