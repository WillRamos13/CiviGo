"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { INITIAL_THEME, THEME_STORAGE_KEY, ThemeController, type ThemeEnvironment, type ThemePreference, type ThemeState } from '@/lib/theme';

type ThemeContextValue = ThemeState & { setTheme: (theme: ThemePreference) => void };
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function browserThemeEnvironment(): ThemeEnvironment {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    return {
        readPreference: () => window.localStorage.getItem(THEME_STORAGE_KEY),
        writePreference: theme => window.localStorage.setItem(THEME_STORAGE_KEY, theme),
        systemDark: () => media.matches,
        applyTheme: theme => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.colorScheme = theme;
        },
        onSystemChange: listener => {
            media.addEventListener('change', listener);
            return () => media.removeEventListener('change', listener);
        },
        onStorageChange: listener => {
            const handleStorage = (event: StorageEvent) => {
                if (event.key === THEME_STORAGE_KEY || event.key === null) listener(event.newValue);
            };
            window.addEventListener('storage', handleStorage);
            return () => window.removeEventListener('storage', handleStorage);
        },
    };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [controller] = useState(() => new ThemeController());
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, () => INITIAL_THEME);
    useEffect(() => controller.connect(browserThemeEnvironment()), [controller]);
    const value = useMemo(() => ({ ...state, setTheme: controller.setTheme }), [state, controller]);
    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (!context) throw new Error('useTheme debe usarse dentro de ThemeProvider.');
    return context;
}
