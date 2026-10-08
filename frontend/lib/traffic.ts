import type { Ruta } from './types';

export interface ExternalTrafficIncident {
    id: string; externoId: string; fuente: 'TOMTOM'; tipo: string; titulo: string; descripcion: string;
    geometria: GeoJSON.Point | GeoJSON.LineString; latitud: number; longitud: number; inicio: string | null; fin: string | null;
    actualizadoEn: string; sentido: string; demoraSegundos: number; temporal: true; afectaRiesgo: false;
}
export interface TrafficResponse {incidentes: ExternalTrafficIncident[]; trafico: {disponible: boolean; fuente: string | null; actualizadoEn: string | null; motivo: string}; atribucion?: string}
export interface TrafficStatus {configurado: boolean; habilitado: boolean; controlCuotaDisponible: boolean; cuotas?: {tiles: {restantes: number}}}

type Point = readonly [number, number];
const validCoordinate = (c: GeoJSON.Position) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
function pointSegmentDistanceSquared(p: Point, a: Point, b: Point) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
    return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
}
function segmentsWithin(a: Point, b: Point, c: Point, d: Point, limit: number) {
    // Reject distant bounding boxes before checking intersections and distances.
    if (Math.max(a[0], b[0]) + limit < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + limit < Math.min(a[0], b[0])
        || Math.max(a[1], b[1]) + limit < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + limit < Math.min(a[1], b[1])) return false;
    const ab = subtract(b, a), cd = subtract(d, c), ac = subtract(c, a), denominator = cross(ab, cd);
    if (denominator) {
        const t = cross(ac, cd) / denominator, u = cross(ac, ab) / denominator;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
    // Also covers parallel, collinear and zero-length segments.
    return Math.min(pointSegmentDistanceSquared(a, c, d), pointSegmentDistanceSquared(b, c, d),
        pointSegmentDistanceSquared(c, a, b), pointSegmentDistanceSquared(d, a, b)) <= limit * limit;
}

export function trafficAffectsRoute(incident: Pick<ExternalTrafficIncident, 'geometria'>, route: Pick<Ruta, 'geometria'> | null, limit = 80) {
    const path = route?.geometria.coordinates;
    if (!path || path.length < 2 || !Number.isFinite(limit) || limit < 0 || !path.every(validCoordinate)) return false;
    const geometry = incident.geometria;
    const coordinates = geometry?.type === 'Point' ? [geometry.coordinates] : geometry?.type === 'LineString' ? geometry.coordinates : [];
    if (!coordinates.length || !coordinates.every(validCoordinate)) return false;
    // Use a shared local metric projection for Ica; never test only vertices,
    // because a long incident segment can cross a route between its endpoints.
    const origin = path[0], lonScale = Math.cos(origin[1] * Math.PI / 180) * 111320;
    const project = (c: GeoJSON.Position): Point => [(c[0] - origin[0]) * lonScale, (c[1] - origin[1]) * 111320];
    const road = path.map(project), event = coordinates.map(project);
    for (let i = 0; i < Math.max(1, event.length - 1); i++) {
        const a = event[i], b = event[Math.min(i + 1, event.length - 1)];
        for (let j = 1; j < road.length; j++) if (segmentsWithin(a, b, road[j - 1], road[j], limit)) return true;
    }
    return false;
}
