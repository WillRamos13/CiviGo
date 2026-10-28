import type { LocationFix } from '../types';

// Broad Ica coverage envelope; precise route coverage is checked by the API.
export function gpsProblem(point: LocationFix, previous?: LocationFix | null, now = Date.now()): string | null {
    if (!Number.isFinite(point.latitud) || !Number.isFinite(point.longitud)) return 'El GPS devolvió coordenadas inválidas.';
    if (point.latitud < -15 || point.latitud > -13.3 || point.longitud < -76.3 || point.longitud > -75.1)
        return 'La ubicación recibida está fuera de la cobertura de Ica. Comprueba el GPS y vuelve a intentarlo.';
    if (point.accuracy !== undefined && (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 100))
        return 'Esperando una ubicación GPS más precisa. Acércate a una ventana o sal a un espacio abierto.';
    if (point.timestamp !== undefined && (!Number.isFinite(point.timestamp) || point.timestamp < now - 30000 || point.timestamp > now + 5000))
        return 'Esperando una ubicación GPS reciente.';
    if (previous?.timestamp && point.timestamp) {
        if (point.timestamp <= previous.timestamp) return 'Esperando una nueva lectura GPS.';
        const seconds = (point.timestamp - previous.timestamp) / 1000;
        const lat = (point.latitud - previous.latitud) * 111320;
        const lon = (point.longitud - previous.longitud) * 111320 * Math.cos(point.latitud * Math.PI / 180);
        const tolerance = 100 + (point.accuracy ?? 30) + (previous.accuracy ?? 30);
        if (seconds < 120 && Math.hypot(lat, lon) > tolerance + 65 * seconds)
            return 'Se detectó un salto de GPS. Conservamos la última ubicación fiable.';
    }
    return null;
}
