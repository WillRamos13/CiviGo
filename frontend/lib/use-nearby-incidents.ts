'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import { metersBetween } from './navigation';
import { useLiveRefresh } from './use-live-refresh';
import type { Incidente, Posicion } from './types';
const EMPTY_INCIDENTS: Incidente[] = [];

export function useNearbyIncidents(position: Posicion | null, category: string) {
    const [data, setData] = useState<{category: string; incidents: Incidente[]; error: string} | null>(null);
    const scope = useRef({position, category});
    const lastRequested = useRef<Posicion | null>(null);
    const available = position !== null;
    useEffect(() => { scope.current = {position, category}; }, [position, category]);
    const load = useCallback(async (signal: AbortSignal) => {
        const requested = scope.current;
        if (!available || !requested.position || requested.category !== category) return;
        lastRequested.current = requested.position;
        const query = new URLSearchParams({latitud: String(requested.position.latitud), longitud: String(requested.position.longitud)});
        if (requested.category) query.set('tipo', requested.category);
        const current = () => !signal.aborted && scope.current.category === requested.category && scope.current.position !== null && metersBetween(requested.position!, scope.current.position) <= 25;
        try {
            const incidents = await api<Incidente[]>(`/incidents?${query}`, {signal: AbortSignal.any([signal, AbortSignal.timeout(30000)])});
            if (current()) setData(previous => previous?.category === requested.category && !previous.error && JSON.stringify(previous.incidents) === JSON.stringify(incidents) ? previous : {category: requested.category, incidents, error: ''});
        } catch (error) {
            if (current()) setData(previous => ({category: requested.category, incidents: previous?.category === requested.category ? previous.incidents : [], error: errorMessage(error)}));
        }
    }, [available, category]);
    const refresh = useLiveRefresh(load);
    useEffect(() => {
        if (position && lastRequested.current && metersBetween(position, lastRequested.current) > 25) refresh();
    }, [position, refresh]);
    const matching = data?.category === category ? data : null;
    return {incidents: matching?.incidents ?? EMPTY_INCIDENTS, loading: available && !matching, error: matching?.error ?? '', refresh};
}
