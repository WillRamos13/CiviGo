import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { StorageService } from '../services/native';
import { ThemeController, preferredTheme, type Theme, type ThemePreference } from '../services/theme';
import { Capacitor } from '@capacitor/core';
import { useAppActivity } from './useAppActivity';
import { applyNativeChromeTheme } from '../services/nativeChrome';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
  preference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
  isDark: false,
  preference: 'system',
  setThemePreference: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const [preference, setPreference] = useState<ThemePreference>('system');
  const controller = useRef<ThemeController | null>(null);
  const nativeThemeUpdate = useRef<Promise<void>>(Promise.resolve());
  const appActive = useAppActivity();
  if (!controller.current) controller.current = new ThemeController(theme, StorageService, (value, preference) => { setTheme(value); if (preference) setPreference(preference); });

  useEffect(() => {
    return controller.current!.initialize();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (!Capacitor.isNativePlatform() || !appActive) return;
    let current = true;
    // Serialize native updates so a slower previous theme cannot win a toggle.
    const applyNativeTheme = () => {
      if (!current || document.visibilityState === 'hidden') return;
      nativeThemeUpdate.current = nativeThemeUpdate.current.catch(() => {}).then(async () => {
        if (!current) return;
        await applyNativeChromeTheme(theme);
      }).catch(() => { /* Unsupported platform chrome must not block the application. */ });
    };
    applyNativeTheme();
    window.addEventListener('focus', applyNativeTheme);
    return () => {
      current = false;
      window.removeEventListener('focus', applyNativeTheme);
    };
  }, [theme, appActive]);

  const toggleTheme = useCallback(() => {
    controller.current!.toggle();
  }, []);
  const setThemePreference = useCallback((value: ThemePreference) => { controller.current!.setPreference(value); }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === 'dark', preference, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
