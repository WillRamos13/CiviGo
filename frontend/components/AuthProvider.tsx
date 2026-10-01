'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, post, ApiError } from '@/lib/api';
import { INITIAL_SESSION, SessionController } from '@/lib/session';
import type { Usuario } from '@/lib/types';
const Context = createContext<{
    usuario: Usuario | null;
    loading: boolean;
    offline: boolean;
    refresh: () => Promise<void>;
    logout: () => Promise<void>;
    prepareLogin: () => Promise<void>;
}>({ ...INITIAL_SESSION, refresh: async () => {}, logout: async () => {}, prepareLogin: async () => {} });
export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState(INITIAL_SESSION);
    const [controller] = useState(() => new SessionController({
        storage: {
            getItem: key => window.localStorage.getItem(key),
            setItem: (key, value) => window.localStorage.setItem(key, value),
            removeItem: key => window.localStorage.removeItem(key),
        },
        loadUser: async signal => (await api<{usuario: Usuario}>('/users/me', {signal})).usuario,
        endSession: async () => { try { await post('/users/logout'); } catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; } },
        networkAvailable: () => navigator.onLine,
        isUnavailable: error => error instanceof ApiError && (error.status === 0 || error.status >= 500),
        onChange: setSession,
    }));
    const refresh = useCallback(() => controller.refresh(), [controller]);
    const logout = useCallback(() => controller.logout(), [controller]);
    const prepareLogin = useCallback(() => controller.prepareLogin(), [controller]);
    useEffect(() => {
        void refresh();
        const reconnect = () => { void refresh(); };
        const changed = (event: StorageEvent) => { if (event.key === 'civigo:offline-account' || event.key === 'civigo:logout-pending') void refresh(); };
        window.addEventListener('online', reconnect);
        window.addEventListener('offline', reconnect);
        window.addEventListener('storage', changed);
        return () => {
            controller.invalidate();
            window.removeEventListener('online', reconnect);
            window.removeEventListener('offline', reconnect);
            window.removeEventListener('storage', changed);
        };
    }, [controller, refresh]);
    return <Context.Provider value={{ ...session, refresh, logout, prepareLogin }}>{children}</Context.Provider>;
}
export const useAuth = () => useContext(Context);
