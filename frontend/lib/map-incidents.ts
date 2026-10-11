import type { Incidente } from './types';
export type MapBounds = [number, number, number, number];
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
type Page = { items: Incidente[]; nextCursor: number | null };
export async function loadMapIncidents(bounds: MapBounds, request: (path: string) => Promise<Page>): Promise<Incidente[]> {
    const items = new Map<number, Incidente>();
    let cursor: number | null = null;
    do {
        const query = new URLSearchParams({ bbox: bounds.join(',') });
        if (cursor !== null) query.set('after', String(cursor));
        const page = await request(`/incidents?${query}`);
        for (const item of page.items) items.set(item.id, item);
        if (page.nextCursor !== null && (!Number.isSafeInteger(page.nextCursor) || page.nextCursor <= 0 || (cursor !== null && page.nextCursor >= cursor))) throw new Error('No se pudo completar la actualización del mapa.');
        cursor = page.nextCursor;
    } while (cursor !== null);
    return [...items.values()].sort((a, b) => b.id - a.id);
}
