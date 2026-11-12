import type { Incidente, Posicion, Ruta, LocationFix } from './types';
import { isHistoricalAntecedent } from './incidents';
import { isPosition } from './route-cache';
import { gpsProblem } from './gps-quality';

export function nearRoute(p: Posicion, r: Ruta, limit = 100) {
    const coords = r.geometria.coordinates, scale = Math.cos(p.latitud * Math.PI / 180);
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i];
        const ax = (a[0] - p.longitud) * scale, ay = a[1] - p.latitud, bx = (b[0] - p.longitud) * scale, by = b[1] - p.latitud, dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(ax + t * dx, ay + t * dy) * 111320 <= limit) return true;
    }
    return false;
}
export function isRouteWarning(incident: Incidente) {
    if (!['ACTIVO', 'VALIDADO', 'PENDIENTE'].includes(incident.estado) || isHistoricalAntecedent(incident)) return false;
    return (incident.gravedad ?? incident.nivelRiesgo ?? 0) >= 4 || incident.porEvaluar === true || (incident.emergencia === true && incident.nivelRiesgo === null);
}

export function watchRoutePosition(geolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'> | undefined, onPosition: (point: LocationFix) => void, onUnavailable: (message: string) => void, onWaiting: (message: string) => void = () => {}) {
    let active = true, watch: number | undefined;
    let previous: LocationFix | null = null;
    const stop = () => { active = false; if (watch !== undefined) { geolocation?.clearWatch(watch); watch = undefined; } };
    const fail = (message: string) => { if (!active) return; stop(); onUnavailable(message); };
    if (!geolocation) { fail('Este navegador no permite seguir el recorrido por GPS.'); return stop; }
    try {
        watch = geolocation.watchPosition(position => {
            if (!active) return;
            const point: LocationFix = {latitud: position.coords.latitude, longitud: position.coords.longitude};
            for (const key of ['accuracy', 'heading', 'speed'] as const) if (typeof position.coords[key] === 'number' && (key === 'accuracy' || Number.isFinite(position.coords[key]))) point[key] = position.coords[key]!;
            if (typeof position.timestamp === 'number') point.timestamp = position.timestamp;
            if (!isPosition(point)) { fail('El GPS devolvió una ubicación inválida. El recorrido se detuvo.'); return; }
            const problem = gpsProblem(point, previous);
            if (problem) { onWaiting(problem); return; }
            previous = point;
            onPosition(point);
        }, error => {
            if (!active) return;
            if (error.code === 1) fail('No se inició el seguimiento porque el acceso al GPS fue rechazado.');
            else onWaiting('GPS temporalmente no disponible. Conservamos el recorrido y esperamos una nueva ubicación.');
        }, {enableHighAccuracy: true, maximumAge: 0, timeout: 20000});
        if (!active && watch !== undefined) stop();
    } catch { fail('No se pudo iniciar el seguimiento por GPS en este navegador.'); }
    return stop;
}

