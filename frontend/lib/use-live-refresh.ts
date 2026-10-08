'use client';
import { useCallback, useEffect, useRef } from 'react';
import { startLiveRefresh, type LiveRefresh } from './live-refresh';

export function useLiveRefresh(load: (signal: AbortSignal) => Promise<void>, intervalMs = 5000) {
    const controller = useRef<LiveRefresh | null>(null);
    useEffect(() => {
        const current = startLiveRefresh(load, intervalMs);
        controller.current = current;
        return () => {
            current.stop();
            if (controller.current === current) controller.current = null;
        };
    }, [load, intervalMs]);
    return useCallback(() => controller.current?.refresh(), []);
}
