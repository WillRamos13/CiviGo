import { isPosition } from './route-cache';
import type { LocationFix } from './types';

export type MapLocationStatus = 'idle' | 'locating' | 'ready' | 'unavailable' | 'denied';
export type MapLocationFailure = {status: 'unavailable' | 'denied'; message: string};

/** Keeps nearby reports tied to browser GPS, with an explicit, idempotent cleanup. */
export function watchMapPosition(
    geolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'> | undefined,
    onPosition: (point: LocationFix) => void,
    onUnavailable: (failure: MapLocationFailure) => void,
) {
    let active = true;
    let watch: number | undefined;
    const stop = () => {
        active = false;
        if (watch !== undefined) {
            geolocation?.clearWatch(watch);
            watch = undefined;
        }
    };
    const fail = (status: MapLocationFailure['status'], message: string) => {
        if (!active) return;
        stop();
        onUnavailable({status, message});
    };
    if (!geolocation) {
        fail('unavailable', 'Este navegador no permite obtener tu ubicación.');
        return stop;
    }
    try {
        watch = geolocation.watchPosition(position => {
            if (!active) return;
            const point: LocationFix = {latitud: position.coords.latitude, longitud: position.coords.longitude};
            if (!isPosition(point)) {
                fail('unavailable', 'El GPS devolvió una ubicación inválida. Inténtalo de nuevo.');
                return;
            }
            for (const key of ['accuracy', 'heading', 'speed'] as const) {
                const value = position.coords[key];
                if (typeof value === 'number' && Number.isFinite(value)) point[key] = value;
            }
            if (Number.isFinite(position.timestamp)) point.timestamp = position.timestamp;
            onPosition(point);
        }, error => {
            if (error.code === 1) fail('denied', 'Permite el acceso a tu ubicación en el navegador para ver reportes a menos de 1 km.');
            else fail('unavailable', 'No se pudo obtener tu ubicación actual. Activa el GPS e inténtalo de nuevo.');
        }, {enableHighAccuracy: true, maximumAge: 10000, timeout: 20000});
        // Some embedded browsers may invoke an error synchronously.
        if (!active && watch !== undefined) stop();
    } catch {
        fail('unavailable', 'No se pudo iniciar la ubicación por GPS en este navegador.');
    }
    return stop;
}
