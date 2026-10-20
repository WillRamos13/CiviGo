import type { LocationFix, Ruta } from './types';

export function routeTimeSource(route: Ruta, now = Date.now()): string {
    if (route.copiaGuardada) return 'Estimación guardada · Sin tráfico actualizado';
    const traffic = route.trafico;
    const source = (route.estimacion?.fuente ?? route.fuente)?.toUpperCase();
    if (traffic?.disponible) {
        const timestamp = traffic.actualizadoEn ? Date.parse(traffic.actualizadoEn) : NaN;
        const fresh = Number.isFinite(timestamp) && now - timestamp >= -60000 && now - timestamp <= 600000;
        const name = traffic.fuente?.toUpperCase() === 'TOMTOM' ? 'TomTom' : 'del proveedor';
        return fresh ? `Estimación ${name} · Con tráfico` : `Estimación ${name} · Tráfico sin actualización reciente`;
    }
    return source === 'OPENSTREETMAP' ? 'Estimación OpenStreetMap · Sin tráfico en vivo' : 'Estimación del recorrido · Sin tráfico en vivo';
}

export function reliableSpeed(fix: LocationFix | null | undefined, now = Date.now()): number | null {
    if (!fix || !Number.isFinite(fix.speed) || fix.speed! < 0 || fix.speed! > 80 ||
        !Number.isFinite(fix.accuracy) || fix.accuracy! < 0 || fix.accuracy! > 35 ||
        !Number.isFinite(fix.timestamp) || now - fix.timestamp! < -1000 || now - fix.timestamp! > 10000) return null;
    return Math.round(fix.speed! * 3.6);
}
