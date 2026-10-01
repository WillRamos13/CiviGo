import type { Incidente, Posicion, Ruta } from './types';
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

export function watchRoutePosition(geolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'> | undefined, onPosition: (point: Posicion) => void, onUnavailable: (message: string) => void) {
    let active = true, watch: number | undefined;
    const stop = () => { active = false; if (watch !== undefined) { geolocation?.clearWatch(watch); watch = undefined; } };
    const fail = (message: string) => { if (!active) return; stop(); onUnavailable(message); };
    if (!geolocation) { fail('Este navegador no permite seguir el recorrido por GPS.'); return stop; }
    try {
        watch = geolocation.watchPosition(position => {
            if (!active) return;
            const point = {latitud: position.coords.latitude, longitud: position.coords.longitude};
            if (!isPosition(point)) { fail('El GPS devolvió una ubicación inválida. El recorrido se detuvo.'); return; }
            onPosition(point);
        }, error => fail(error.code === 1 ? 'No se inició el seguimiento porque el acceso al GPS fue rechazado.' : 'No se pudo obtener una ubicación actual. El seguimiento del recorrido se detuvo.'), {enableHighAccuracy: true, maximumAge: 5000, timeout: 20000});
        if (!active && watch !== undefined) stop();
    } catch { fail('No se pudo iniciar el seguimiento por GPS en este navegador.'); }
    return stop;
}
