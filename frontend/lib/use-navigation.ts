'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { post, errorMessage } from './api';
import { isRoute } from './route-cache';
import { navigationProgress, watchRoutePosition, type NavigationProgress } from './navigation';
import type { LocationFix, Ruta, RouteCriterion } from './types';

export function useNavigation(route: Ruta | null, following: boolean, onRoute: (route: Ruta) => void, onFollow: (value: boolean) => void, incidentRevision: number) {
    const [position, setPosition] = useState<LocationFix | null>(null), [progress, setProgress] = useState<NavigationProgress | null>(null);
    const [notice, setNotice] = useState(''), [recalculating, setRecalculating] = useState(false), [muted, setMuted] = useState(false);
    const [centerVersion, setCenterVersion] = useState(0);
    const state = useRef({route, following, onRoute, onFollow, muted});
    const lastFix = useRef<LocationFix | null>(null), request = useRef<AbortController | null>(null), lastRecalculation = useRef(0);
    const deviation = useRef(0), arrivalSince = useRef(0), speechKeys = useRef(new Set<string>());
    const previousRevision = useRef(incidentRevision);
    const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingReason = useRef('');
    useEffect(() => { state.current = {route, following, onRoute, onFollow, muted}; }, [route, following, onRoute, onFollow, muted]);
    const speak = useCallback((text: string, key: string) => {
        if (speechKeys.current.has(key) || state.current.muted || typeof window === 'undefined' || !window.speechSynthesis) return;
        speechKeys.current.add(key);
        const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'es-PE'; utterance.rate = 1;
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
    }, []);
    const recalculate = useCallback(async function replan(reason: string) {
        const current = state.current, fix = lastFix.current;
        if (!current.following || !current.route) return;
        pendingReason.current = reason;
        if (!fix || request.current) return;
        const cooldown = 20000 - (Date.now() - lastRecalculation.current);
        if (cooldown > 0) { if (!retry.current) retry.current = setTimeout(() => { retry.current = null; void replan(reason); }, cooldown); return; }
        if ((fix.accuracy ?? 0) > 60) { setNotice('Esperando una ubicación más precisa para actualizar el recorrido.'); return; }
        const original = current.route, end = original.geometria.coordinates.at(-1)!;
        const controller = new AbortController(); request.current = controller; lastRecalculation.current = Date.now();
        pendingReason.current = '';
        const criterio: RouteCriterion = original.tipo === 'corta' ? 'rapida' : original.tipo;
        setRecalculating(true); setNotice(reason); speak('Actualizando el recorrido desde tu ubicación.', `recalculo-${lastRecalculation.current}`);
        try {
            const data = await post<{rutas: Ruta[]; seleccionadaId?: string}>('/navigation/plan', {origen: fix, destino: original.destino ?? {longitud: end[0], latitud: end[1]}, modo: original.modo ?? 'walking', criterio}, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)])});
            if (controller.signal.aborted || !state.current.following) return;
            const selected = data.rutas?.find(r => r.id === data.seleccionadaId) ?? data.rutas?.find(r => r.tipo === criterio || r.criterios?.includes(criterio));
            if (!isRoute(selected)) throw new Error('No se encontró una alternativa para el criterio elegido.');
            const updated = {...selected, tipo: criterio, modo: original.modo ?? selected.modo ?? 'walking', destino: original.destino ?? selected.destino};
            state.current.route = updated;
            state.current.onRoute(updated); deviation.current = 0; speechKeys.current.clear();
            setProgress(navigationProgress(fix, updated)); setNotice('Recorrido actualizado. Se conserva tu criterio de ruta.');
        } catch (error) {
            if (!controller.signal.aborted) {
                setNotice(`Se conserva el recorrido anterior. ${errorMessage(error)} Reintentaremos automáticamente.`);
                if (!retry.current) retry.current = setTimeout(() => { retry.current = null; void replan(reason); }, 30000);
            }
        } finally {
            if (request.current === controller) { request.current = null; setRecalculating(false); if (pendingReason.current) void replan(pendingReason.current); }
        }
    }, [speak]);
    useEffect(() => {
        if (!following) return;
        let active = true;
        deviation.current = 0; arrivalSince.current = 0; lastRecalculation.current = 0; speechKeys.current.clear(); lastFix.current = null; pendingReason.current = state.current.route?.copiaGuardada ? 'Actualizando las condiciones de la copia guardada…' : '';
        void Promise.resolve().then(() => { if (active) { setNotice('Esperando tu ubicación…'); setProgress(null); setPosition(null); setRecalculating(false); } });
        const stop = watchRoutePosition(navigator.geolocation, fix => {
            if (!active || !state.current.route) return;
            lastFix.current = fix; setPosition(fix);
            const next = navigationProgress(fix, state.current.route); setProgress(next);
            if ((fix.accuracy ?? 0) > 60) { setNotice('GPS poco preciso. Esperando una ubicación mejor.'); return; }
            setNotice(current => current === 'Esperando tu ubicación…' || current.startsWith('GPS poco preciso') || current.startsWith('Esperando una ubicación más precisa') ? '' : current);
            if (pendingReason.current) void recalculate(pendingReason.current);
            const now = fix.timestamp ?? Date.now();
            if (next.destinationMeters <= 30 && (fix.accuracy ?? 0) <= 40) {
                if (!arrivalSince.current) arrivalSince.current = now;
                if (now - arrivalSince.current >= 5000) {
                    speak('Llegaste a tu destino.', 'llegada'); setNotice('Llegaste a tu destino. Recorrido finalizado.'); state.current.onFollow(false); return;
                }
            } else arrivalSince.current = 0;
            if (next.offRouteMeters > Math.max(45, (fix.accuracy ?? 0) * 1.5)) {
                deviation.current++;
                if (deviation.current >= 2) void recalculate('Te alejaste del recorrido. Recalculando…');
            } else {
                deviation.current = 0;
                const threshold = state.current.route.modo === 'driving' ? 120 : 40;
                const stage = next.distanceToTurn < threshold ? 'cerca' : 'previo';
                speak(`${next.distanceToTurn > 20 ? `En ${Math.round(next.distanceToTurn / 10) * 10} metros, ` : ''}${next.instruction}`, `${state.current.route.id}-${next.stepId}-${stage}`);
            }
        }, message => { if (active) { setNotice(message); state.current.onFollow(false); } });
        return () => {
            active = false; stop(); request.current?.abort(); request.current = null;
            if (retry.current) clearTimeout(retry.current); retry.current = null;
            pendingReason.current = '';
            window.speechSynthesis?.cancel();
        };
    }, [following, recalculate, speak]);
    useEffect(() => { if (!following) return; const timer = setInterval(() => { if (state.current.route?.modo === 'driving') void recalculate('Actualizando las condiciones de tráfico…'); }, 120000); return () => clearInterval(timer); }, [following, recalculate]);
    useEffect(() => {
        if (previousRevision.current === incidentRevision) return;
        previousRevision.current = incidentRevision;
        if (following) { speak('Nuevo incidente importante cerca del recorrido.', `alerta-${incidentRevision}`); void recalculate('Nuevo incidente en el recorrido. Recalculando…'); }
    }, [incidentRevision, following, recalculate, speak]);
    useEffect(() => {
        if (!following || !('wakeLock' in navigator)) return;
        let active = true, lock: WakeLockSentinel | undefined;
        const acquire = async () => { if (!active || document.visibilityState !== 'visible' || lock && !lock.released) return; try { const candidate = await navigator.wakeLock.request('screen'); if (active) lock = candidate; else await candidate.release(); } catch { /* Optional browser capability. */ } };
        void acquire(); document.addEventListener('visibilitychange', acquire);
        return () => { active = false; document.removeEventListener('visibilitychange', acquire); void lock?.release(); };
    }, [following]);
    const toggleMuted = () => { setMuted(v => !v); if (!muted) window.speechSynthesis?.cancel(); };
    return {position, progress, notice, recalculating, muted, toggleMuted, centerVersion, recenter: () => setCenterVersion(v => v + 1), recalculate};
}
