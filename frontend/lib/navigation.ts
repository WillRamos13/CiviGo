import type { Incidente, Posicion, Ruta, LocationFix } from './types';
import { isHistoricalAntecedent } from './incidents';
import { isPosition } from './route-cache';

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

export function watchRoutePosition(geolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'> | undefined, onPosition: (point: LocationFix) => void, onUnavailable: (message: string) => void) {
    let active = true, watch: number | undefined;
    const stop = () => { active = false; if (watch !== undefined) { geolocation?.clearWatch(watch); watch = undefined; } };
    const fail = (message: string) => { if (!active) return; stop(); onUnavailable(message); };
    if (!geolocation) { fail('Este navegador no permite seguir el recorrido por GPS.'); return stop; }
    try {
        watch = geolocation.watchPosition(position => {
            if (!active) return;
            const point: LocationFix = {latitud: position.coords.latitude, longitud: position.coords.longitude};
            for (const key of ['accuracy', 'heading', 'speed'] as const) if (typeof position.coords[key] === 'number' && Number.isFinite(position.coords[key])) point[key] = position.coords[key]!;
            if (Number.isFinite(position.timestamp)) point.timestamp = position.timestamp;
            if (!isPosition(point)) { fail('El GPS devolvió una ubicación inválida. El recorrido se detuvo.'); return; }
            onPosition(point);
        }, error => fail(error.code === 1 ? 'No se inició el seguimiento porque el acceso al GPS fue rechazado.' : 'No se pudo obtener una ubicación actual. El seguimiento del recorrido se detuvo.'), {enableHighAccuracy: true, maximumAge: 5000, timeout: 20000});
        if (!active && watch !== undefined) stop();
    } catch { fail('No se pudo iniciar el seguimiento por GPS en este navegador.'); }
    return stop;
}

export function metersBetween(a: Posicion, b: Posicion) {
    const rad = Math.PI / 180, dlat = (b.latitud - a.latitud) * rad, dlon = (b.longitud - a.longitud) * rad;
    return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(a.latitud * rad) * Math.cos(b.latitud * rad) * Math.sin(dlon / 2) ** 2)));
}
export type NavigationProgress = { distanceRemaining: number; secondsRemaining: number; distanceToTurn: number; instruction: string; maneuver: string; stepId: string; offRouteMeters: number; destinationMeters: number; heading: number; progressMeters: number; updatedAt: number };
// Project the GPS point onto the polyline; never count a jump in GPS as travel.
export function navigationProgress(position: LocationFix, route: Ruta): NavigationProgress {
    const coords = route.geometria.coordinates, scale = Math.cos(position.latitud * Math.PI / 180);
    let total = 0, best = Infinity, along = 0, segmentIndex = 0;
    const cumulative = [0];
    for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i], length = metersBetween({longitud: a[0], latitud: a[1]}, {longitud: b[0], latitud: b[1]});
        const ax = (a[0] - position.longitud) * scale * 111320, ay = (a[1] - position.latitud) * 111320;
        const dx = (b[0] - a[0]) * scale * 111320, dy = (b[1] - a[1]) * 111320;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        const projectedDistance = Math.hypot(ax + t * dx, ay + t * dy);
        if (projectedDistance < best) { best = projectedDistance; along = total + t * length; segmentIndex = i - 1; }
        total += length; cumulative.push(total);
    }
    const steps = route.pasos ?? [];
    const next = steps.find(s => s.tipo !== 'salida' && (cumulative[Math.min(s.indiceInicio, coords.length - 1)] ?? s.distanciaAcumulada) > along + 8) ?? steps[steps.length - 1];
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
    };
}
export function formatMeters(value: number) { return value < 1000 ? `${Math.max(0, Math.round(value / 10) * 10)} m` : `${(value / 1000).toFixed(1)} km`; }