export function metersBetween(a: Posicion, b: Posicion) {
    const rad = Math.PI / 180, dlat = (b.latitud - a.latitud) * rad, dlon = (b.longitud - a.longitud) * rad;
    return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(a.latitud * rad) * Math.cos(b.latitud * rad) * Math.sin(dlon / 2) ** 2)));
}
export type NavigationProgress = { distanceRemaining: number; secondsRemaining: number; distanceToTurn: number; instruction: string; maneuver: string; stepId: string; offRouteMeters: number; destinationMeters: number; heading: number; progressMeters: number; updatedAt: number; routeId?: string; position?: LocationFix; progressTrusted?: boolean; backtracked?: boolean };
// Project the GPS point onto the polyline; never count a jump in GPS as travel.
export function navigationProgress(position: LocationFix, route: Ruta, previous?: NavigationProgress | null): NavigationProgress {
    const coords = route.geometria.coordinates, scale = Math.cos(position.latitud * Math.PI / 180);
    let total = 0, best = Infinity, along = 0, segmentIndex = 0;
    const cumulative = [0];
    const projections: {distance: number; along: number; segment: number}[] = [];
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i], length = metersBetween({longitud: a[0], latitud: a[1]}, {longitud: b[0], latitud: b[1]});
        const ax = (a[0] - position.longitud) * scale * 111320, ay = (a[1] - position.latitud) * 111320;
        const dx = (b[0] - a[0]) * scale * 111320, dy = (b[1] - a[1]) * 111320;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        const projectedDistance = Math.hypot(ax + t * dx, ay + t * dy);
        projections.push({distance: projectedDistance, along: total + t * length, segment: i - 1});
        if (projectedDistance < best) { best = projectedDistance; along = total + t * length; segmentIndex = i - 1; }
        total += length; cumulative.push(total);
    }
    let progressTrusted = true, backtracked = false;
    if (previous?.routeId === route.id && previous.position) {
        const seconds = position.timestamp && previous.updatedAt ? Math.max(0, (position.timestamp - previous.updatedAt) / 1000) : 1;
        const moved = metersBetween(previous.position, position);
        const speedLimit = route.modo === 'driving' ? 45 : route.modo === 'cycling' ? 15 : 4;
        const accuracy = Math.min(35, Math.max(8, (position.accuracy ?? 12) + (previous.position.accuracy ?? 12)));
        // The observed displacement must never authorize its own GPS jump.
        const allowance = accuracy + Math.min(seconds, 120) * speedLimit;
        // At crossings or repeated segments the nearest point is ambiguous.
        // Prefer a physically reachable continuation of the previous fix.
        const candidates = seconds <= 120 ? projections.filter(point => point.distance <= best + 8 && point.along >= previous.progressMeters - accuracy && point.along <= previous.progressMeters + allowance) : [];
        candidates.sort((a, b) => Math.abs(a.along - previous.progressMeters) - Math.abs(b.along - previous.progressMeters) || a.distance - b.distance);
        if (seconds<=120 && moved>allowance) {
            progressTrusted=false;along=previous.progressMeters;
        } else if (candidates.length) {
            along = Math.max(previous.progressMeters, candidates[0].along);
        } else if (seconds <= 120) {
            const offRoute = best > Math.max(45, (position.accuracy ?? 0) * 1.5);
            backtracked = !offRoute && along < previous.progressMeters - accuracy && moved <= allowance;
            progressTrusted = offRoute;
            along = previous.progressMeters;
        }
        // Remaining distance cannot increase because of a single noisy fix.
        if (seconds <= 120) along = Math.max(previous.progressMeters, along);
        segmentIndex = Math.max(0, cumulative.findIndex((value, index) => index > 0 && value >= along) - 1);
        if (along >= total) segmentIndex = Math.max(0, coords.length - 2);
    }
    const steps = route.pasos ?? [];
    const next = steps.find(s => s.tipo !== 'salida' && (cumulative[Math.min(s.indiceInicio, coords.length - 1)] ?? s.distanciaAcumulada) >= along - 8) ?? steps[steps.length - 1];
    const endpoint = coords[coords.length - 1], a = coords[segmentIndex], b = coords[segmentIndex + 1];
    const direction = Math.atan2((b[0] - a[0]) * scale, b[1] - a[1]) * 180 / Math.PI;
    const remainingFraction = total ? Math.max(0, Math.min(1, 1 - along / total)) : 0;
    const currentStep = [...steps].reverse().find(s => s.tipo !== 'llegada' && Number.isFinite(s.duracion) && Number.isFinite(s.duracionAcumulada) && s.indiceInicio <= segmentIndex);
    let secondsRemaining = remainingFraction * route.duracion;
    if (currentStep) {
        const start = cumulative[Math.min(currentStep.indiceInicio, coords.length - 1)] ?? 0;
        const end = cumulative[Math.min(currentStep.indiceFin, coords.length - 1)] ?? total;
        const fraction = end > start ? Math.max(0, Math.min(1, (along - start) / (end - start))) : 1;
        secondsRemaining = Math.max(0, route.duracion - currentStep.duracionAcumulada - fraction * currentStep.duracion);
    }
    return {
        distanceRemaining: remainingFraction * route.distancia,
        secondsRemaining,
        distanceToTurn: next ? Math.max(0, (cumulative[Math.min(next.indiceInicio, coords.length - 1)] ?? next.distanciaAcumulada) - along) : total - along,
        instruction: next?.instruccion || 'Continúa por el recorrido hasta tu destino', maneuver: next?.maniobra || 'recto', stepId: next?.id || 'destino',
        offRouteMeters: best, progressMeters: along,
        destinationMeters: metersBetween(position, route.destino ?? {longitud: endpoint[0], latitud: endpoint[1]}),
        heading: position.heading != null && position.heading >= 0 ? position.heading : (direction + 360) % 360,
        updatedAt: position.timestamp ?? 0,
        routeId: route.id, position:progressTrusted||backtracked?position:previous?.position??position, progressTrusted, backtracked,
    };
}
export function hasArrived(progress: NavigationProgress, accuracy = Infinity) {
    return progress.progressTrusted !== false && accuracy <= 40 && progress.offRouteMeters <= 30
        && progress.destinationMeters <= 30 && progress.distanceRemaining <= 40;
}

/** Split only the visual polyline; routing, distance and risk retain the original geometry. */
export function splitRouteGeometry(geometry: Ruta['geometria'], progressMeters = 0) {
    const coords = geometry.coordinates;
    const empty: GeoJSON.FeatureCollection = {type: 'FeatureCollection', features: []};
    if (!Number.isFinite(progressMeters) || progressMeters <= 0 || coords.length < 2)
        return {completed: empty as GeoJSON.GeoJSON, remaining: geometry as GeoJSON.GeoJSON};
    let length = 0;
    for (let index = 1; index < coords.length; index++) {
        const a = coords[index - 1], b = coords[index];
        const segment = metersBetween({longitud: a[0], latitud: a[1]}, {longitud: b[0], latitud: b[1]});
        if (segment > 0 && length + segment > progressMeters) {
            const fraction = (progressMeters - length) / segment;
            const point = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
            return {completed: {type: 'LineString', coordinates: [...coords.slice(0, index), point]} as GeoJSON.GeoJSON,
                remaining: {type: 'LineString', coordinates: [point, ...coords.slice(index)]} as GeoJSON.GeoJSON};
        }
        length += segment;
    }
    return {completed: geometry as GeoJSON.GeoJSON, remaining: empty as GeoJSON.GeoJSON};
}
export function formatMeters(value: number) { return value < 1000 ? `${Math.max(0, Math.round(value / 10) * 10)} m` : `${(value / 1000).toFixed(1)} km`; }
